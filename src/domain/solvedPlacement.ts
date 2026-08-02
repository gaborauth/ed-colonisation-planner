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
//
// `buildKindSlots`'s "demolished-rebuilt" case additionally special-cases the SAME-building
// sub-case (`newBuilding.building === demolished.building`): demolishing a slot only to rebuild the
// identical building type there is real wasted in-game construction cost for zero net benefit
// (same stats/T2/T3 either way) — a pure artifact of this module's own arbitrary, deterministic
// seating order (`takeNext`'s alphabetical-by-`ALL_BUILDINGS`-key first-fit) coincidentally pairing
// a freed slot with a same-type unit from the new-build pool, not a deliberate solver
// recommendation. Reclassified to plain `"present"` instead (see `buildKindSlots`'s own comment) —
// this is deliberately a DISPLAY-layer fix, not a `SolverResult`/`solve.ts` change: `result.toBuild`/
// `result.placements`/`result.demolished` are left untouched. Known, accepted trade-off: in the
// (fairly rare) case where a same-building collision is genuinely unavoidable given the solver's
// own picks, `BuildingsTable.tsx`'s `toBuild`-sourced "Built" column can read 1 higher than what's
// actually visible as newly built in this tree, and a "build #N" sequence can show a small gap (a
// number silently absorbed by the now-hidden slot) — both purely cosmetic, not a wasted-commodity
// recommendation anymore, and not worth the added complexity of also correcting `SolverResult`
// itself for. `domain/buildOrderTable.ts`'s `computeBuildOrderTable` derives its own Demolish AND
// Planned rows from this SAME function's output (not from raw `result.demolished` separately) so
// the two panels can't disagree about which pairs got cancelled.

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
  /** Body IDs to visit BEFORE the rest (still each group in its own `compareBodyNames` order) when
   * seating newly-built units and consuming `newBuildOrder`'s per-building-name position queue —
   * see `domain/selfSufficiencyCombos.ts`'s `computeForcedBuildingPriority` doc comment. Without
   * this, an earlier-alphabetically body with its own unrelated same-type build would claim the
   * early build-order numbers instead of the actually-prioritized body. */
  priorityBodyIds?: Set<number>,
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
  const sortedBodies = [...bodies].sort((a, b) => {
    if (priorityBodyIds) {
      const aPriority = priorityBodyIds.has(a.bodyId) ? 0 : 1;
      const bPriority = priorityBodyIds.has(b.bodyId) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
    }
    return compareBodyNames(a, b);
  });

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
      if (demolished && newBuilding && newBuilding.building === demolished.building) {
        // Same-building demolish+rebuild collision — see this module's header comment. Treat it as
        // never touched instead: same status/fields as an ordinary "present" slot, carrying forward
        // the original nickname/variant since nothing's actually changing. The new-build unit is
        // still consumed from the pool above (via `takeNext`, already done) so this doesn't leave a
        // phantom "nowhere to seat this" warning.
        slots.push({ status: "present", building: newBuilding.building, nickname: slot?.customName, variant: slot?.variant });
      } else if (demolished && newBuilding) {
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
