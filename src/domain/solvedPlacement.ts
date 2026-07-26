// Turns a solved SolverResult back into a per-body, per-physical-slot picture — "what does the
// system look like once every empty slot the solver chose to fill is actually filled, in what
// order" — for SolvedSystemPanel.tsx's read-only tree (a solved-state sibling of
// SystemConfigPanel.tsx's editable "Actual facilities in the system" tree). Unlike domain/links.ts
// and domain/ordering.ts (deliberately solver-shape-agnostic, adapted via state/toPlanResult.ts),
// this module imports `SolverResult` directly — it exists specifically to visualize one solve's
// placements/build order/demolitions together, so decoupling from that shape would only add an
// adapter with no other caller.
//
// `result.placements` (see solve.ts) only says "N new units of building X landed on body Y" — not
// which physical slot index. This module assigns them deterministically: for each body (visited in
// natural-name order), each physical slot in index order, the first newly-solved-for building of a
// matching slot kind still waiting in that body's pool. The primary station's own reservation
// (orbital slot 0 on its assigned body) is excluded from that pool — it's a fixed input, not
// something the solver "placed" via `placements`' ordinary loop-derived entries (see
// `result.placements`'s doc comment in solve.ts for why the primary's entry is a separate +1).
//
// Build-order numbers come from `domain/ordering.ts`'s existing `getOrderingFromResult` (seeded
// with already-present state via `SystemState.addResult`, so its per-building T2/T3 feasibility
// check — `SystemState.canBuild` — already guarantees a number never implies going T2/T3-negative),
// called with `withAlreadyPresent: false` so only newly-built buildings get order numbers at all —
// already-present facilities keep showing as "Built" (see SolvedSystemPanel.tsx), same as they do
// in the "Actual facilities" tree.

import { ALL_BUILDINGS } from "../data/buildings";
import { normalizeFacilitySlots } from "./presentFacilities";
import { compareBodyNames, type JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";

export type SolvedSlot =
  | { status: "empty" }
  | { status: "primary" }
  | { status: "present"; building: string; nickname?: string; variant?: string }
  | { status: "new"; building: string; order: number }
  | { status: "demolished"; building: string }
  | { status: "demolished-rebuilt"; demolishedBuilding: string; building: string; order: number };

export interface SolvedBodySlots {
  space: SolvedSlot[];
  ground: SolvedSlot[];
}

export interface SolvedPlacementsResult {
  byBody: Map<number, SolvedBodySlots>;
  /** Newly-solved-for units that couldn't be seated in any empty slot on their placement's body —
   * not expected in steady state (the solver's own per-body capacity constraint should make this
   * impossible when `bodies`/`result` come from the same solve), but surfaced rather than silently
   * dropped or thrown, in case the caller passes a stale `bodies` layout relative to `result`. */
  warnings: string[];
}

function poolKey(bodyId: number, building: string): string {
  return `${bodyId} ${building}`;
}

export function computeSolvedPlacements(
  bodies: JournalBody[],
  result: SolverResult,
  newBuildOrder: string[],
): SolvedPlacementsResult {
  const warnings: string[] = [];

  // (bodyId, building) -> how many genuinely-new (non-primary) units still need a slot.
  const pool = new Map<string, number>();
  for (const p of result.placements) {
    if (p.count <= 0) continue;
    const isPrimaryEntry = p.building === result.firstStation && p.bodyId === result.firstStationBodyId;
    const count = isPrimaryEntry ? p.count - 1 : p.count;
    if (count > 0) {
      const k = poolKey(p.bodyId, p.building);
      pool.set(k, (pool.get(k) ?? 0) + count);
    }
  }

  // building -> queue of 1-based positions in the build order, consumed front-to-back as slots are
  // seated below (so the k-th body/slot needing building X gets the k-th occurrence of X in the
  // order — order doesn't say which body, only how many/which sequence).
  const positions = new Map<string, number[]>();
  newBuildOrder.forEach((name, i) => {
    if (!positions.has(name)) positions.set(name, []);
    positions.get(name)!.push(i + 1);
  });
  function nextOrder(building: string): number {
    const list = positions.get(building);
    return list && list.length > 0 ? list.shift()! : -1;
  }

  function takeNext(bodyId: number, kind: "space" | "ground"): { building: string; order: number } | null {
    for (const name of Object.keys(ALL_BUILDINGS)) {
      if (ALL_BUILDINGS[name].slot !== kind) continue;
      const k = poolKey(bodyId, name);
      const remaining = pool.get(k) ?? 0;
      if (remaining > 0) {
        pool.set(k, remaining - 1);
        return { building: name, order: nextOrder(name) };
      }
    }
    return null;
  }

  const byBody = new Map<number, SolvedBodySlots>();
  const sortedBodies = [...bodies].sort(compareBodyNames);

  function buildKindSlots(body: JournalBody, kind: "space" | "ground"): SolvedSlot[] {
    const count = body.slots?.[kind] ?? 0;
    const present = normalizeFacilitySlots(body.presentFacilities?.[kind], count);
    const slots: SolvedSlot[] = [];
    for (let index = 0; index < count; index++) {
      if (kind === "space" && index === 0 && body.bodyId === result.firstStationBodyId) {
        slots.push({ status: "primary" });
        continue;
      }
      const slot = present[index];
      const demolished = result.demolished.find(
        (d) => d.bodyId === body.bodyId && d.slotKind === kind && d.index === index,
      );
      if (slot && !demolished) {
        slots.push({ status: "present", building: slot.building, nickname: slot.customName, variant: slot.variant });
        continue;
      }
      const newBuilding = takeNext(body.bodyId, kind);
      if (demolished && newBuilding) {
        slots.push({
          status: "demolished-rebuilt",
          demolishedBuilding: demolished.building,
          building: newBuilding.building,
          order: newBuilding.order,
        });
      } else if (demolished) {
        slots.push({ status: "demolished", building: demolished.building });
      } else if (newBuilding) {
        slots.push({ status: "new", building: newBuilding.building, order: newBuilding.order });
      } else {
        slots.push({ status: "empty" });
      }
    }
    return slots;
  }

  for (const body of sortedBodies) {
    byBody.set(body.bodyId, {
      space: buildKindSlots(body, "space"),
      ground: buildKindSlots(body, "ground"),
    });
  }

  for (const [k, remaining] of pool) {
    if (remaining > 0) {
      const [bodyIdStr, building] = k.split(" ");
      warnings.push(`${remaining}x ${building} solved for body ${bodyIdStr} but no empty slot was found there.`);
    }
  }

  return { byBody, warnings };
}
