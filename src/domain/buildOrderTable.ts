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
// even when a real, executable order exists (real bug found 2026-07-27, reproduced with
// `jsons/swoilz-aw-c-d52.json`: the table showed a below-zero T2 mid-sequence even though a valid,
// always-non-negative build order was available). `computeFeasibleOrder`'s per-tier math is what
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
// its own Demolish row subtracts that same contribution back out (real bug fixed 2026-07-26/27, user
// report: marking present facilities demolishable made them vanish from Built entirely instead of
// appearing there first, undercounting the Built total and driving the running T2 negative — a build
// order that dips below 0 is one a player literally cannot execute, since you always have whatever
// your currently-standing facilities already generated banked before you tear anything down). Built
// rows are sourced from EVERY present facility (`formState.bodies`' own `presentFacilities`, hard AND
// demolishable alike), sequenced via its own `computeFeasibleOrder` pass so THIS section is also
// guaranteed non-negative on its own; Demolish rows (from `result.demolished`) subtract afterward.
//
// `domain/solvedPlacement.ts`'s `computeSolvedPlacements` is still reused for the Planned section's
// body/slot seating (which empty slot each new unit lands in) and its own already-validated
// `newBuildOrder` (from `getOrderingFromResult`) — that part was never the problem, only the T2/T3
// cost formula applied on top of it was.

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
 * specific body/slot/nickname/variant instead of just a building name. */
function presentInstanceQueues(formState: PlannerFormState): Map<string, PresentInstance[]> {
  const flat: (PresentInstance & { building: string })[] = [];
  for (const body of formState.bodies) {
    (["space", "ground"] as const).forEach((kind) => {
      const count = body.slots?.[kind] ?? 0;
      normalizeFacilitySlots(body.presentFacilities?.[kind], count).forEach((slot, index) => {
        if (slot) flat.push({ bodyId: body.bodyId, kind, index, nickname: slot.customName, variant: slot.variant, building: slot.building });
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
 * included so the scratch feasibility check has the same starting budget the real replay will (the
 * primary generates real T2/T3 other present facilities may depend on) — its own entry is then
 * sliced off since the caller injects the primary as its own separate synthetic row (same slice-off
 * pattern `computeBuildOrderTable`'s aggregate-mode branch below uses too). */
function computeValidatedBuiltOrder(formState: PlannerFormState): string[] {
  const bodies = formState.bodies.map((b) => ({ bodyId: b.bodyId, space: b.presentFacilities?.space ?? [], ground: b.presentFacilities?.ground ?? [] }));
  const names = presentBuildOrderHint(bodies);
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

/** Planned (new-build) candidates, body/slot-seated via the already-tested `computeSolvedPlacements`
 * (same data `SolvedSystemPanel` renders) — its `newBuildOrder` (from `getOrderingFromResult`) is
 * itself a validated, never-negative-guaranteeing sequence, so only the seating/ordering is reused
 * here; the actual T2/T3 cost is recomputed by the caller's own `SystemState` replay. */
function collectPlannedCandidates(formState: PlannerFormState, result: SolverResult): PlannedCandidate[] {
  const planResult = toPlanResult(formState, result);
  const newBuildOrder = getOrderingFromResult(planResult, true, false);
  const { byBody } = computeSolvedPlacements(formState.bodies, result, newBuildOrder);

  const planned: PlannedCandidate[] = [];
  for (const [bodyId, slots] of byBody) {
    (["space", "ground"] as const).forEach((kind) => {
      slots[kind].forEach((slot, index) => {
        if (slot.status === "new" || slot.status === "demolished-rebuilt") {
          planned.push({ bodyId, kind, index, building: slot.building, order: slot.order });
        }
      });
    });
  }
  return planned.sort((a, b) => a.order - b.order);
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
      // Demolished facilities are never ports (see CLAUDE.md's scope-boundary note), so this is
      // always a flat, non-escalating subtraction — mutating `SystemState`'s public T2/T3 fields
      // directly (it has no `removeBuilding`) so the Planned section's subsequent `addBuilding`
      // calls continue from a running total that correctly reflects the freed-up slot/points.
      const t2Delta = typeof b.T2points === "number" ? -b.T2points : 0;
      const t3Delta = typeof b.T3points === "number" ? -b.T3points : 0;
      replay.T2points += t2Delta;
      replay.T3points += t3Delta;
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
      pushAdd("built", formState.firstStationBuilding, true, undefined, formState.firstStationCustomName, formState.firstStationVariant);
    }

    if (hasBodies) {
      const builtOrder = computeValidatedBuiltOrder(formState);
      const queues = presentInstanceQueues(formState);
      for (const name of builtOrder) {
        const instance = queues.get(name)?.shift();
        pushAdd("built", name, false, instance, instance?.nickname, instance?.variant);
      }

      for (const d of result.demolished) {
        pushDemolish(d.building, { bodyId: d.bodyId, kind: d.slotKind, index: d.index });
      }

      for (const c of collectPlannedCandidates(formState, result)) {
        pushAdd("planned", c.building, false, { bodyId: c.bodyId, kind: c.kind, index: c.index });
      }
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
