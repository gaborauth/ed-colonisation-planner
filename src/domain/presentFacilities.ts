// What's already built in a system today, entered by the user slot-by-slot in the System
// facilities panel (never derived from Journal Scan data — the Journal has no construction-
// progress events, see CLAUDE.md's scope boundaries). This is a pure, solver-decoupled module
// (mirrors links.ts's post-solve-computation precedent) so the trickiest bit — the deterministic
// already-present-port historical-cost ordering below — is independently testable, and so solve.ts
// doesn't have to absorb all of this inline.
//
// Two kinds of already-present facility:
//  - "hard": always present, can never be removed by the solver. Every already-present PORT (the 5
//    escalating-cost-curve buildings from `isPort()`) is always hard regardless of its stored
//    `demolishable` flag — ports are deliberately excluded from this feature's demolition mechanic
//    (see CLAUDE.md's scope-boundary note: untangling the escalating cost curve's build-order
//    dependence for a removable port isn't worth the complexity; settlements/hubs/installations are
//    the actually useful case).
//  - "demolishable": the solver may choose to remove it (via a `present_*` binary in solve.ts),
//    refunding its stat/T2/T3 contribution and freeing its slot, if replacing it scores better.

import { ALL_BUILDINGS, getT2PortCost, getT3PortCost, isPort } from "../data/buildings";
import type { PresentFacilitySlot } from "../journal/parser";

export type { PresentFacilitySlot } from "../journal/parser";

export interface PresentFacilitiesBody {
  bodyId: number;
  space: (PresentFacilitySlot | null)[];
  ground: (PresentFacilitySlot | null)[];
}

export interface PresentFacilityRef {
  bodyId: number;
  kind: "space" | "ground";
  index: number;
  building: string;
}

interface FlatPresentFacility extends PresentFacilityRef {
  demolishable: boolean;
}

export interface PresentSplit {
  hard: PresentFacilityRef[];
  demolishable: PresentFacilityRef[];
}

export interface PresentSeed {
  t2: number;
  t3: number;
}

/** Pads/truncates a facility-slot array to exactly `count` entries (short arrays get `null`-filled,
 * long ones truncated) — used both by the tree UI (rendering one leaf per physical slot) and by
 * `App.tsx`'s solver-input construction, since a body's slot count can change after facilities were
 * already marked (e.g. the user edits Journal Import's slot count down). */
export function normalizeFacilitySlots(
  slots: (PresentFacilitySlot | null)[] | undefined,
  count: number,
): (PresentFacilitySlot | null)[] {
  const base = slots ?? [];
  const result: (PresentFacilitySlot | null)[] = [];
  for (let i = 0; i < count; i++) result.push(base[i] ?? null);
  return result;
}

function flatten(bodies: PresentFacilitiesBody[]): FlatPresentFacility[] {
  const flat: FlatPresentFacility[] = [];
  for (const body of bodies) {
    body.space.forEach((slot, index) => {
      if (slot) flat.push({ bodyId: body.bodyId, kind: "space", index, building: slot.building, demolishable: slot.demolishable });
    });
    body.ground.forEach((slot, index) => {
      if (slot) flat.push({ bodyId: body.bodyId, kind: "ground", index, building: slot.building, demolishable: slot.demolishable });
    });
  }
  return flat;
}

/** Deterministic ordering for facilities with no real recorded build order: by body, space before
 * ground, then slot index. Only affects `computePresentPortsSeed` below (non-port facilities have
 * fixed per-unit T2/T3 costs, order-independent) — flagged as an approximation, same spirit as
 * `links.ts`'s "ties broken by build order" tie-break. */
function sortDeterministic<T extends { bodyId: number; kind: "space" | "ground"; index: number }>(refs: T[]): T[] {
  return [...refs].sort((a, b) => {
    if (a.bodyId !== b.bodyId) return a.bodyId - b.bodyId;
    if (a.kind !== b.kind) return a.kind === "space" ? -1 : 1;
    return a.index - b.index;
  });
}

/** Flat building-name -> count aggregate of every already-present facility (hard AND demolishable
 * alike — this doesn't know about any particular solve's demolish decision, it's just "what's
 * marked in the tree"). Used for display (`BuildingsTable`) and pre-solve build-order purposes
 * (`state/toPlanResult.ts` / `domain/ordering.ts`) when per-body placement is in use. */
export function derivePresentCounts(bodies: PresentFacilitiesBody[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ref of flatten(bodies)) {
    counts[ref.building] = (counts[ref.building] ?? 0) + 1;
  }
  return counts;
}

/** Splits every already-present facility into "hard" (always kept) vs "demolishable" (solver may
 * remove it). See the module header for why ports always land in `hard`. */
export function splitPresentFacilities(bodies: PresentFacilitiesBody[]): PresentSplit {
  const hard: PresentFacilityRef[] = [];
  const demolishable: PresentFacilityRef[] = [];
  for (const { demolishable: wantsDemolish, ...ref } of flatten(bodies)) {
    const building = ALL_BUILDINGS[ref.building];
    if (building && wantsDemolish && !isPort(building)) {
      demolishable.push(ref);
    } else {
      hard.push(ref);
    }
  }
  return { hard, demolishable };
}

/** Non-port present facilities' T2/T3 seed contribution — pass the `hard` list from
 * `splitPresentFacilities` (present ports are always in `hard` too, but contribute 0 here; see
 * `computePresentPortsSeed` for their cost, which depends on curve position, not a fixed stat). */
export function computeHardNonPortSeed(hard: PresentFacilityRef[]): PresentSeed {
  let t2 = 0;
  let t3 = 0;
  for (const ref of hard) {
    const building = ALL_BUILDINGS[ref.building];
    if (!building || isPort(building)) continue;
    if (typeof building.T2points === "number") t2 += building.T2points;
    if (typeof building.T3points === "number") t3 += building.T3points;
  }
  return { t2, t3 };
}

/** T2/T3 points already consumed (or generated) by already-present ports, computed by walking them
 * in deterministic build-order (see `sortDeterministic`) through the same escalating cost curve
 * `solve.ts` charges new ports (`getT2PortCost`/`getT3PortCost`) — mirrors solve.ts's per-slot-index
 * loop, just against already-present ports instead of solver decision variables. Pass the `hard`
 * list from `splitPresentFacilities` (ports are always hard). Approximate — see module header. */
export function computePresentPortsSeed(hard: PresentFacilityRef[]): PresentSeed {
  const ports = sortDeterministic(hard).filter((ref) => isPort(ALL_BUILDINGS[ref.building]));
  let t2 = 0;
  let t3 = 0;
  ports.forEach((ref, i) => {
    const building = ALL_BUILDINGS[ref.building];
    if (building.T2points === "port") t2 += getT2PortCost(i);
    if (building.T3points === "port") t3 += getT3PortCost(i);
    else if (typeof building.T3points === "number" && building.T3points !== 0) t3 += building.T3points;
  });
  return { t2, t3 };
}
