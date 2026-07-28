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
import type { BuildingPlacement } from "./links";
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
  /** Mirrors `PresentFacilitySlot.primary` — see that field's doc comment. */
  primary?: boolean;
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

/** Same pad/truncate convention as `normalizeFacilitySlots` above, for the parallel `blockedSlots`
 * boolean arrays (see `JournalBody.blockedSlots`'s doc comment) — a body's slot count can change
 * after some slots were already marked "leave empty", same reason `normalizeFacilitySlots` exists. */
export function normalizeBlockedSlots(blocked: boolean[] | undefined, count: number): boolean[] {
  const base = blocked ?? [];
  const result: boolean[] = [];
  for (let i = 0; i < count; i++) result.push(base[i] ?? false);
  return result;
}

function flatten(bodies: PresentFacilitiesBody[]): FlatPresentFacility[] {
  const flat: FlatPresentFacility[] = [];
  for (const body of bodies) {
    body.space.forEach((slot, index) => {
      if (slot) {
        flat.push({ bodyId: body.bodyId, kind: "space", index, building: slot.building, demolishable: slot.demolishable, primary: slot.primary });
      }
    });
    body.ground.forEach((slot, index) => {
      if (slot) {
        flat.push({ bodyId: body.bodyId, kind: "ground", index, building: slot.building, demolishable: slot.demolishable, primary: slot.primary });
      }
    });
  }
  return flat;
}

/** Deterministic ordering for facilities with no real recorded build order: by body, space before
 * ground, then slot index. Only affects `computePresentPortsSeed` below (non-port facilities have
 * fixed per-unit T2/T3 costs, order-independent) — flagged as an approximation, same spirit as
 * `links.ts`'s "ties broken by build order" tie-break. Exported so `domain/buildOrderTable.ts` can
 * reuse the exact same tie-break for its "Built"/"Demolish" row ordering instead of re-implementing
 * it — those rows' T2/T3 port-escalation math must match this canonical order precisely. */
export function sortDeterministic<T extends { bodyId: number; kind: "space" | "ground"; index: number }>(refs: T[]): T[] {
  return [...refs].sort((a, b) => {
    if (a.bodyId !== b.bodyId) return a.bodyId - b.bodyId;
    if (a.kind !== b.kind) return a.kind === "space" ? -1 : 1;
    return a.index - b.index;
  });
}

/** Flat building-name -> count aggregate of every already-present facility (hard AND demolishable
 * alike — this doesn't know about any particular solve's demolish decision, it's just "what's
 * marked in the tree"). Used for display (`BuildingsTable`, where the primary's own synced entry —
 * see `PresentFacilitySlot.primary` — SHOULD show up, fixing a real display gap) and pre-solve
 * build-order purposes (`state/toPlanResult.ts` / `domain/ordering.ts`) when per-body placement is
 * in use. Pass `excludePrimary: true` wherever the caller ALREADY separately accounts for the
 * primary's own contribution with its own different rules (e.g. `computeCurrentSystemScores`'s own
 * bonus-vs-reduction split, or `domain/systemState.ts`'s `addFirstStation` cost exemption via
 * `toPlanResult.ts`'s `first_station` field) — including it here too would double-count it. */
export function derivePresentCounts(bodies: PresentFacilitiesBody[], options?: { excludePrimary?: boolean }): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ref of flatten(bodies)) {
    if (options?.excludePrimary && ref.primary) continue;
    counts[ref.building] = (counts[ref.building] ?? 0) + 1;
  }
  return counts;
}

