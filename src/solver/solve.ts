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

import {
  ALL_BUILDINGS,
  ALL_SCORES,
  type Score,
  computeCompoundScore,
  getT2PortCost,
  getT3PortCost,
  isPort,
} from "../data/buildings";
import type { BuildingPlacement } from "../domain/links";
import {
  computeHardNonPortSeed,
  computePresentPortsSeed,
  splitPresentFacilities,
  type PresentFacilitiesBody,
  type PresentFacilityRef,
  type PresentFacilitySlot,
} from "../domain/presentFacilities";
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

// SOURCED: Dodec Update patch notes (2025-11-11), "Balanced how building certain facilities
// affects system development level, security, standard of living, tech level, and wealth." The
// claim/first station's own contribution to these five scores is BOOSTED by FIRST_STATION_BONUS;
// every other facility's contribution (already-present or newly built) is REDUCED by
// SUBSEQUENT_FACILITY_REDUCTION. This replaced an earlier "unverified, best-known figures"
// version of this constant that used a single full-weight-vs-fraction split with different
// (guessed) magnitudes — the official numbers differ substantially for some scores (e.g.
// development_level's subsequent-facility reduction is only -10%, not the previously-guessed -60%)
// and add a first-station bonus the old version didn't model at all.
// Population increase and construction cost are not listed as affected and stay full-weight.
const FIRST_STATION_BONUS: Partial<Record<Score, number>> = {
  development_level: 0.4, // +40%
  security: 0.4, // +40%
  standard_of_living: 0.4, // +40%
  tech_level: 0.2, // +20%
  wealth: 0.4, // +40%
};
const SUBSEQUENT_FACILITY_REDUCTION: Partial<Record<Score, number>> = {
  development_level: 0.1, // -10%
  security: 0.1, // -10%
  standard_of_living: 0.2, // -20%
  tech_level: 0.25, // -25%
  wealth: 0.25, // -25%
};

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
 * `eligibility.ts` estimates and what Journal Import's table edits) — NOT "remaining capacity" as
 * an earlier version of this doc comment said. `solve.ts` now computes remaining capacity itself:
 * total minus whatever `presentFacilities` occupies (see "--- Already-present facilities" below),
 * so the caller no longer needs to manually pre-subtract already-built stuff. */
export interface SolverBody {
  bodyId: number;
  slots: SlotAvailability;
  /** What's already built in this body's slots — see `domain/presentFacilities.ts`'s header for
   * the hard-vs-demolishable distinction. Absent/undefined arrays are treated as "all empty". */
  presentFacilities?: {
    space: (PresentFacilitySlot | null)[];
    ground: (PresentFacilitySlot | null)[];
  };
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
}

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
  const presentBodies: PresentFacilitiesBody[] = (input.bodies ?? []).map((b) => ({
    bodyId: b.bodyId,
    space: b.presentFacilities?.space ?? [],
    ground: b.presentFacilities?.ground ?? [],
  }));
  const presentSplit = splitPresentFacilities(presentBodies);

  const nbPortsAlreadyPresent =
    input.bodies && input.bodies.length > 0
      ? presentSplit.hard.filter((f) => isPort(ALL_BUILDINGS[f.building])).length
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
  // below that reads it degrades to exactly today's behavior. See the plan's Decision 1 for why
  // ports don't get a body dimension threaded through their `port_k` index specifically (approx.
  // same-tier tie-break in the links layer instead of exact fidelity here).
  const bodyVars: Record<string, Record<number, string>> = {};
  if (input.bodies && input.bodies.length > 0) {
    for (const name of Object.keys(ALL_BUILDINGS)) {
      bodyVars[name] = {};
      let bodySum: LPExpr = exprConst(0);
      for (const b of input.bodies) {
        // Asteroid_Base is hard-restricted to ring/belt-eligible bodies here, replacing the old
        // system-wide `Asteroid_Base <= input.slots.asteroid` pseudo-pool entirely in this mode.
        const ub = name === "Asteroid_Base" && b.slots.asteroid === 0 ? 0 : DEFAULT_BUILDING_COUNT_CAP;
        const v = model.addVar(`${name}__body_${b.bodyId}`, "integer", 0, ub);
        bodyVars[name][b.bodyId] = v;
        bodySum = addExpr(bodySum, exprVar(v, 1));
      }
      model.addConstraint(subExpr(bodySum, allVars[name]), "==", 0, `body_split_${name}`);
    }
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
    // primary station's body (if assigned, see SolverInput.firstStationBodyId) has one further
    // orbital slot reserved for it, on top of whatever's already present — it's a real physical
    // slot like any other, just fixed to the chosen firstStationBuilding instead of solved for.
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
      const firstStationReservation = b.bodyId === input.firstStationBodyId ? 1 : 0;
      model.addConstraint(
        spaceUsage,
        "<=",
        b.slots.space - hardSpaceCount - firstStationReservation,
        `body_${b.bodyId}_space`,
      );
      model.addConstraint(groundUsage, "<=", b.slots.ground - hardGroundCount, `body_${b.bodyId}_ground`);
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
      space: input.slots.space - Math.round(evalExprAt(usedSlots.space, colValues)),
      ground: input.slots.ground - Math.round(evalExprAt(usedSlots.ground, colValues)),
      asteroid: input.slots.asteroid - Math.round(evalExprAt(allVars.Asteroid_Base, colValues)),
    },
    objectiveValue: evalExprAt(exprVar(objectiveVar, 1), colValues),
    placements,
    firstStationBodyId,
    demolished,
  };
}
