// Turns a solved plan into one flat, numbered, step-by-step ledger for BuildOrderPanel.tsx: every
// physical facility instance (already built, marked for demolition, or newly planned) as one row,
// in build order, with a running T2/T3 point total. The table's whole point is to be an order the
// player can actually execute in-game — so every "add" step (Built or Planned) is sequenced and
// costed via `domain/systemState.ts`'s `SystemState`/`domain/ordering.ts`'s `computeFeasibleOrder`,
// the SAME per-tier-separate, canBuild-gated machinery `getOrderingFromResult` already uses for the
// "Solved system" panel's new-build order numbers — never `solve.ts`'s own internal MILP formula.
// This is a deliberate choice, not an oversight: `solve.ts`'s new-port cost model uses a single
// SHARED counter across all 5 port types (a documented, deliberately-left conservative
// approximation — see CLAUDE.md's gotcha on `solve.ts`'s `t2PortSlotSum`/`t3PortSlotSum` loop), and
// its per-k feasibility constraints test an AGGREGATE condition ("if every non-port contribution is
// available up front, does paying for k+1 ports in some order keep you non-negative"), not a real
// step-by-step SEQUENCE — replaying that formula in build order can dip the running total negative
// even when a real, executable order exists. `computeFeasibleOrder`'s per-tier math is what
// actually GUARANTEES a build order is executable (it only ever inserts a building once `canBuild`
// says the current balance affords it) — matching `BuildOrderPanel`/`SolvedSystemPanel`'s existing
// precedent of treating `ordering.ts`'s own computed order as authoritative for display, never
// `solve.ts`'s raw internal port assignment (see CLAUDE.md's "Port placement fidelity is
// deliberately approximate" note). Consequence: this table's final T2/T3 running total is generally
// >= `result.finalT2Points`/`finalT3Points`, not exactly equal — `solve.ts`'s numbers are a
// conservative lower bound, not the "true" cost of a real, executable sequence.
//
// A demolished present facility is real, physically-standing-today infrastructure — it must show up
// as a real Built row (contributing its full stat/T2/T3, same as any other present facility) BEFORE
// its own Demolish row subtracts that same contribution back out — a build order that dips below 0
// is one a player literally cannot execute, since you always have whatever your currently-standing
// facilities already generated banked before you tear anything down. Built rows are sourced from
// EVERY present facility (`formState.bodies`' own `presentFacilities`, hard AND demolishable alike),
// sequenced via its own `computeFeasibleOrder` pass so THIS section is also guaranteed non-negative
// on its own.
//
// Demolish and Planned rows are NOT simply "all demolishes, then all planned builds" — that naive
// fixed order can force the running total negative when demolishing several point-generating
// facilities before building anything to replace them, even though demolition itself is never
// blocked by insufficient points in the real game (points are *refunded* on demolition, per
// CLAUDE.md's demolition-mechanics notes — the deficit is purely an artifact of this table's own
// display order, not something a real player would be forced into: clamping the running Total at 0
// to hide a negative dip would just make the per-row Delta and the Total disagree instead of fixing
// anything). Handled by `scheduleDemolishAndPlanned` (below): it interleaves Demolish and Planned
// rows, deferring any demolish that would currently go negative until a Planned row has grown the
// balance back up, using `SystemState.canDemolish`/`removeBuilding` (the demolish-side counterparts
// to `canBuild`/`addBuilding`).
//
// `domain/solvedPlacement.ts`'s `computeSolvedPlacements` is still reused for the Planned section's
// body/slot seating (which empty slot each new unit lands in) and its own already-validated
// `newBuildOrder` (from `getOrderingFromResult`) — that part was never the problem, only the T2/T3
// cost formula and row ordering applied on top of it were.

import { ALL_BUILDINGS, BASE_SCORES, isPort, type BaseScore, type Building } from "../data/buildings";
import { getOrderingFromResult, computeFeasibleOrder } from "./ordering";
import { normalizeFacilitySlots, presentBuildOrderHint, sortDeterministic } from "./presentFacilities";
import { computeSolvedPlacements } from "./solvedPlacement";
import { SystemState } from "./systemState";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";

