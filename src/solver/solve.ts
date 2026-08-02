// Ported from solver.py's Solver.setup()/get_result(). Builds the same MILP structure (building
// counts, escalating-cost sequential port slots, dependency unlocking, a fixed primary/claim
// station, slot capacity, min/max constraints) but targets HiGHS via LP-format text instead of
// SCIP, since this now runs client-side in the browser via WASM instead of a desktop Python
// process.
//
// Deviations from the original Python, made deliberately while porting (not left as silent bugs):
//  - Dependency constraints used SCIP's native indicator constraints; HiGHS's LP-text interface
//    has no equivalent, so they're reformulated as big-M constraints here (see DEPENDENCY_BIG_M).
//    The underlying trick (indicator vars the solver may freely leave at 0, only forced to 1 —
//    and thus obligated to actually satisfy the guarded constraint — when beneficial to the
//    objective) is preserved exactly, just expressed with a big-M pair instead of a native
//    indicator constraint.
//  - Custom objective expressions no longer go through eval() (flagged in the original source as
//    a security risk); see objective.ts for the safe parser + LP-linearization replacement.
//  - The original (and an earlier version of this port) let the solver pick the primary/claim
//    station from a set of candidates. Removed: every colonised system requires one fixed, upfront
//    choice of primary station type before anything else can be built — it's not a value worth
//    optimizing over, it's a precondition. `firstStationBuilding` is now always required input.
//
// --- economy_synergy (Update 3 link/economy feeding the objective) -------------------------------
// Update 3's link/economy modeling (see CLAUDE.md) needs to feed the objective, not stay purely
// post-solve/display-only: a solve that never considers *which body* a building's economy type
// actually suits isn't a useful recommendation engine game-wise, even without a full commodity
// model. `economy_synergy` is the result — see `economySynergyCoefficient` below for exactly what
// it computes. It is deliberately NOT an
// attempt to model the full strong/weak-link graph inside the MILP (that would require knowing
// which port is dominant on each body, which itself depends on the very placement decisions being
// solved for — a circular, and likely intractable, thing to embed as linear objective
// coefficients; see `domain/links.ts`'s post-solve `computeSystemLinks` for where that full
// computation actually happens, unchanged by this feature). Instead, `economy_synergy` reuses the
// exact same verbatim-sourced strong-link boost/decrease table
// (`domain/economyOverrides.ts`'s `computeBoostDecrease`) a real strong link would receive, applied
// to each *candidate* (building, body) pair — i.e. "would this building's own economy type(s) be
// boosted or decreased by this specific body's attributes if it ended up strong-linked here," which
// is exactly the deterministic, body-only (not placement-graph-dependent) half of the real
// mechanic. This is a genuine new approximation, not a verbatim source number — flagged in
// CLAUDE.md's "Explicitly unverified/best-effort constants" section alongside the other constants
// it's built out of.
//
// One thing this term does NOT get to ignore: a strong link can only ever form on a body that
// actually HAS a port (per CLAUDE.md's link topology — links only ever form port<->facility or
// port<->port, never facility<->facility). Applying the full strong-link-style boost/decrease to
// every candidate body regardless would make the solver actively prefer dumping facilities onto
// port-less bodies purely to farm a boost that could never really apply there — surfacing as
// `domain/links.ts`'s "has N facility type(s) but no port, they can't form a strong link here"
// warning far more often post-solve. `knownPortBodyIds` below is the fix: a body only gets the full
// strong-link-style delta if it's known (before solving, not decision-dependent) to have a port —
// already has one present, or is the primary station's assigned body. Every other body instead
// gets a small flat, body-attribute-INdependent trickle (`WEAK_LINK_CONTRIBUTION` per economy
// carried) — correctly modeling that such a placement can, at best, weak-link elsewhere (weak links
// are unaffected by body boost/decrease, per the same verbatim rules), not a full strong link.
// Whether the solver ALSO builds a brand-new port on a body it didn't have one on yet is itself a
// decision variable — same circularity this file's header already calls out — so this stays a
// conservative "assume no new port arrives here" approximation, not exact either way.

import {
  ALL_BUILDINGS,
  ALL_SCORES,
  type EconomyType,
  type Score,
  computeCompoundScore,
  FIRST_STATION_BONUS,
  getT2PortCost,
  getT3PortCost,
  isPort,
  isPortRole,
  SUBSEQUENT_FACILITY_REDUCTION,
} from "../data/buildings";
import {
  applyManualResourceLevel,
  BOOST_DECREASE_DELTA,
  computeBoostDecrease,
  facilityBaseEconomies,
  type ResourceLevel,
} from "../domain/economyOverrides";
import { WEAK_LINK_CONTRIBUTION, type BuildingPlacement } from "../domain/links";
import {
  applyPrimaryReservation,
  computeHardNonPortSeed,
  computePresentPortsSeed,
  splitPresentFacilities,
  type PresentFacilitiesBody,
  type PresentFacilityRef,
  type PresentFacilitySlot,
} from "../domain/presentFacilities";
import type { JournalBody } from "../journal/parser";
import { addExpr, exprConst, exprVar, type LPExpr, scaleExpr, subExpr } from "./lpExpr";
import { boundExpr, evalExprAt, INFINITY, LPModel } from "./lpModel";
import { compileObjective, type Direction, type ScoreBounds } from "./objective";
import type { ScoreLetter } from "./expressionParser";

export type { BuildingPlacement } from "../domain/links";
export type { PresentFacilitySlot } from "../domain/presentFacilities";

export type { Direction } from "./objective";

const DEPENDENCY_BIG_M = 1000;
const DEFAULT_BUILDING_COUNT_CAP = 300;
const DEFAULT_MAX_NEW_PORTS = 20;

/** Scale factor for an `economyPreferences` slider value (1-200; 0 is the separate hard Forbid case
 * — see `EconomyPreference`'s doc comment) into a per-(building, body)-pair `economy_preference`
 * coefficient: `(value - 50) / 50 * ECONOMY_PREFERENCE_MAGNITUDE`. Originally set to plain
 * `BOOST_DECREASE_DELTA` (0.4, "100 on the slider = one real link-boost") for dimensional grounding,
 * but real-system testing (2026-07-31) found that swing (-0.39 to +1.2 across the full 1-200 range)
 * too faint to noticeably shift a real solve, easily outweighed by everything else competing in the
 * objective — a `5x` retune widens it to -1.96 to +6.0, a real felt pull while staying well short of
 * Forbid's absolute exclusion. Still a starting point, not a settled number — see CLAUDE.md's
 * "Explicitly unverified/best-effort constants" section. */
const ECONOMY_PREFERENCE_MAGNITUDE = BOOST_DECREASE_DELTA * 5;

export interface SlotAvailability {
  space: number;
  ground: number;
  asteroid: number;
}

