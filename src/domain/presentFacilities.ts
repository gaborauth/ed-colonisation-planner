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
import type { JournalBody, PresentFacilitySlot } from "../journal/parser";

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

export interface SlotUsage {
  built: number;
  free: number;
  total: number;
}

export interface SystemSlotUsage {
  space: SlotUsage;
  ground: SlotUsage;
  /** The subset of `space` that sits on a ring-eligible ("asteroid-eligible") body — not a
   * separate slot pool, same idea as `JournalBody.slots.asteroid`/`computeSystemSlotTotals`'s
   * `totals.asteroid` (see journal/parser.ts): an ordinary orbital slot that also happens to be
   * able to host an Asteroid_Base. */
  asteroidEligibleSpace: SlotUsage;
}

export interface SlotUsageBody extends PresentFacilitiesBody {
  /** Mirrors `(JournalBody.slots.asteroid ?? 0) > 0` — whether this body's orbital slots count
   * toward the asteroid-eligible subset. */
  asteroidEligible: boolean;
}

/** How many of the system's total slots (from `computeSystemSlotTotals`) are already built vs
 * free, per the "System facilities" tree the user fills in by hand — same "built" definition as
 * `derivePresentCounts` (every marked facility counts, demolishable or not; this isn't about any
 * particular solve's demolish decision). The primary station consumes a real orbital slot on its
 * assigned body but is never itself an entry in `presentFacilities` (see solve.ts's
 * `firstStationReservation`), so it's counted here as a separate +1 rather than missed entirely. */
export function deriveSlotUsage(
  bodies: SlotUsageBody[],
  totals: { space: number; ground: number; asteroid: number },
  firstStationBodyId: number | undefined,
): SystemSlotUsage {
  let builtSpace = 0;
  let builtGround = 0;
  let builtAsteroidSpace = 0;
  for (const body of bodies) {
    const spaceBuilt = body.space.filter((slot) => slot !== null).length;
    builtSpace += spaceBuilt;
    builtGround += body.ground.filter((slot) => slot !== null).length;
    if (body.asteroidEligible) builtAsteroidSpace += spaceBuilt;
  }
  const firstStationBody = bodies.find((b) => b.bodyId === firstStationBodyId);
  if (firstStationBody) {
    builtSpace += 1;
    if (firstStationBody.asteroidEligible) builtAsteroidSpace += 1;
  }
  const usage = (total: number, built: number): SlotUsage => ({
    built,
    free: Math.max(0, total - built),
    total,
  });
  return {
    space: usage(totals.space, builtSpace),
    ground: usage(totals.ground, builtGround),
    asteroidEligibleSpace: usage(totals.asteroid, builtAsteroidSpace),
  };
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
 * in deterministic build-order (see `sortDeterministic`) through the escalating cost curve
 * (`getT2PortCost`/`getT3PortCost`). Returns a properly-signed net contribution — the escalating
 * cost SUBTRACTS (a port is a cost, same sign convention as a non-port T2-tier building's negative
 * `T2points`/`T3points`), while a fixed generation (e.g. Coriolis's T3points=1) still ADDS. This
 * used to add the escalating cost instead of subtracting it — a serious bug (present ports were
 * silently *inflating* the available T2/T3 budget instead of consuming it) caught by comparing
 * against a real in-game system's already-built balance (see this function's tests). Tier-2-cost
 * ports (Coriolis, Asteroid_Base) and Tier-3-cost ports (Orbis_or_Ocellus, Dodecahedron,
 * Planetary_Port) each escalate along their OWN sequence — `t2Index`/`t3Index` below track them
 * separately rather than sharing one counter (also confirmed against that same real system: a
 * T2-cost port built before a T3-cost port didn't push the T3-cost port past its own
 * first-of-type price). Pass the `hard` list from `splitPresentFacilities` (ports are always
 * hard). */
export function computePresentPortsSeed(hard: PresentFacilityRef[]): PresentSeed {
  const ports = sortDeterministic(hard).filter((ref) => isPort(ALL_BUILDINGS[ref.building]));
  let t2 = 0;
  let t3 = 0;
  let t2Index = 0;
  let t3Index = 0;
  for (const ref of ports) {
    const building = ALL_BUILDINGS[ref.building];
    if (building.T2points === "port") {
      t2 -= getT2PortCost(t2Index);
      t2Index++;
    }
    if (building.T3points === "port") {
      t3 -= getT3PortCost(t3Index);
      t3Index++;
    } else if (typeof building.T3points === "number" && building.T3points !== 0) {
      t3 += building.T3points;
    }
  }
  return { t2, t3 };
}

/** The system's current T2/T3 point balance right now — every already-built facility contributes
 * its full stat, demolishable or not. This differs deliberately from `solve.ts`'s own seed (which
 * feeds `computeHardNonPortSeed`/`computePresentPortsSeed` only the `hard` list, since the solver
 * may zero out a demolishable facility's contribution if it chooses to remove it): nothing has
 * actually been torn down in the real game yet, so a facility merely flagged "demolishable" (a
 * future possibility) still counts toward the balance the user actually has today. Ports are
 * always hard already (never demolishable in this app — see the module header), so
 * `computePresentPortsSeed` needs no change here.
 *
 * `firstStationBuilding` (optional — pass `formState.firstStationBuilding`, `""`/undefined is fine
 * before one's picked) adds the primary/claim station's own contribution: it's exempt from its own
 * escalating port cost (the mandatory free first station isn't something the player "pays" for —
 * see solve.ts's matching `initialT2Points`/`initialT3Points` adjustment) but still contributes
 * whatever fixed point GENERATION its building type would normally provide — e.g. a Coriolis
 * primary still grants +1 T3 point even though its own T2 cost is waived; a Tier-1 Outpost primary
 * still grants +1 T2 point (nothing to waive there, T1 buildings never cost points). Confirmed
 * against a real in-game system's already-built balance — see this function's tests. */
export function deriveCurrentPoints(bodies: PresentFacilitiesBody[], firstStationBuilding?: string): PresentSeed {
  const { hard, demolishable } = splitPresentFacilities(bodies);
  const nonPortSeed = computeHardNonPortSeed([...hard, ...demolishable]);
  const portsSeed = computePresentPortsSeed(hard);
  let t2 = nonPortSeed.t2 + portsSeed.t2;
  let t3 = nonPortSeed.t3 + portsSeed.t3;
  const primary = firstStationBuilding ? ALL_BUILDINGS[firstStationBuilding] : undefined;
  if (primary) {
    if (typeof primary.T2points === "number" && primary.T2points > 0) t2 += primary.T2points;
    if (typeof primary.T3points === "number" && primary.T3points > 0) t3 += primary.T3points;
  }
  return { t2, t3 };
}

/** Maps `JournalBody[]` (the state/journal layer's shape) down to the minimal shape
 * `deriveSlotUsage`/`deriveCurrentPoints` need — shared by `SystemConfigPanel` and
 * `SystemPortabilityBar` so both read "what's built" the exact same way. */
export function toSlotUsageBodies(bodies: JournalBody[]): SlotUsageBody[] {
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    space: b.presentFacilities?.space ?? [],
    ground: b.presentFacilities?.ground ?? [],
    asteroidEligible: (b.slots?.asteroid ?? 0) > 0,
  }));
}