export type BuildOrderRowState = "built" | "demolish" | "planned";

export interface BuildOrderPointDelta {
  score: BaseScore;
  delta: number;
}

export interface BuildOrderRow {
  nr: number;
  state: BuildOrderRowState;
  /** The primary/claim station's own row — flagged so the UI can call it out distinctly (it's
   * always the very first thing built, exempt from its own port-escalation cost). */
  isPrimary?: boolean;
  bodyId?: number;
  bodyName?: string;
  slotLabel?: string;
  building: string;
  nickname?: string;
  variant?: string;
  pointDeltas: BuildOrderPointDelta[];
  t2Delta: number;
  t3Delta: number;
  t2Total: number;
  t3Total: number;
}

export interface BuildOrderTableResult {
  rows: BuildOrderRow[];
  error: string | null;
}

const SLOT_LABELS: Record<"space" | "ground", string> = { space: "Orbital", ground: "Ground" };
const DISPLAYABLE_SCORES = BASE_SCORES.filter((s) => s !== "construction_cost");

function scoreDeltas(building: Building, sign: 1 | -1): BuildOrderPointDelta[] {
  return DISPLAYABLE_SCORES.filter((s) => building[s] !== 0).map((s) => ({ score: s, delta: sign * building[s] }));
}

interface PresentInstance {
  bodyId: number;
  kind: "space" | "ground";
  index: number;
  nickname?: string;
  variant?: string;
}

/** Every present facility (hard AND demolishable alike — see this module's header comment),
 * grouped by building name into a queue in canonical body/slot order (`sortDeterministic`, the same
 * tie-break `presentFacilities.ts`'s cost-seeding functions use) — consumed one instance at a time
 * as `computeValidatedBuiltOrder`'s name sequence is replayed, so each Built row gets a real,
 * specific body/slot/nickname/variant instead of just a building name. Excludes the primary
 * station's own synced entry (`PresentFacilitySlot.primary`) — it gets its own dedicated Built row
 * from `computeBuildOrderTable`'s `formState.firstStationBuilding` branch instead (using the flat
 * fields directly, real source of truth), so leaving it in this queue would risk a later real
 * instance of the SAME building type popping the primary's own slot/nickname by mistake. */
function presentInstanceQueues(formState: PlannerFormState): Map<string, PresentInstance[]> {
  const flat: (PresentInstance & { building: string })[] = [];
  for (const body of formState.bodies) {
    (["space", "ground"] as const).forEach((kind) => {
      const count = body.slots?.[kind] ?? 0;
      normalizeFacilitySlots(body.presentFacilities?.[kind], count).forEach((slot, index) => {
        if (slot && !slot.primary) flat.push({ bodyId: body.bodyId, kind, index, nickname: slot.customName, variant: slot.variant, building: slot.building });
      });
    });
  }
  const queues = new Map<string, PresentInstance[]>();
  for (const { building, ...instance } of sortDeterministic(flat)) {
    if (!queues.has(building)) queues.set(building, []);
    queues.get(building)!.push(instance);
  }
  return queues;
}

/** A validated (`computeFeasibleOrder`-gated, never-negative-guaranteeing) build order for EVERY
 * present facility, hard and demolishable alike — a fresh, disposable `SystemState` just to derive
 * this name sequence (the real per-row replay happens separately in `computeBuildOrderTable`, on
 * its own live state, so its running totals can be captured step by step). `firstStationBuilding` is
 * passed to `computeFeasibleOrder` so the scratch feasibility check seeds the primary itself (via
 * `SystemState.addFirstStation`'s own cost exemption) with the same starting budget the real replay
 * will have — its own entry in the returned order is then sliced off since the caller injects the
 * primary as its own separate synthetic row (same slice-off pattern `computeBuildOrderTable`'s
 * aggregate-mode branch below uses too). `presentBuildOrderHint`'s `excludePrimary: true` keeps the
 * primary's own real, synced `presentFacilities` entry (`PresentFacilitySlot.primary`) OUT of
 * `names`/`ports` here — without it, that entry would double up with the `firstStationBuilding`
 * seed above; for an escalating-cost port type like Coriolis (unlike a flat-cost Outpost), the
 * extra unaccounted-for port pushes `computeFeasibleOrder`'s scratch run negative. */