/** Per-body capacity input for the per-body placement mode (see the header comment block above
 * "--- Per-body placement" further down for the full design). `slots.asteroid` keeps
 * `JournalBody.slots.asteroid`'s existing 0/1 semantics — a positive value means this body is
 * ring/belt-eligible for an Asteroid_Base, not a count of anything. Deliberately a small,
 * solver-local shape (not `JournalBody`): the MILP only ever needs capacity, never astrophysical
 * attributes — those belong to the post-solve links/economy layer (`domain/links.ts`,
 * `domain/economyOverrides.ts`), which solve.ts stays decoupled from.
 *
 * `slots.space`/`slots.ground` are the body's TOTAL physical slot counts (matching what
 * `eligibility.ts` estimates and what Journal Import's table edits) — NOT "remaining capacity".
 * `solve.ts` computes remaining capacity itself: total minus whatever `presentFacilities` occupies
 * (see "--- Already-present facilities" below), so the caller never needs to manually pre-subtract
 * already-built stuff. */
export interface SolverBody {
  bodyId: number;
  slots: SlotAvailability;
  /** What's already built in this body's slots — see `domain/presentFacilities.ts`'s header for
   * the hard-vs-demolishable distinction. Absent/undefined arrays are treated as "all empty". */
  presentFacilities?: {
    space: (PresentFacilitySlot | null)[];
    ground: (PresentFacilitySlot | null)[];
  };
  /** Per-slot-index "leave empty" markers — see `JournalBody.blockedSlots`'s doc comment for the
   * full design. Absent/undefined arrays are treated as "nothing blocked". Only ever counted against
   * a slot index that's also empty in `presentFacilities` (see `countBlockedEmptySlots` below), so a
   * stale/conflicting entry can never double-subtract capacity. */
  blockedSlots?: {
    space: boolean[];
    ground: boolean[];
  };
  /** This body's full journal attributes (star/planet type, rings, organics, etc.) — the ONLY
   * reason `solve.ts` needs anything beyond bare slot capacity from a body. Feeds
   * `economySynergyCoefficient` below (see this file's header comment for what that term means).
   * Optional and additive: omitting it for a body (or every body) just makes that body contribute
   * 0 to `economy_synergy`, same backward-compatible degrade-to-today's-behavior pattern `bodies`
   * itself already follows when absent entirely. */
  economy?: JournalBody;
  /** True only for a star belt's own dedicated synthetic body (`JournalBody.kind === "ring"` — see
   * `journal/parser.ts`'s `withRingBodies`) — real-game-confirmed (2026-07-28): a belt's slot can
   * ONLY ever hold an Asteroid Base, unlike a ringed PLANET's own slot, which stays an ordinary
   * orbital slot that merely additionally qualifies for one (see the `bodyVars` loop below, and
   * CLAUDE.md's "Star belts vs. planet rings" section). Absent/false for every other body,
   * including a ringed planet — same backward-compatible degrade pattern as `economy` above. */
  asteroidExclusive?: boolean;
}

export type ObjectiveInput =
  | { kind: "simple"; score: Score }
  | { kind: "custom"; expression: string; direction: Direction };

export interface SolverInput {
  slots: SlotAvailability;
  objective: ObjectiveInput;
  /** The primary/claim station's building type — required. Every colonised system has exactly one,
   * it must be built first, and (matching how other community tools account for it) it occupies
   * one of its body's ordinary orbital slots rather than a separate dedicated one — see
   * `bodies`/`firstStationBodyId` below for the capacity consequence. Always a fixed input to the
   * solver, never something the solver picks. Must be one of `ALL_CATEGORIES["First Station"]`
   * (every orbital Port-role building — Outposts, Coriolis, Asteroid Base, Orbis/Ocellus,
   * Dodecahedron; ground ports and Supporting Facilities aren't eligible, matching the game's own
   * rule — so the primary always needs a body with at least one orbital slot). */
  firstStationBuilding: string;
  /** Which imported body the primary station sits on. Only meaningful when `bodies` is present.
   * When given, that body must have at least one orbital slot (`slots.space >= 1`) — the solver
   * reserves one of its physical orbital slots for the primary station, reducing what's left for
   * ordinary new construction on that body by 1 (e.g. a 3-orbital-slot body has 2 left for the
   * solver/user to fill). Left undefined, no body's capacity is reserved — this only affects
   * `SolverResult.placements` (and hence the Links & economy panel) display, not feasibility, same
   * as before; the UI is expected to require an assignment once bodies are in play, but the solver
   * itself stays permissive for API callers that don't need placement display. */
  firstStationBodyId?: number;
  allowCriminal: boolean;
  /** Building name -> count already present, excluding whatever was picked as the first station.
   * Only consulted in aggregate mode (`bodies` absent/empty) — when `bodies` is present, already-
   * present accounting (including the T2/T3 starting balance) comes entirely from each body's
   * `presentFacilities` instead, so callers should pass `{}` here to avoid double-counting. */
  alreadyPresent: Record<string, number>;
  constraints?: { atLeast?: Record<string, number>; atMost?: Record<string, number> };
  scoreConstraints?: { min?: Partial<Record<Score, number>>; max?: Partial<Record<Score, number>> };
  /** Absent/empty => today's exact aggregate behavior (a single implicit slot pool, no per-body
   * constraints, `SolverResult.placements` comes back empty). Present => every buildable slot is
   * additionally capacity-constrained per body (including whatever each body's `presentFacilities`
   * occupies), and the solution reports which body each new building landed on. `atLeast`/`atMost`
   * buildings stay body-unassigned either way — only newly solved-for buildings (and the primary
   * station, if `firstStationBodyId` is given) get placed. */
  bodies?: SolverBody[];
  /** Per-`EconomyType` steering (absent per economy = "No preference", today's default, no bias).
   * Only meaningful when `bodies` is present and non-empty — like `economy_synergy`, evaluating a
   * generic port's economy set needs a real body's attributes
   * (`domain/economyOverrides.ts#facilityBaseEconomies`), which aggregate mode doesn't have.
   * Silently ignored (no effect, no error) when `bodies` is absent/empty — same backward-compatible
   * degrade pattern as `SolverBody.economy` itself. See this file's `economy_preference`/Forbid
   * block (search "economyPreferences") for exactly how each value is enforced. */
  economyPreferences?: Partial<Record<EconomyType, EconomyPreference>>;
  /** Manual "System resource level" override (`PlannerFormState.systemResourceLevel`) feeding
   * `economy_synergy`'s Extraction/Industrial/Refinery boost-decrease, same scope as `economy
   * Preferences` above (only meaningful when `bodies` is present). Absent/undefined defaults to
   * `"pristine"` here — same backward-compatible degrade pattern as `SolverBody.economy` itself, so
   * an existing caller that never sets this (e.g. `solve.test.ts` fixtures predating this field)
   * keeps getting real detected per-body data when present, or Pristine otherwise, never "unknown".
   * See `domain/economyOverrides.ts`'s `applyManualResourceLevel` for the injection mechanism. */
  systemResourceLevel?: ResourceLevel;
  /** Per-body MILP lower bounds: forces the solver to build at least `count` of `building` at
   * `bodyId` as genuine NEW construction (real cost, real slot consumption — shows up in
   * `placements`/`toBuild` like any other solver decision), rather than a pre-existing present
   * facility. Feeds the "Self-sufficiency" checkboxes (`domain/
   * selfSufficiencyCombos.ts`'s `checkedForcedBuildings`) — deliberately NOT implemented by
   * injecting a present facility into `SolverBody.presentFacilities`, since that would make the
   * goal look already-built (inflating the pre-solve "Actual facilities" panel's current T2/T3
   * points) instead of a planned outcome of the NEXT solve. Only meaningful when `bodies` is
   * present and non-empty (a `bodyId` with no matching `SolverBody` is silently skipped, not an
   * error) — same backward-compatible degrade pattern as `economyPreferences`/`systemResourceLevel`
   * above. An unsatisfiable request (not enough capacity/points) correctly makes the whole solve
   * report infeasible rather than being silently dropped. */
  forcedBodyBuildings?: { bodyId: number; building: string; count: number }[];
}