/** Per-(body, building) instance counts, in `domain/links.ts`'s `BuildingPlacement` shape — feeds
 * `computeSystemLinks` (via `domain/presentLinks.ts`) with what's actually built today, the same
 * way `solve.ts` feeds it a solved plan's placements. Unlike `derivePresentCounts` above (a flat
 * system-wide total), link topology is per-body, so this keeps bodies separate. Pass
 * `excludePrimary: true` where the caller already gets the primary's placement from elsewhere —
 * `domain/solvedLinks.ts`'s `toSolvedBuildingPlacements` merges this with `SolverResult.placements`,
 * which unconditionally includes the primary already (`solve.ts`'s own fixed assignment, not
 * decision-dependent) — including it here too would double-count it (see
 * `PresentFacilitySlot.primary`'s doc comment). `presentLinks.ts`'s present-only case has no such
 * other source, so it leaves this unset (include it). */
export function toBuildingPlacements(bodies: PresentFacilitiesBody[], options?: { excludePrimary?: boolean }): BuildingPlacement[] {
  const counts = new Map<string, BuildingPlacement>();
  for (const ref of flatten(bodies)) {
    if (options?.excludePrimary && ref.primary) continue;
    const key = `${ref.bodyId}:${ref.building}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { building: ref.building, bodyId: ref.bodyId, count: 1 });
  }
  return Array.from(counts.values());
}

/** Building names in the same deterministic stand-in order as `computePresentPortsSeed`'s cost
 * curve — reused here as `computeSystemLinks`'s `buildOrderHint`, an approximate same-tier
 * tie-break signal (see that function's own doc comment; not a real recorded build order).
 * `presentLinks.ts`'s dominance tie-break wants the primary included (it's a real port that should
 * participate there); pass `excludePrimary: true` for a cost/feasibility context that's ALREADY
 * seeding the primary separately (`domain/buildOrderTable.ts`'s `computeValidatedBuiltOrder`, which
 * passes `firstStationBuilding` straight to `computeFeasibleOrder` — including the primary's real
 * synced entry here too would double-seed it, and for an escalating-cost port like Coriolis,
 * double-CHARGE it, throwing off every subsequent real port's escalation-sequence position). */
export function presentBuildOrderHint(bodies: PresentFacilitiesBody[], options?: { excludePrimary?: boolean }): string[] {
  return sortDeterministic(flatten(bodies))
    .filter((ref) => !(options?.excludePrimary && ref.primary))
    .map((ref) => ref.building);
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
 * assigned body via its own synced `presentFacilities` entry (`PresentFacilitySlot.primary` — see
 * that field's doc comment), so it's counted here by the exact same generic loop as any other
 * facility — no `firstStationBodyId` parameter or separate "+1" needed. */
export function deriveSlotUsage(bodies: SlotUsageBody[], totals: { space: number; ground: number; asteroid: number }): SystemSlotUsage {
  let builtSpace = 0;
  let builtGround = 0;
  let builtAsteroidSpace = 0;
  for (const body of bodies) {
    const spaceBuilt = body.space.filter((slot) => slot !== null).length;
    builtSpace += spaceBuilt;
    builtGround += body.ground.filter((slot) => slot !== null).length;
    if (body.asteroidEligible) builtAsteroidSpace += spaceBuilt;
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
 * `computePresentPortsSeed` for their cost, which depends on curve position, not a fixed stat).
 * Skips the primary station's own synced entry (`ref.primary`) entirely — its point contribution
 * is handled by `deriveCurrentPoints`/`solve.ts`'s own separate, already-correct logic (see
 * `PresentFacilitySlot.primary`'s doc comment); counting it again here would double it. */
export function computeHardNonPortSeed(hard: PresentFacilityRef[]): PresentSeed {
  let t2 = 0;
  let t3 = 0;
  for (const ref of hard) {
    if (ref.primary) continue;
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
 * hard). Skips the primary station's own synced entry (`ref.primary`) entirely — not just its
 * cost, its escalation-sequence POSITION too (it never increments `t2Index`/`t3Index`), since the
 * primary is exempt from its own port-escalation cost and was never counted toward this sequence
 * before it became a real `presentFacilities` entry — see `deriveCurrentPoints`/`solve.ts`'s own
 * separate, already-correct exemption logic, and `PresentFacilitySlot.primary`'s doc comment. */
export function computePresentPortsSeed(hard: PresentFacilityRef[]): PresentSeed {
  const ports = sortDeterministic(hard).filter((ref) => !ref.primary && isPort(ALL_BUILDINGS[ref.building]));
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

function primaryFacilitySlot(building: string, variant?: string, customName?: string): PresentFacilitySlot {
  return { building, demolishable: false, variant, customName, primary: true };
}

function slotsEqual(a: PresentFacilitySlot | null, b: PresentFacilitySlot): boolean {
  return !!a && a.primary === true && a.building === b.building && a.variant === b.variant && a.customName === b.customName;
}

/** Overwrites the primary station's assigned body's Orbital-1 slot with its own real, synced entry
 * (see `PresentFacilitySlot.primary`'s doc comment) — authoritative regardless of whatever the
 * caller's own data says was there (a stale manual entry, already-synced data, or nothing at all)
 * — and clears a stale `primary: true` leftover on any OTHER body (the primary moved since, or the
 * caller's data is otherwise out of sync). `firstStationBodyId`/`firstStationBuilding` are the
 * single source of truth for "who and where the primary is"; this is what makes that fact show up
 * correctly in every capacity/count computation below that reads `presentFacilities`, instead of
 * each needing its own separate "+1 for the primary" bookkeeping.
 *
 * Used directly by `solve.ts` (self-contained — a direct/API caller that doesn't go through
 * `state/plannerState.ts`'s reducer at all still gets a correct result, matching how `solve.ts`
 * already never trusted caller data hygiene for `firstStationBuilding` itself) and, via
 * `syncPrimaryIntoBodies` below, by that reducer (so `formState.bodies` itself stays correct for
 * every OTHER consumer too — the Constructions table, build order table, etc.). Returns the input
 * array unchanged (same reference) if nothing needed reconciling, so callers that care about
 * reference identity across unrelated updates (e.g. `plannerState.test.ts`'s "untouched fields keep
 * identity" convention) aren't disrupted needlessly. */
export function applyPrimaryReservation<T extends PresentFacilitiesBody>(
  bodies: T[],
  firstStationBodyId: number | undefined,
  firstStationBuilding: string | undefined,
  firstStationVariant?: string,
  firstStationCustomName?: string,
): T[] {
  let changed = false;
  const next = bodies.map((b) => {
    const existingSlot0 = b.space[0] ?? null;
    if (b.bodyId === firstStationBodyId && firstStationBuilding) {
      const primarySlot = primaryFacilitySlot(firstStationBuilding, firstStationVariant, firstStationCustomName);
      if (slotsEqual(existingSlot0, primarySlot)) return b;
      changed = true;
      const space = [...b.space];
      space[0] = primarySlot;
      return { ...b, space };
    }
    if (existingSlot0?.primary) {
      changed = true;
      const space = [...b.space];
      space[0] = null;
      return { ...b, space };
    }
    return b;
  });
  return changed ? next : bodies;
}

/** `JournalBody`-shaped counterpart to `applyPrimaryReservation` above, for
 * `state/plannerState.ts`'s reducer — `JournalBody.presentFacilities` nests `space`/`ground` rather
 * than carrying them at the top level like `PresentFacilitiesBody` does. */
export function syncPrimaryIntoBodies(
  bodies: JournalBody[],
  firstStationBodyId: number | undefined,
  firstStationBuilding: string | undefined,
  firstStationVariant?: string,
  firstStationCustomName?: string,
): JournalBody[] {
  const flat = bodies.map((b) => ({
    bodyId: b.bodyId,
    space: b.presentFacilities?.space ?? [],
    ground: b.presentFacilities?.ground ?? [],
  }));
  const applied = applyPrimaryReservation(flat, firstStationBodyId, firstStationBuilding, firstStationVariant, firstStationCustomName);
  if (applied === flat) return bodies;
  return bodies.map((b, i) =>
    applied[i] === flat[i] ? b : { ...b, presentFacilities: { space: applied[i].space, ground: applied[i].ground } },
  );
}