function computeValidatedBuiltOrder(formState: PlannerFormState): string[] {
  const bodies = formState.bodies.map((b) => ({ bodyId: b.bodyId, space: b.presentFacilities?.space ?? [], ground: b.presentFacilities?.ground ?? [] }));
  const names = presentBuildOrderHint(bodies, { excludePrimary: true });
  const facilities: Record<string, number> = {};
  const ports: string[] = [];
  for (const name of names) {
    if (isPort(ALL_BUILDINGS[name])) ports.push(name);
    else facilities[name] = (facilities[name] ?? 0) + 1;
  }
  const scratch = new SystemState();
  const order = computeFeasibleOrder(scratch, facilities, ports, formState.firstStationBuilding || null);
  return formState.firstStationBuilding ? order.slice(1) : order;
}

interface PlannedCandidate {
  bodyId: number;
  kind: "space" | "ground";
  index: number;
  building: string;
  order: number;
}

interface DemolishItem {
  building: string;
  bodyId: number;
  kind: "space" | "ground";
  index: number;
}

/** Planned (new-build) AND Demolish items, both derived from the SAME `computeSolvedPlacements`
 * call (same data `SolvedSystemPanel` renders) — its `newBuildOrder` (from `getOrderingFromResult`)
 * is itself a validated, never-negative-guaranteeing sequence, so only the seating/ordering is
 * reused here; the actual T2/T3 cost is recomputed by the caller's own `SystemState` replay.
 * Deliberately NOT sourcing `demolished` from raw `result.demolished` separately (an earlier version
 * of this function did) — `computeSolvedPlacements` reclassifies a same-building demolish+rebuild
 * pair to `"present"` (see `solvedPlacement.ts`'s header comment), and deriving both lists from its
 * ONE output is what guarantees this table can never show an orphaned Demolish row with no matching
 * rebuild (or vice versa) for a pair the tree already cancelled. */
function collectPlannedAndDemolishItems(
  formState: PlannerFormState,
  result: SolverResult,
): { planned: PlannedCandidate[]; demolished: DemolishItem[] } {
  const planResult = toPlanResult(formState, result);
  const newBuildOrder = getOrderingFromResult(planResult, true, false);
  const { byBody } = computeSolvedPlacements(formState.bodies, result, newBuildOrder);

  const planned: PlannedCandidate[] = [];
  const demolished: DemolishItem[] = [];
  for (const [bodyId, slots] of byBody) {
    (["space", "ground"] as const).forEach((kind) => {
      slots[kind].forEach((slot, index) => {
        if (slot.status === "new" || slot.status === "demolished-rebuilt") {
          planned.push({ bodyId, kind, index, building: slot.building, order: slot.order });
        }
        if (slot.status === "demolished") {
          demolished.push({ bodyId, kind, index, building: slot.building });
        } else if (slot.status === "demolished-rebuilt") {
          demolished.push({ bodyId, kind, index, building: slot.demolishedBuilding });
        }
      });
    });
  }
  return { planned: planned.sort((a, b) => a.order - b.order), demolished };
}