/** What a user can set per `EconomyType` in `ObjectivePanel`'s "Economy preferences" table.
 * `undefined`/absent (not a listed member here) = "No preference", today's unbiased default — the
 * UI's own checkbox toggles between this absence and a live numeric slider, never sending a `0`
 * through this field for the neutral case.
 * - `"forbid"` is the one hard MILP constraint (zeroes out every carrying variable) — a real
 *   guarantee, not a nudge. Corresponds to the slider's `0` endpoint in the UI, but represented here
 *   as its own literal rather than the number `0`, since `0` needs to be visually/behaviorally
 *   distinct from "a very low slider value" (see `ObjectivePanel.tsx`).
 * - A `number` (1-200) is a soft, purely linear nudge: `(value - 50) / 50 *
 *   ECONOMY_PREFERENCE_MAGNITUDE` folded into the `economy_preference` score (letter `p`), never a
 *   constraint, so it can never make an otherwise-feasible plan infeasible. `50` is neutral (zero
 *   coefficient); below it is a soft "Avoid" pull, above it "Wish"/"Boost"/"Ludicrous boost". There
 *   is deliberately no hard "Must" state anymore (dropped: an economy with zero eligible (building,
 *   body) pairs anywhere would make the whole solve report infeasible for what's more often a casual
 *   "I want a lot of this" gesture than a real hard requirement) — a high slider value is a strong
 *   but still-soft pull instead. */
export type EconomyPreference = "forbid" | number;

export interface SolverResult {
  status: "optimal" | "infeasible" | "error";
  message?: string;
  toBuild: Record<string, number>;
  portOrder: string[];
  firstStation: string | null;
  scores: Record<Score, number>;
  finalT2Points: number;
  finalT3Points: number;
  slotsRemaining: SlotAvailability;
  objectiveValue: number | null;
  /** Which body each newly-built unit landed on — empty in aggregate mode (`input.bodies` absent),
   * or when a body couldn't be determined (see `SolverInput.bodies`'s doc comment for what stays
   * unassigned even in per-body mode). Consumed by `domain/links.ts`'s post-solve computation. */
  placements: BuildingPlacement[];
  /** Echoes `input.firstStationBodyId` when `input.bodies` is present and it was given; null
   * otherwise (aggregate mode, or per-body mode without a chosen body for the primary station). */
  firstStationBodyId: number | null;
  /** Already-present, demolishable facilities the solver chose to actually remove (refunding their
   * stat/T2/T3 contribution and freeing their slot) — always empty in aggregate mode, and never
   * contains a port (ports are never demolishable in this app; see
   * `domain/presentFacilities.ts`'s header). Tells the UI what to actually tear down. */
  demolished: { bodyId: number; slotKind: "space" | "ground"; index: number; building: string }[];
}

const SCORE_LETTER_TO_SCORE: Record<ScoreLetter, Score> = {
  i: "initial_population_increase",
  m: "max_population_increase",
  e: "security",
  t: "tech_level",
  w: "wealth",
  n: "standard_of_living",
  d: "development_level",
  c: "construction_cost",
  y: "economy_synergy",
  p: "economy_preference",
};

function errorResult(message: string): SolverResult {
  return {
    status: "error",
    message,
    toBuild: {},
    portOrder: [],
    firstStation: null,
    scores: Object.fromEntries(ALL_SCORES.map((s) => [s, 0])) as Record<Score, number>,
    finalT2Points: 0,
    finalT3Points: 0,
    slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
    objectiveValue: null,
    placements: [],
    firstStationBodyId: null,
    demolished: [],
  };
}