/** Chooses a real, executable interleaving of Demolish and Planned rows instead of the naive "all
 * demolishes, then all planned builds" order — demolishing several point-generating facilities
 * before building anything to replace them can force the running T2/T3 total negative even though
 * a real player could simply build a replacement first (see this file's header comment). At each
 * step, prefers any remaining demolish that's currently safe (`replay.canDemolish` — won't take T2
 * or T3 negative); only once NONE are currently safe does it reach for a Planned candidate that's
 * both affordable (`replay.canBuild`) and not waiting on a same-slot demolish that hasn't happened
 * yet (a `"demolished-rebuilt"` slot's rebuild needs its own demolish first — the slot is
 * physically occupied until then; see `solvedPlacement.ts`'s `SolvedSlot` — a plain `(bodyId, kind,
 * index)` match against `remainingDemolish` is sufficient to detect this without threading the
 * slot's status through, since a `"new"` candidate's location, by construction, never coincides
 * with anything in the `demolished` list `collectPlannedAndDemolishItems` derives).
 *
 * Never regresses a case that already worked: this is strictly a superset of "do the first
 * eligible item next" — since `findIndex` scans front-to-back, whenever today's given order was
 * already safe at every step, that's exactly the order this picks too; it only starts reordering
 * once the given order would otherwise go negative. `onDemolish`/`onPlanned` are the ONLY things
 * that mutate `replay` (via the caller's `pushDemolish`/`pushAdd`) — `canDemolish`/`canBuild` here
 * are pure reads used only to choose which item goes next, so there's no double-mutation risk.
 *
 * Throws if nothing is currently eligible but items remain — a genuine scheduling deadlock,
 * surfaced via `computeBuildOrderTable`'s existing try/catch (same established precedent as
 * `ordering.ts`'s `computeFeasibleOrder` "Could not finish ordering"), not a new failure mode. */
function scheduleDemolishAndPlanned(
  replay: SystemState,
  demolishItems: DemolishItem[],
  plannedItems: PlannedCandidate[],
  onDemolish: (item: DemolishItem) => void,
  onPlanned: (item: PlannedCandidate) => void,
): void {
  const remainingDemolish = [...demolishItems];
  const remainingPlanned = [...plannedItems];

  const isBlockedBySameSlotDemolish = (p: PlannedCandidate): boolean =>
    remainingDemolish.some((d) => d.bodyId === p.bodyId && d.kind === p.kind && d.index === p.index);

  while (remainingDemolish.length > 0 || remainingPlanned.length > 0) {
    const di = remainingDemolish.findIndex((d) => replay.canDemolish(d.building));
    if (di !== -1) {
      const [d] = remainingDemolish.splice(di, 1);
      onDemolish(d);
      continue;
    }
    const pi = remainingPlanned.findIndex((p) => !isBlockedBySameSlotDemolish(p) && replay.canBuild(p.building));
    if (pi !== -1) {
      const [p] = remainingPlanned.splice(pi, 1);
      onPlanned(p);
      continue;
    }
    throw new Error("Could not schedule demolish/build order without going negative");
  }
}

export function computeBuildOrderTable(formState: PlannerFormState, result: SolverResult): BuildOrderTableResult {
  try {
    const hasBodies = formState.bodies.length > 0;
    const bodyNameById = new Map(formState.bodies.map((b) => [b.bodyId, b.bodyName]));
    function describe(bodyId: number, kind: "space" | "ground", index: number): { bodyId?: number; bodyName?: string; slotLabel?: string } {
      if (!hasBodies) return {};
      return { bodyId, bodyName: bodyNameById.get(bodyId) ?? `Body ${bodyId}`, slotLabel: `${SLOT_LABELS[kind]} ${index + 1}` };
    }

    const replay = new SystemState();
    const rows: BuildOrderRow[] = [];
    let nr = 0;

    function pushAdd(
      rowState: "built" | "planned",
      building: string,
      isPrimary: boolean,
      loc?: { bodyId: number; kind: "space" | "ground"; index: number },
      nickname?: string,
      variant?: string,
    ): void {
      const t2Before = replay.T2points;
      const t3Before = replay.T3points;
      const scoresBefore = { ...replay.scores };
      if (isPrimary) replay.addFirstStation(building);
      else replay.addBuilding(building, 1);
      nr += 1;
      rows.push({
        nr,
        state: rowState,
        ...(isPrimary ? { isPrimary: true } : {}),
        ...(loc ? describe(loc.bodyId, loc.kind, loc.index) : {}),
        building,
        nickname,
        variant,
        pointDeltas: DISPLAYABLE_SCORES.filter((s) => replay.scores[s] !== scoresBefore[s]).map((s) => ({ score: s, delta: replay.scores[s] - scoresBefore[s] })),
        t2Delta: replay.T2points - t2Before,
        t3Delta: replay.T3points - t3Before,
        t2Total: replay.T2points,
        t3Total: replay.T3points,
      });
    }

    function pushDemolish(building: string, loc: { bodyId: number; kind: "space" | "ground"; index: number }): void {
      const b = ALL_BUILDINGS[building];
      const t2Delta = typeof b.T2points === "number" ? -b.T2points : 0;
      const t3Delta = typeof b.T3points === "number" ? -b.T3points : 0;
      // Demolished facilities are never ports (see CLAUDE.md's scope-boundary note), so
      // `removeBuilding`'s flat, non-escalating subtraction is always correct here.
      replay.removeBuilding(building);
      // NOT floored at 0 (an earlier version of this code did that, hiding the real number) —
      // Delta and Total must stay honest with each other. Going negative here shouldn't happen in
      // practice now: `scheduleDemolishAndPlanned` (below) only ever calls this once
      // `replay.canDemolish(building)` was confirmed true for the CURRENT state, deferring any
      // demolish that would otherwise force a real point deficit until a Planned row has grown the
      // balance back up first.
      nr += 1;
      rows.push({
        nr,
        state: "demolish",
        ...describe(loc.bodyId, loc.kind, loc.index),
        building,
        pointDeltas: scoreDeltas(b, -1),
        t2Delta,
        t3Delta,
        t2Total: replay.T2points,
        t3Total: replay.T3points,
      });
    }

    if (formState.firstStationBuilding) {
      // The primary always occupies Orbital 1 (space index 0) on its assigned body — same
      // convention as `PresentFacilitySlot.primary`'s synced entry — so Body/Slot can be shown
      // here too, not just left blank, whenever a body is actually assigned.
      const primaryLoc =
        formState.firstStationBodyId !== undefined
          ? { bodyId: formState.firstStationBodyId, kind: "space" as const, index: 0 }
          : undefined;
      pushAdd("built", formState.firstStationBuilding, true, primaryLoc, formState.firstStationCustomName, formState.firstStationVariant);
    }

    if (hasBodies) {
      const builtOrder = computeValidatedBuiltOrder(formState);
      const queues = presentInstanceQueues(formState);
      for (const name of builtOrder) {
        const instance = queues.get(name)?.shift();
        pushAdd("built", name, false, instance, instance?.nickname, instance?.variant);
      }

      const { planned, demolished } = collectPlannedAndDemolishItems(formState, result);
      scheduleDemolishAndPlanned(
        replay,
        demolished,
        planned,
        (d) => pushDemolish(d.building, d),
        (p) => pushAdd("planned", p.building, false, p),
      );
    } else {
      // Aggregate mode (no per-body layout applied) — no body/slot/nickname data exists at all (see
      // CLAUDE.md's "Backward compatibility is load-bearing" note), and demolition is a per-body-
      // slot-only feature (`result.demolished` is always empty here), so there is no Demolish
      // section. Built/Planned still come from `computeFeasibleOrder`'s own validated sequence
      // (`getAlreadyPresent`/`getSolution`, via `getOrderingFromResult`), replayed the same way.
      const planResult = toPlanResult(formState, result);
      const newBuildOrder = getOrderingFromResult(planResult, true, false);
      const scratch = new SystemState();
      const builtOrderFull = computeFeasibleOrder(
        scratch,
        planResult.already_present ?? {},
        (planResult["already_present.ports"] ?? []).flatMap(([name, nb]) => Array(nb).fill(name) as string[]),
        formState.firstStationBuilding || null,
      );
      const builtOrder = formState.firstStationBuilding ? builtOrderFull.slice(1) : builtOrderFull;
      for (const name of builtOrder) pushAdd("built", name, false);
      for (const name of newBuildOrder) pushAdd("planned", name, false);
    }

    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}