export async function solve(input: SolverInput): Promise<SolverResult> {
  // Deliberately permissive here (any known building, not just orbital Port-role ones) — the
  // "must be an orbital station, not a facility" rule is enforced by the UI's dropdown offering
  // only `ALL_CATEGORIES["First Station"]`, not by the solver itself, so tests/API callers can
  // still pass an arbitrary building to isolate specific stat effects if useful.
  if (!input.firstStationBuilding || !(input.firstStationBuilding in ALL_BUILDINGS)) {
    return errorResult("Error: pick your first station");
  }

  if (input.bodies && input.firstStationBodyId !== undefined) {
    const firstStationBody = input.bodies.find((b) => b.bodyId === input.firstStationBodyId);
    if (firstStationBody && firstStationBody.slots.space < 1) {
      return errorResult("Error: the primary station needs a body with at least one orbital slot");
    }
  }

  // Already-present facilities per body (see domain/presentFacilities.ts's header for the
  // hard-vs-demolishable split, and SolverBody's doc comment for why `presentFacilities` replaces
  // the flat `alreadyPresent` map's role entirely once `bodies` is used). Computed unconditionally
  // — both lists are simply empty when `input.bodies` is absent/empty.
  //
  // `applyPrimaryReservation` overwrites the primary station's own assigned body's Orbital-1 slot
  // with its own real, synced entry (see `PresentFacilitySlot.primary`'s doc comment) — authoritative
  // regardless of whatever `input.bodies` itself says was there, exactly like this file already
  // never trusts a caller to have independently gotten `firstStationBuilding` itself right. This is
  // what lets the capacity constraint below, `computeHardNonPortSeed`/`computePresentPortsSeed`'s
  // T2/T3 seed (further down), and the reported `slotsRemaining` all treat the primary's slot as an
  // ordinary occupied one via `presentSplit.hard` directly — no separate "+1 for the primary" is
  // needed anywhere in this file, which would otherwise double-count it whenever `input.bodies`
  // also has a real facility recorded in that same slot.
  const presentBodies: PresentFacilitiesBody[] = applyPrimaryReservation(
    (input.bodies ?? []).map((b) => ({
      bodyId: b.bodyId,
      space: b.presentFacilities?.space ?? [],
      ground: b.presentFacilities?.ground ?? [],
    })),
    input.firstStationBodyId,
    input.firstStationBuilding,
  );
  const presentSplit = splitPresentFacilities(presentBodies);

  const nbPortsAlreadyPresent =
    input.bodies && input.bodies.length > 0
      ? presentSplit.hard.filter((f) => !f.primary && isPort(ALL_BUILDINGS[f.building])).length
      : Object.entries(input.alreadyPresent)
          .filter(([name]) => isPort(ALL_BUILDINGS[name]))
          .reduce((sum, [, nb]) => sum + nb, 0);
  const maxNbPorts = DEFAULT_MAX_NEW_PORTS + nbPortsAlreadyPresent;

  const model = new LPModel();

  // --- Decision variables --------------------------------------------------------------
  const allVars: Record<string, LPExpr> = {}; // newly-built count, per building
  const portVars: Record<string, string[]> = {}; // port name -> [slot var names], length maxNbPorts

  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    if (!isPort(building)) {
      const v = model.addVar(name, "integer", 0, DEFAULT_BUILDING_COUNT_CAP);
      allVars[name] = exprVar(v, 1);
    } else {
      const slots: string[] = [];
      for (let k = 0; k < maxNbPorts; k++) {
        slots.push(model.addVar(`${name}__port_${k}`, "binary"));
      }
      portVars[name] = slots;
      allVars[name] = slots.reduce((acc, v) => addExpr(acc, exprVar(v, 1)), exprConst(0));
    }
  }

  // --- Per-body placement (additive, not replacing) ---------------------------------------
  // `allVars[name]` above is already an EXPRESSION (a single var for normal buildings, a sum of
  // `port_k` binaries for ports) — not a raw solver variable. So per-body placement doesn't need
  // to change what `allVars`/`allValues` ARE; it just adds a parallel decomposition layer tied to
  // the existing aggregate via an equality constraint (`sum over bodies == allVars[name]`),
  // exactly mirroring the `port_k` naming-convention pattern already used above. Every downstream
  // consumer of `allVars`/`allValues` (system scores, dependency big-M, atLeast/atMost, min/max
  // score constraints, the T2/T3 escalating-cost curve) keeps reading the same expression it
  // always did and needs zero changes. Absent/empty `input.bodies` (the common case — a user who
  // only filled in aggregate slot counts, never imported per-body journal data) skips this
  // entirely: `bodyVars` stays `{}`, no new variables or constraints are added, and every branch
  // below that reads it degrades to exactly today's behavior. Ports deliberately don't get this same
  // body dimension threaded through their `port_k` index above: doing so would multiply out to
  // `5 port building types x maxNbPorts slots x N bodies` variables, with heavy MILP symmetry (many
  // equivalent orderings of identical port slots across bodies) — not worth it when the links layer
  // can instead use the solved `portOrder` as an approximate same-tier tie-break signal.
  const bodyVars: Record<string, Record<number, string>> = {};
  if (input.bodies && input.bodies.length > 0) {
    for (const name of Object.keys(ALL_BUILDINGS)) {
      bodyVars[name] = {};
      let bodySum: LPExpr = exprConst(0);
      for (const b of input.bodies) {
        // Asteroid_Base is hard-restricted to ring/belt-eligible bodies here, in place of aggregate
        // mode's own system-wide `Asteroid_Base <= input.slots.asteroid` pseudo-pool (see below) —
        // this per-body constraint is the only one that applies once `input.bodies` is populated. A
        // ringed PLANET's own slot (as opposed to a star belt's dedicated synthetic `kind: "ring"`
        // body — see `journal/parser.ts`'s `withRingBodies`) stays an ORDINARY orbital slot that
        // merely additionally qualifies for Asteroid_Base, so it can also host any other building.
        // A star belt's own slot is different — real-game-confirmed (2026-07-28) to be
        // Asteroid_Base-EXCLUSIVE, not just Asteroid_Base-eligible — see `asteroidExclusive` below.
        let ub = name === "Asteroid_Base" && b.slots.asteroid === 0 ? 0 : DEFAULT_BUILDING_COUNT_CAP;
        if (b.asteroidExclusive && name !== "Asteroid_Base") ub = 0;
        const v = model.addVar(`${name}__body_${b.bodyId}`, "integer", 0, ub);
        bodyVars[name][b.bodyId] = v;
        bodySum = addExpr(bodySum, exprVar(v, 1));
      }
      model.addConstraint(subExpr(bodySum, allVars[name]), "==", 0, `body_split_${name}`);
    }
  }

  // --- Forced body-specific builds (see SolverInput.forcedBodyBuildings's doc comment) — a lower
  // bound on one specific (building, body) decision variable. Silently skipped when `bodyVars` has
  // no entry for the pair (an unknown building name, or a bodyId not in `input.bodies`) — same
  // defensive-no-op pattern as this file's other optional inputs; an unsatisfiable-but-well-formed
  // request (not enough capacity/points) is left to report as a real infeasible result instead.
  for (const forced of input.forcedBodyBuildings ?? []) {
    const v = bodyVars[forced.building]?.[forced.bodyId];
    if (v) model.addConstraint(exprVar(v, 1), ">=", forced.count);
  }

  // --- Already-present facility demolition (per-body only — see domain/presentFacilities.ts) ---
  // Each demolishable present facility gets a "keep" binary: 1 = still present (default-feasible
  // outcome, the solver never has to touch it), 0 = the solver chose to demolish it, refunding its
  // stat/T2/T3 contribution (below) and freeing its slot (in the capacity block below). Hard
  // present facilities (including every present port — never demolishable, see the module header)
  // get no variable at all; they're folded in as plain constants instead.
  const presentKeepVars: (PresentFacilityRef & { keepVar: string })[] = presentSplit.demolishable.map((d) => ({
    ...d,
    keepVar: model.addVar(`present_${d.bodyId}_${d.kind}_${d.index}`, "binary"),
  }));

  const allValues: Record<string, LPExpr> = { ...allVars };

  for (const h of presentSplit.hard) {
    allValues[h.building] = addExpr(allValues[h.building], exprConst(1));
  }
  for (const d of presentKeepVars) {
    allValues[d.building] = addExpr(allValues[d.building], exprVar(d.keepVar, 1));
  }
  if (
    !input.allowCriminal &&
    [...presentSplit.hard, ...presentSplit.demolishable].some(
      (f) => f.building === "Pirate_Base" || f.building === "Criminal_Outpost",
    )
  ) {
    return errorResult(
      "Error: criminal outpost or pirate base already present, but you do not want criminal outposts to be built",
    );
  }

  // T2/T3 starting balance, derived entirely from already-present facilities (never manually
  // entered — see CLAUDE.md's scope-boundary note on the System facilities panel). Hard non-port
  // facilities and present ports contribute fixed amounts; demolishable ones are scaled by their
  // `keepVar` since the solver may zero out their contribution.
  const hardSeed = computeHardNonPortSeed(presentSplit.hard);
  const portsSeed = computePresentPortsSeed(presentSplit.hard);
  let initialT2Points: LPExpr = exprConst(hardSeed.t2 + portsSeed.t2);
  let initialT3Points: LPExpr = exprConst(hardSeed.t3 + portsSeed.t3);
  for (const d of presentKeepVars) {
    const building = ALL_BUILDINGS[d.building];
    if (typeof building.T2points === "number" && building.T2points !== 0) {
      initialT2Points = addExpr(initialT2Points, exprVar(d.keepVar, building.T2points));
    }
    if (typeof building.T3points === "number" && building.T3points !== 0) {
      initialT3Points = addExpr(initialT3Points, exprVar(d.keepVar, building.T3points));
    }
  }

  // A manually-specified first station's stats must still count toward system scores (the
  // original Python did this implicitly, since its UI treated the first-station row as just
  // another "already present" entry).
  allValues[input.firstStationBuilding] = addExpr(allValues[input.firstStationBuilding], exprConst(1));

  // The primary/claim station is exempt from its own escalating port cost (it's the mandatory
  // free first station, not something the player "pays" for — confirmed against a real in-game
  // system's already-built T2/T3 balance, see presentFacilities.test.ts's `deriveCurrentPoints`
  // tests) but still contributes whatever fixed point GENERATION its building type would normally
  // provide: e.g. a Coriolis primary still grants +1 T3 point even though its own T2 cost is
  // waived; a Tier-1 Outpost primary still grants +1 T2 point (nothing to waive there, T1
  // buildings never cost points in the first place). A Tier-3-cost primary (Orbis_or_Ocellus/
  // Dodecahedron) generates nothing further either way — T3 is the terminal tier.
  const firstStationBuilding = ALL_BUILDINGS[input.firstStationBuilding];
  if (firstStationBuilding) {
    if (typeof firstStationBuilding.T2points === "number" && firstStationBuilding.T2points > 0) {
      initialT2Points = addExpr(initialT2Points, exprConst(firstStationBuilding.T2points));
    }
    if (typeof firstStationBuilding.T3points === "number" && firstStationBuilding.T3points > 0) {
      initialT3Points = addExpr(initialT3Points, exprConst(firstStationBuilding.T3points));
    }
  }

  if (!input.allowCriminal) {
    model.addConstraint(allVars.Pirate_Base, "==", 0);
    model.addConstraint(allVars.Criminal_Outpost, "==", 0);
  }

  // --- Slot capacity ---------------------------------------------------------------------
  const usedSlots = {
    space: Object.entries(ALL_BUILDINGS)
      .filter(([, b]) => b.slot === "space")
      .reduce((acc, [name]) => addExpr(acc, allVars[name]), exprConst(0)),
    ground: Object.entries(ALL_BUILDINGS)
      .filter(([, b]) => b.slot === "ground")
      .reduce((acc, [name]) => addExpr(acc, allVars[name]), exprConst(0)),
  };
  if (input.bodies && input.bodies.length > 0) {
    // Per-body capacity replaces the 3 aggregate pools below entirely in this mode. `b.slots` is
    // the body's TOTAL physical slot count (see SolverBody's doc comment) — occupied-by-already-
    // present capacity is subtracted here: hard-present facilities always occupy their slot;
    // demolishable ones do too unless the solver's `keepVar` for that slot solves to 0. The
    // primary station's body (if assigned, see SolverInput.firstStationBodyId) has its own
    // reserved orbital slot too — it's a real physical slot like any other, just fixed to the
    // chosen firstStationBuilding instead of solved for; it's already included in `hardSpaceCount`
    // below via `presentSplit.hard` (see `applyPrimaryReservation`, applied above), so it needs no
    // separate reservation term here.
    for (const b of input.bodies) {
      let spaceUsage: LPExpr = exprConst(0);
      let groundUsage: LPExpr = exprConst(0);
      for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
        const contribution = exprVar(bodyVars[name][b.bodyId], 1);
        if (building.slot === "space") spaceUsage = addExpr(spaceUsage, contribution);
        else groundUsage = addExpr(groundUsage, contribution);
      }
      let hardSpaceCount = 0;
      let hardGroundCount = 0;
      for (const h of presentSplit.hard) {
        if (h.bodyId !== b.bodyId) continue;
        if (h.kind === "space") hardSpaceCount++;
        else hardGroundCount++;
      }
      for (const d of presentKeepVars) {
        if (d.bodyId !== b.bodyId) continue;
        const contribution = exprVar(d.keepVar, 1);
        if (d.kind === "space") spaceUsage = addExpr(spaceUsage, contribution);
        else groundUsage = addExpr(groundUsage, contribution);
      }
      const blockedSpaceCount = countBlockedEmptySlots(b, "space");
      const blockedGroundCount = countBlockedEmptySlots(b, "ground");
      model.addConstraint(spaceUsage, "<=", b.slots.space - hardSpaceCount - blockedSpaceCount, `body_${b.bodyId}_space`);
      model.addConstraint(groundUsage, "<=", b.slots.ground - hardGroundCount - blockedGroundCount, `body_${b.bodyId}_ground`);
    }
  } else {
    model.addConstraint(allVars.Asteroid_Base, "<=", input.slots.asteroid);
    model.addConstraint(usedSlots.space, "<=", input.slots.space);
    model.addConstraint(usedSlots.ground, "<=", input.slots.ground);
  }

  // --- Already-present buildings, folded into allValues as constants ---------------------
  for (const [name, nb] of Object.entries(input.alreadyPresent)) {
    if (nb === 0) continue;
    if (!(name in ALL_BUILDINGS)) continue;
    allValues[name] = addExpr(allValues[name], exprConst(nb));
    if ((name === "Pirate_Base" || name === "Criminal_Outpost") && !input.allowCriminal) {
      return errorResult(
        "Error: criminal outpost or pirate base already present, but you do not want criminal outposts to be built",
      );
    }
  }

  // Already-present ports occupy the first `nbPortsAlreadyPresent` sequential slots.
  for (const slots of Object.values(portVars)) {
    for (let k = 0; k < nbPortsAlreadyPresent; k++) {
      model.addConstraint(exprVar(slots[k]), "==", 0);
    }
  }

  // --- At-least / at-most per-building constraints ----------------------------------------
  for (const [name, atLeast] of Object.entries(input.constraints?.atLeast ?? {})) {
    if (name in allValues) model.addConstraint(allValues[name], ">=", atLeast);
  }
  for (const [name, atMost] of Object.entries(input.constraints?.atMost ?? {})) {
    if (name in allValues) model.addConstraint(allValues[name], "<=", atMost);
  }

  // --- Port slot consistency: at most one port type per slot, filled sequentially --------
  for (let k = 0; k < maxNbPorts; k++) {
    const slotSum = Object.values(portVars).reduce((acc, slots) => addExpr(acc, exprVar(slots[k])), exprConst(0));
    model.addConstraint(slotSum, "<=", 1);
    if (k > nbPortsAlreadyPresent) {
      const prevSlotSum = Object.values(portVars).reduce(
        (acc, slots) => addExpr(acc, exprVar(slots[k - 1])),
        exprConst(0),
      );
      model.addConstraint(subExpr(slotSum, prevSlotSum), "<=", 0);
    }
  }

  // --- System scores -----------------------------------------------------------------------
  const systemScores: Record<Score, LPExpr> = {} as Record<Score, LPExpr>;
  const firstStationContribution: Partial<Record<Score, LPExpr>> = {};
  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    for (const score of ALL_SCORES) {
      if (score === "system_score_beta") continue;
      const statValue = building[score as keyof typeof building];
      if (typeof statValue !== "number" || statValue === 0) continue;
      const source = score === "construction_cost" ? allVars[name] : allValues[name];
      systemScores[score] = addExpr(systemScores[score] ?? exprConst(0), scaleExpr(source, statValue));

      if (
        (score in FIRST_STATION_BONUS || score in SUBSEQUENT_FACILITY_REDUCTION) &&
        name === input.firstStationBuilding
      ) {
        firstStationContribution[score] = addExpr(
          firstStationContribution[score] ?? exprConst(0),
          exprConst(statValue),
        );
      }
    }
  }
  for (const score of ALL_SCORES) {
    if (!(score in systemScores)) systemScores[score] = exprConst(0);
  }

  // Reweight: boost the claim/first station's own share, reduce everything else's.
  const reweightedScores = new Set([
    ...Object.keys(FIRST_STATION_BONUS),
    ...Object.keys(SUBSEQUENT_FACILITY_REDUCTION),
  ]) as Set<Score>;
  for (const score of reweightedScores) {
    const bonus = FIRST_STATION_BONUS[score] ?? 0;
    const reduction = SUBSEQUENT_FACILITY_REDUCTION[score] ?? 0;
    const firstStationPart = firstStationContribution[score] ?? exprConst(0);
    const subsequentPart = subExpr(systemScores[score], firstStationPart);
    systemScores[score] = addExpr(
      scaleExpr(firstStationPart, 1 + bonus),
      scaleExpr(subsequentPart, 1 - reduction),
    );
  }

  systemScores.system_score_beta = addExpr(
    addExpr(systemScores.security, systemScores.tech_level),
    addExpr(systemScores.wealth, systemScores.standard_of_living),
  );

  // --- economy_synergy / economy_preference / Forbid (per-body economy-fit + steering) -----------
  // Only meaningful in per-body mode, and only for bodies whose caller actually supplied
  // `economy` — see `SolverBody.economy`'s doc comment for the backward-compatible degrade.
  // `allEconomyBodies` is the whole-system `JournalBody[]` `computeBoostDecrease` needs for its
  // system-wide checks (resource level, black hole/white dwarf/neutron star presence) — built once
  // rather than per (building, body) pair. `knownPortBodyIds` gates the full strong-link-style
  // delta to bodies that actually have (or will certainly have) a port — see the header comment's
  // "One thing this term does NOT get to ignore" paragraph for why. `economy_preference`/Forbid
  // reuse this exact same (building, body) loop and `facilityBaseEconomies` lookup — see
  // `SolverInput.economyPreferences`'s doc comment for why this stays a separate score from
  // `economy_synergy` rather than folded into it.
  systemScores.economy_synergy = exprConst(0);
  systemScores.economy_preference = exprConst(0);
  if (input.bodies && input.bodies.length > 0) {
    const rawEconomyBodies: JournalBody[] = input.bodies
      .map((b) => b.economy)
      .filter((b): b is JournalBody => b !== undefined);
    // Real per-body detected data always wins; only fills the gap (a system with no per-body
    // `reserveLevel` at all) with the manual override, defaulting to Pristine when the caller
    // doesn't set one — see `SolverInput.systemResourceLevel`'s doc comment.
    const allEconomyBodies = applyManualResourceLevel(rawEconomyBodies, input.systemResourceLevel ?? "pristine");

    const knownPortBodyIds = new Set<number>(
      presentSplit.hard.filter((f) => isPortRole(f.building)).map((f) => f.bodyId),
    );
    if (input.firstStationBodyId !== undefined) knownPortBodyIds.add(input.firstStationBodyId);

    function economySynergyCoefficient(buildingName: string, body: SolverBody): number {
      if (!body.economy) return 0;
      const economies = facilityBaseEconomies(buildingName, body.economy);
      if (economies.length === 0) return 0;
      if (!knownPortBodyIds.has(body.bodyId)) {
        // No confirmed port here — at best a weak link forms elsewhere, unaffected by this body's
        // own attributes (per CLAUDE.md's verbatim link rules), so no boost/decrease applies here.
        return economies.length * WEAK_LINK_CONTRIBUTION;
      }
      const { deltas } = computeBoostDecrease(body.economy, allEconomyBodies, economies);
      return economies.reduce((sum, economy) => sum + (deltas[economy] ?? 0), 0);
    }

    const preferences = input.economyPreferences;

    let synergy: LPExpr = exprConst(0);
    let preference: LPExpr = exprConst(0);
    for (const name of Object.keys(ALL_BUILDINGS)) {
      for (const b of input.bodies) {
        const synergyCoeff = economySynergyCoefficient(name, b);
        if (synergyCoeff !== 0) {
          synergy = addExpr(synergy, scaleExpr(exprVar(bodyVars[name][b.bodyId], 1), synergyCoeff));
        }

        if (!preferences || !b.economy) continue;
        const economies = facilityBaseEconomies(name, b.economy);
        if (economies.length === 0) continue;
        const v = bodyVars[name][b.bodyId];
        for (const economy of economies) {
          const pref = preferences[economy];
          if (pref === undefined) continue;
          if (pref === "forbid") {
            // Zeroing every carrying (building, body) var is enough even for ports: the pre-
            // existing `body_split_<name>` equality constraint (bodySum == allVars[name]) forces
            // the building's aggregate/port_k variables to 0 too once every body's slot is zeroed.
            model.addConstraint(exprVar(v, 1), "==", 0, `forbid_${economy}_${name}_${b.bodyId}`);
          } else {
            const coefficient = ((pref - 50) / 50) * ECONOMY_PREFERENCE_MAGNITUDE;
            if (coefficient !== 0) {
              preference = addExpr(preference, scaleExpr(exprVar(v, 1), coefficient));
            }
          }
        }
      }
    }
    systemScores.economy_synergy = synergy;
    systemScores.economy_preference = preference;
  }

  // --- Objective -----------------------------------------------------------------------------
  const objectiveVar = model.addVar("objective", "continuous", -INFINITY, INFINITY);
  let direction: Direction;
  let objectiveExpr: LPExpr;
  let auxVarsFromObjective: string[] = [];
  if (input.objective.kind === "custom") {
    direction = input.objective.direction;
    const scoreExprs = Object.fromEntries(
      (Object.keys(SCORE_LETTER_TO_SCORE) as ScoreLetter[]).map((letter) => [
        letter,
        systemScores[SCORE_LETTER_TO_SCORE[letter]],
      ]),
    ) as Record<ScoreLetter, LPExpr>;
    const varBounds = model.varBounds();
    const scoreBounds = Object.fromEntries(
      (Object.keys(SCORE_LETTER_TO_SCORE) as ScoreLetter[]).map((letter) => [
        letter,
        boundExpr(scoreExprs[letter], varBounds) as ScoreBounds,
      ]),
    ) as Record<ScoreLetter, ScoreBounds>;
    let compiled: ReturnType<typeof compileObjective>;
    try {
      compiled = compileObjective(input.objective.expression, direction, scoreExprs, scoreBounds);
    } catch (e) {
      return errorResult(`Error when computing objective: ${(e as Error).message}`);
    }
    objectiveExpr = compiled.linear;
    auxVarsFromObjective = compiled.auxVars;
    for (const v of compiled.auxVars) model.addVar(v, "continuous", -INFINITY, INFINITY);
    for (const c of compiled.auxConstraints) {
      model.addConstraint(c.expr, c.sense, 0, c.name);
    }
  } else {
    direction = input.objective.score === "construction_cost" ? "minimize" : "maximize";
    objectiveExpr = systemScores[input.objective.score];
  }
  model.addConstraint(subExpr(exprVar(objectiveVar, 1), objectiveExpr), "==", 0, "objective_link");
  model.setObjective(exprVar(objectiveVar, 1), direction);

  // --- Min/max score constraints --------------------------------------------------------------
  for (const score of ALL_SCORES) {
    const min = input.scoreConstraints?.min?.[score];
    const max = input.scoreConstraints?.max?.[score];
    if (min !== undefined) model.addConstraint(systemScores[score], ">=", min);
    if (max !== undefined) model.addConstraint(systemScores[score], "<=", max);
  }

  // --- Construction-point constraints (escalating port cost) ---------------------------------
  let nonPortT2Cp = initialT2Points;
  let nonPortT3Cp = initialT3Points;
  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    if (isPort(building)) continue;
    const t2 = building.T2points;
    const t3 = building.T3points;
    if (typeof t2 === "number" && t2 !== 0) nonPortT2Cp = addExpr(nonPortT2Cp, exprVar(name, t2));
    if (typeof t3 === "number" && t3 !== 0) nonPortT3Cp = addExpr(nonPortT3Cp, exprVar(name, t3));
  }

  let portsT2Running: LPExpr = exprConst(0);
  let portsT3Running: LPExpr = exprConst(0);
  let t3FromT2PortsRunning: LPExpr = exprConst(0);
  let finalT2Expr: LPExpr = exprConst(0);
  let finalT3Expr: LPExpr = exprConst(0);
  for (let k = 0; k < maxNbPorts; k++) {
    let t2PortSlotSum: LPExpr = exprConst(0);
    let t3PortSlotSum: LPExpr = exprConst(0);
    let t3FromT2PortSlotSum: LPExpr = exprConst(0);
    for (const [name, slots] of Object.entries(portVars)) {
      const building = ALL_BUILDINGS[name];
      if (building.T2points === "port") t2PortSlotSum = addExpr(t2PortSlotSum, exprVar(slots[k], 1));
      if (building.T3points === "port") t3PortSlotSum = addExpr(t3PortSlotSum, exprVar(slots[k], 1));
      if (building.T3points !== "port" && building.T3points !== 0) {
        t3FromT2PortSlotSum = addExpr(t3FromT2PortSlotSum, exprVar(slots[k], building.T3points));
      }
    }
    portsT2Running = addExpr(portsT2Running, scaleExpr(t2PortSlotSum, getT2PortCost(k)));
    portsT3Running = addExpr(portsT3Running, scaleExpr(t3PortSlotSum, getT3PortCost(k)));
    t3FromT2PortsRunning = addExpr(t3FromT2PortsRunning, t3FromT2PortSlotSum);

    finalT2Expr = subExpr(nonPortT2Cp, portsT2Running);
    finalT3Expr = subExpr(addExpr(t3FromT2PortsRunning, nonPortT3Cp), portsT3Running);
    model.addConstraint(finalT2Expr, ">=", 0, `t2cp_${k}`);
    model.addConstraint(finalT3Expr, ">=", 0, `t3cp_${k}`);
  }

  // --- Dependencies, as big-M reformulations of the original's indicator constraints --------
  const uniqueDependencies = new Set<string>();
  for (const building of Object.values(ALL_BUILDINGS)) {
    if (building.dependencies.length > 0) uniqueDependencies.add(JSON.stringify(building.dependencies));
  }
  const anyPositiveByDeps = new Map<string, LPExpr>();
  let indicatorCounter = 0;
  for (const depsJson of uniqueDependencies) {
    const deps = JSON.parse(depsJson) as string[];
    const individualVars = deps.map((name) => {
      const indicName = model.addVar(`indic_${indicatorCounter++}_${name}`, "binary");
      // indic=1 => allValues[name] >= 1  (big-M: allValues[name] - M*indic >= 1 - M)
      model.addConstraint(subExpr(allValues[name], exprVar(indicName, DEPENDENCY_BIG_M)), ">=", 1 - DEPENDENCY_BIG_M);
      return { name, indicName };
    });
    let anyPositive: LPExpr;
    if (individualVars.length === 1) {
      anyPositive = exprVar(individualVars[0].indicName, 1);
    } else {
      const anyPositiveVar = model.addVar(`any_positive_${indicatorCounter++}`, "binary");
      for (const { indicName } of individualVars) {
        model.addConstraint(subExpr(exprVar(anyPositiveVar, 1), exprVar(indicName, 1)), ">=", 0);
      }
      const sumIndic = individualVars.reduce((acc, { indicName }) => addExpr(acc, exprVar(indicName, 1)), exprConst(0));
      // anyPositive=1 => sum(indic) >= 1  (M=1 is exact here: sum ranges over [0, count])
      model.addConstraint(subExpr(sumIndic, exprVar(anyPositiveVar, 1)), ">=", 0);
      anyPositive = exprVar(anyPositiveVar, 1);
    }
    anyPositiveByDeps.set(depsJson, anyPositive);
  }
  for (const [targetName, targetBuilding] of Object.entries(ALL_BUILDINGS)) {
    if (targetBuilding.dependencies.length === 0) continue;
    const depsJson = JSON.stringify(targetBuilding.dependencies);
    const anyPositive = anyPositiveByDeps.get(depsJson)!;
    const indicator2 = model.addVar(`indic2_${targetName}`, "binary");
    // indicator2 == 1 - anyPositive
    model.addConstraint(addExpr(exprVar(indicator2, 1), anyPositive), "==", 1);
    // indicator2=1 => allValues[target] <= 0  (big-M: allValues[target] + M*indicator2 <= M)
    model.addConstraint(
      addExpr(allValues[targetName], exprVar(indicator2, DEPENDENCY_BIG_M)),
      "<=",
      DEPENDENCY_BIG_M,
    );
  }

  // --- Solve -----------------------------------------------------------------------------------
  // The `highs` package ships its ~3.4MB WASM binary as a separate file (subpath export
  // "highs/runtime"); in the browser it has no way to find it on its own (the bundled highs.js is
  // a raw Emscripten build, not authored for bundlers), so locateFile points it at the URL Vite
  // resolves for the fingerprinted asset. Under a real Node process (plain tests, or component
  // tests running under jsdom — jsdom polyfills `window` but still runs inside real Node) skip this
  // and let the Emscripten loader use its own default same-directory filesystem lookup instead: a
  // "?url" import resolves to a dev-server-relative path there, not a real filesystem path, and
  // Emscripten's own Node-vs-browser detection (not `typeof window`) decides whether it reads the
  // file via fs or fetches it, so a jsdom check on `window` alone picks the wrong branch here.
  const { default: loadHighs } = await import("highs");
  const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  let highs: Awaited<ReturnType<typeof loadHighs>>;
  if (nodeProcess?.versions?.node) {
    highs = await loadHighs();
  } else {
    const { default: highsWasmUrl } = await import("highs/runtime?url");
    highs = await loadHighs({ locateFile: () => highsWasmUrl });
  }
  const lpText = model.toLPFormat();
  const solved = highs.solve(lpText, { output_flag: false });

  if (solved.Status === "Infeasible") {
    return {
      ...errorResult("Error: There is no possible system arrangement that can fit the conditions you have specified"),
      status: "infeasible",
    };
  }
  if (solved.Status !== "Optimal") {
    return errorResult(`Error: solver returned status "${solved.Status}"`);
  }

  const colValues: Record<string, number> = {};
  for (const [name, col] of Object.entries(solved.Columns)) {
    colValues[name] = (col as { Primal: number }).Primal;
  }

  const toBuild: Record<string, number> = {};
  for (const name of Object.keys(ALL_BUILDINGS)) {
    const value = Math.round(evalExprAt(allVars[name], colValues));
    if (value > 0) toBuild[name] = value;
  }

  const portOrder: string[] = [];
  for (let k = nbPortsAlreadyPresent; k < maxNbPorts; k++) {
    for (const [name, slots] of Object.entries(portVars)) {
      if (Math.round(colValues[slots[k]] ?? 0) >= 1) portOrder.push(name);
    }
  }

  const firstStation: string = input.firstStationBuilding;

  const placements: BuildingPlacement[] = [];
  let firstStationBodyId: number | null = null;
  if (input.bodies && input.bodies.length > 0) {
    for (const name of Object.keys(ALL_BUILDINGS)) {
      for (const b of input.bodies) {
        const count = Math.round(colValues[bodyVars[name][b.bodyId]] ?? 0);
        if (count > 0) placements.push({ building: name, bodyId: b.bodyId, count });
      }
    }
    if (input.firstStationBodyId !== undefined) {
      placements.push({ building: firstStation, bodyId: input.firstStationBodyId, count: 1 });
      firstStationBodyId = input.firstStationBodyId;
    }
  }

  const scores = Object.fromEntries(
    ALL_SCORES.map((score) => [score, Math.round(evalExprAt(systemScores[score], colValues))]),
  ) as Record<Score, number>;
  // Recompute the compound score from the rounded base scores for display consistency.
  scores.system_score_beta = computeCompoundScore("system_score_beta", scores);

  const demolished = presentKeepVars
    .filter((d) => Math.round(colValues[d.keepVar] ?? 1) === 0)
    .map((d) => ({ bodyId: d.bodyId, slotKind: d.kind, index: d.index, building: d.building }));

  // `usedSlots`/`allVars.Asteroid_Base` only ever count NEWLY-built units (they're the raw
  // decision-variable sums, not `allValues`) — fine on their own for the per-body CAPACITY
  // CONSTRAINT above (which separately subtracts present/primary occupancy from each body's own
  // bound), but wrong for this REPORTED remaining-capacity figure if used bare: in per-body mode it
  // silently ignored every already-present facility and the primary station's reserved slot, so a
  // fully-built system still reported dozens of "slots left" — a real bug, since those slots are
  // actually occupied and shouldn't be reported as remaining capacity.
  // Aggregate mode's own formula is intentionally left untouched below (protected by
  // solve.test.ts's `bodies: []` vs. omitted byte-identical regression test) — `presentSplit`/
  // `presentKeepVars` are always empty there anyway, so the per-body-only terms below are all 0 and
  // this reduces to exactly aggregate mode's own formula.
  const presentOccupiedSpace =
    presentSplit.hard.filter((f) => f.kind === "space").length +
    presentKeepVars.filter((d) => d.kind === "space" && Math.round(colValues[d.keepVar] ?? 1) === 1).length +
    (input.bodies ?? []).reduce((sum, b) => sum + countBlockedEmptySlots(b, "space"), 0);
  const presentOccupiedGround =
    presentSplit.hard.filter((f) => f.kind === "ground").length +
    presentKeepVars.filter((d) => d.kind === "ground" && Math.round(colValues[d.keepVar] ?? 1) === 1).length +
    (input.bodies ?? []).reduce((sum, b) => sum + countBlockedEmptySlots(b, "ground"), 0);
  const totalSpaceSlots =
    input.bodies && input.bodies.length > 0 ? input.bodies.reduce((sum, b) => sum + b.slots.space, 0) : input.slots.space;
  const totalGroundSlots =
    input.bodies && input.bodies.length > 0 ? input.bodies.reduce((sum, b) => sum + b.slots.ground, 0) : input.slots.ground;

  // Counts a body's "leave empty" markers (see `SolverBody.blockedSlots`'s doc comment) that
  // actually reduce usable capacity: an index only counts once it's confirmed empty in
  // `presentFacilities` too, so a stale/conflicting entry (blocked AND built at the same index)
  // can never double-subtract.
  function countBlockedEmptySlots(b: SolverBody, kind: "space" | "ground"): number {
    const blocked = b.blockedSlots?.[kind] ?? [];
    const present = b.presentFacilities?.[kind] ?? [];
    let count = 0;
    for (let i = 0; i < blocked.length; i++) {
      if (blocked[i] && !present[i]) count++;
    }
    return count;
  }

  // Ring-eligible ("asteroid-eligible") orbital slots are a SUBSET of ordinary orbital slots (any
  // orbital slot on a body with slots.asteroid > 0), not a separate pool — see
  // JournalBody.slots.asteroid's doc comment / computeSystemSlotTotals. Counting only NEW
  // Asteroid_Base builds against the pool size would undercount occupancy by every OTHER building
  // (present or new) sitting on a ring-eligible body's orbital slots — contradictorily reporting
  // asteroid slots free while plain orbital slots (a superset) were already all used up.
  // `bodySpaceOccupied` avoids this by mirroring the per-body capacity constraint above
  // (new + present-hard [which already includes the primary's own synced entry, see
  // `applyPrimaryReservation`] + present-kept-demolishable) for one specific body.
  function bodySpaceOccupied(b: SolverBody): number {
    let used = 0;
    for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
      if (building.slot !== "space") continue;
      used += Math.round(colValues[bodyVars[name][b.bodyId]] ?? 0);
    }
    used += presentSplit.hard.filter((f) => f.bodyId === b.bodyId && f.kind === "space").length;
    used += presentKeepVars.filter(
      (d) => d.bodyId === b.bodyId && d.kind === "space" && Math.round(colValues[d.keepVar] ?? 1) === 1,
    ).length;
    used += countBlockedEmptySlots(b, "space");
    return used;
  }
  const totalAsteroidEligibleSlots =
    input.bodies && input.bodies.length > 0
      ? input.bodies.filter((b) => b.slots.asteroid > 0).reduce((sum, b) => sum + b.slots.space, 0)
      : input.slots.asteroid;
  const occupiedAsteroidEligibleSlots =
    input.bodies && input.bodies.length > 0
      ? input.bodies.filter((b) => b.slots.asteroid > 0).reduce((sum, b) => sum + bodySpaceOccupied(b), 0)
      : Math.round(evalExprAt(allVars.Asteroid_Base, colValues));

  void auxVarsFromObjective; // present in the model for completeness; not surfaced individually

  return {
    status: "optimal",
    toBuild,
    portOrder,
    firstStation,
    scores,
    finalT2Points: Math.round(evalExprAt(finalT2Expr, colValues)),
    finalT3Points: Math.round(evalExprAt(finalT3Expr, colValues)),
    slotsRemaining: {
      space: totalSpaceSlots - presentOccupiedSpace - Math.round(evalExprAt(usedSlots.space, colValues)),
      ground: totalGroundSlots - presentOccupiedGround - Math.round(evalExprAt(usedSlots.ground, colValues)),
      asteroid: totalAsteroidEligibleSlots - occupiedAsteroidEligibleSlots,
    },
    objectiveValue: evalExprAt(exprVar(objectiveVar, 1), colValues),
    placements,
    firstStationBodyId,
    demolished,
  };
}
