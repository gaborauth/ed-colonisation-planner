import { describe, expect, it } from "vitest";
import {
  applyPrimaryReservation,
  computeHardNonPortSeed,
  computePresentPortsSeed,
  derivePresentCounts,
  deriveCurrentPoints,
  deriveSlotUsage,
  normalizeBlockedSlots,
  normalizeFacilitySlots,
  presentBuildOrderHint,
  splitPresentFacilities,
  syncPrimaryIntoBodies,
  toBuildingPlacements,
  toSlotUsageBodies,
  type PresentFacilitiesBody,
  type SlotUsageBody,
} from "./presentFacilities";
import type { JournalBody } from "../journal/parser";

describe("normalizeFacilitySlots", () => {
  it("pads a short/undefined array with null up to count", () => {
    expect(normalizeFacilitySlots(undefined, 3)).toEqual([null, null, null]);
    expect(normalizeFacilitySlots([{ building: "Government", demolishable: false }], 3)).toEqual([
      { building: "Government", demolishable: false },
      null,
      null,
    ]);
  });

  it("truncates a too-long array down to count", () => {
    const slots = [
      { building: "Government", demolishable: false },
      { building: "Medical", demolishable: true },
    ];
    expect(normalizeFacilitySlots(slots, 1)).toEqual([{ building: "Government", demolishable: false }]);
  });
});

describe("normalizeBlockedSlots", () => {
  it("pads a short/undefined array with false up to count", () => {
    expect(normalizeBlockedSlots(undefined, 3)).toEqual([false, false, false]);
    expect(normalizeBlockedSlots([true], 3)).toEqual([true, false, false]);
  });

  it("truncates a too-long array down to count", () => {
    expect(normalizeBlockedSlots([true, true, false], 1)).toEqual([true]);
  });
});

describe("splitPresentFacilities / derivePresentCounts", () => {
  it("splits non-port facilities into hard vs demolishable per their flag", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Government", demolishable: false }, null],
        ground: [{ building: "Small_Military_Settlement", demolishable: true }],
      },
    ];
    const { hard, demolishable } = splitPresentFacilities(bodies);
    expect(hard).toEqual([{ bodyId: 1, kind: "space", index: 0, building: "Government" }]);
    expect(demolishable).toEqual([
      { bodyId: 1, kind: "ground", index: 0, building: "Small_Military_Settlement" },
    ]);
    expect(derivePresentCounts(bodies)).toEqual({ Government: 1, Small_Military_Settlement: 1 });
  });

  it("always treats a present port as hard, even if marked demolishable", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: true }], ground: [] },
    ];
    const { hard, demolishable } = splitPresentFacilities(bodies);
    expect(hard).toEqual([{ bodyId: 1, kind: "space", index: 0, building: "Coriolis" }]);
    expect(demolishable).toEqual([]);
  });

  // The primary station's own synced entry (see `PresentFacilitySlot.primary`'s doc comment) is
  // meant to show up in the Constructions table, but must NOT be double-counted wherever the
  // caller already accounts for it separately (e.g. `computeCurrentSystemScores`'s own bonus
  // split, `domain/systemState.ts`'s `addFirstStation`).
  it("derivePresentCounts: includes the primary by default, excludes it with excludePrimary", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false, primary: true }],
        ground: [{ building: "Small_Agricultural_Settlement", demolishable: false }],
      },
    ];
    expect(derivePresentCounts(bodies)).toEqual({ Coriolis: 1, Small_Agricultural_Settlement: 1 });
    expect(derivePresentCounts(bodies, { excludePrimary: true })).toEqual({ Small_Agricultural_Settlement: 1 });
  });
});

describe("computeHardNonPortSeed", () => {
  it("sums T2/T3 stats of hard non-port facilities, ignoring ports", () => {
    // Large_Military_Settlement: t2 -1, t3 2. Small_Agricultural_Settlement: t2 1.
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [
          { building: "Large_Military_Settlement", demolishable: false },
          { building: "Small_Agricultural_Settlement", demolishable: false },
        ],
      },
    ];
    const { hard } = splitPresentFacilities(bodies);
    expect(computeHardNonPortSeed(hard)).toEqual({ t2: 0, t3: 2 });
  });

  it("skips the primary station's own synced entry entirely (its point contribution is handled elsewhere)", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [], ground: [{ building: "Large_Military_Settlement", demolishable: false, primary: true }] },
    ];
    const { hard } = splitPresentFacilities(bodies);
    expect(computeHardNonPortSeed(hard)).toEqual({ t2: 0, t3: 0 });
  });
});

describe("deriveSlotUsage", () => {
  it("counts built facilities (hard and demolishable alike) against each pool's total", () => {
    const bodies: SlotUsageBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false }, null],
        ground: [{ building: "Small_Agricultural_Settlement", demolishable: true }],
        asteroidEligible: false,
      },
    ];
    const usage = deriveSlotUsage(bodies, { space: 2, ground: 1, asteroid: 0 });
    expect(usage.space).toEqual({ built: 1, free: 1, total: 2 });
    expect(usage.ground).toEqual({ built: 1, free: 0, total: 1 });
    expect(usage.asteroidEligibleSpace).toEqual({ built: 0, free: 0, total: 0 });
  });

  it("counts a ring-eligible body's built orbital slots toward the asteroid-eligible subset", () => {
    const bodies: SlotUsageBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Asteroid_Base", demolishable: false }, null, null],
        ground: [],
        asteroidEligible: true,
      },
      {
        bodyId: 2,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [],
        asteroidEligible: false,
      },
    ];
    const usage = deriveSlotUsage(bodies, { space: 4, ground: 0, asteroid: 3 });
    expect(usage.space).toEqual({ built: 2, free: 2, total: 4 });
    // Only body 1's built slot counts toward the asteroid-eligible subset, not body 2's.
    expect(usage.asteroidEligibleSpace).toEqual({ built: 1, free: 2, total: 3 });
  });

  // The primary station's reserved slot is now a real, synced `presentFacilities` entry (see
  // `PresentFacilitySlot.primary`'s doc comment / `applyPrimaryReservation`) — it counts here via
  // the exact same generic loop as any other facility, no special "firstStationBodyId" parameter
  // needed anymore (removed — see this function's own doc comment).
  it("counts the primary station's own synced entry the same as any other built facility", () => {
    const bodies: SlotUsageBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false, primary: true }, null],
        ground: [],
        asteroidEligible: true,
      },
    ];
    const usage = deriveSlotUsage(bodies, { space: 2, ground: 0, asteroid: 2 });
    expect(usage.space).toEqual({ built: 1, free: 1, total: 2 });
    expect(usage.asteroidEligibleSpace).toEqual({ built: 1, free: 1, total: 2 });
  });

  it("clamps free at 0 rather than going negative if totals are stale/undercounted", () => {
    const bodies: SlotUsageBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false }], ground: [], asteroidEligible: false },
    ];
    const usage = deriveSlotUsage(bodies, { space: 0, ground: 0, asteroid: 0 });
    expect(usage.space).toEqual({ built: 1, free: 0, total: 0 });
  });
});

describe("computePresentPortsSeed", () => {
  it("charges a single present port the first-slot escalating cost as a negative (a cost), plus its fixed generation", () => {
    // Coriolis: T2points "port", T3points 1 (fixed generation, not escalating).
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false }], ground: [] },
    ];
    const { hard } = splitPresentFacilities(bodies);
    // getT2PortCost(0) = 3, charged as -3 (a cost, same sign convention as a non-port T2-tier
    // building's negative T2points); Coriolis's T3points is a fixed 1, not "port", so it adds a
    // flat +1 generation rather than an escalating cost.
    expect(computePresentPortsSeed(hard)).toEqual({ t2: -3, t3: 1 });
  });

  it("escalates Tier-2-cost and Tier-3-cost ports along SEPARATE sequences, in deterministic (bodyId, space-before-ground, index) order", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 2,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [{ building: "Planetary_Port", demolishable: false }],
      },
      { bodyId: 1, space: [{ building: "Asteroid_Base", demolishable: false }], ground: [] },
    ];
    const { hard } = splitPresentFacilities(bodies);
    // Deterministic order: bodyId 1 (Asteroid_Base) first, then bodyId 2 space (Coriolis), then
    // bodyId 2 ground (Planetary_Port).
    // Asteroid_Base: Tier-2-cost port, 1st of that sequence -> -getT2PortCost(0) = -3; T3 1 (fixed) -> +1.
    // Coriolis: Tier-2-cost port, 2nd of that sequence -> -getT2PortCost(1) = -5; T3 1 (fixed) -> +1.
    // Planetary_Port: T2 0 (not "port", no t2 contribution); Tier-3-cost port, 1st of ITS OWN
    // sequence (not pushed to position 2 by the two Tier-2-cost ports before it) -> -getT3PortCost(0) = -6.
    expect(computePresentPortsSeed(hard)).toEqual({ t2: -3 - 5, t3: 1 + 1 - 6 });
  });

  // The primary station is exempt from its own escalating port cost (handled by
  // `deriveCurrentPoints`'s own separate `firstStationBuilding` logic / `solve.ts`'s
  // `initialT2Points`/`initialT3Points`) — it must be skipped here entirely, not charged AND not
  // counted toward the escalation sequence position of any OTHER real port that follows it.
  it("skips the primary station's own synced entry entirely — no cost, and doesn't consume an escalation-sequence slot", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [
          { building: "Coriolis", demolishable: false, primary: true },
          { building: "Coriolis", demolishable: false },
        ],
        ground: [],
      },
    ];
    const { hard } = splitPresentFacilities(bodies);
    // If the primary counted toward the sequence, the second (real, non-primary) Coriolis would be
    // charged as the 2nd-of-type (-getT2PortCost(1) = -5); since it's skipped, the real Coriolis is
    // still the 1st of its sequence (-getT2PortCost(0) = -3).
    expect(computePresentPortsSeed(hard)).toEqual({ t2: -3, t3: 1 });
  });
});

describe("deriveCurrentPoints", () => {
  it("gives a demolishable facility full credit too, unlike solve.ts's hard-only seed", () => {
    // Small_Agricultural_Settlement: T2 1, T3 0 (from data/buildings.ts).
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [], ground: [{ building: "Small_Agricultural_Settlement", demolishable: true }] },
    ];
    // Confirm this facility really does land in "demolishable", not "hard" (i.e. the test is
    // actually exercising the hard-vs-demolishable distinction, not accidentally testing hard-only).
    const { hard, demolishable } = splitPresentFacilities(bodies);
    expect(hard).toEqual([]);
    expect(demolishable).toHaveLength(1);
    expect(deriveCurrentPoints(bodies)).toEqual({ t2: 1, t3: 0 });
  });

  it("combines non-port (hard + demolishable) and port seeds", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [
          { building: "Large_Military_Settlement", demolishable: false }, // hard: t2 -1, t3 2
          { building: "Small_Agricultural_Settlement", demolishable: true }, // demolishable: t2 1
        ],
      },
    ];
    // Coriolis (only present port): -getT2PortCost(0) = -3 (a cost), T3 fixed +1.
    // Non-port total: t2 = -1 + 1 = 0; t3 = 2 + 0 = 2.
    expect(deriveCurrentPoints(bodies)).toEqual({ t2: -3, t3: 3 });
  });

  it("credits the primary station's generation but waives its own escalating cost", () => {
    // No presentFacilities at all — the primary is tracked separately, never as a tree entry.
    const bodies: PresentFacilitiesBody[] = [];
    // Coriolis primary: T2points "port" (not a positive number) -> waived, contributes 0 to T2.
    // T3points 1 (positive fixed) -> kept, contributes +1 to T3.
    expect(deriveCurrentPoints(bodies, "Coriolis")).toEqual({ t2: 0, t3: 1 });
    // A Tier-1 Outpost primary has nothing to waive (T1 buildings never cost points) and still
    // grants its normal +1 T2 generation.
    expect(deriveCurrentPoints(bodies, "Commercial_Outpost")).toEqual({ t2: 1, t3: 0 });
    // A Tier-3-cost primary (Orbis_or_Ocellus): T2points 0 -> nothing; T3points "port" (not a
    // positive number) -> waived, contributes 0 — T3 is the terminal tier, nothing generated either.
    expect(deriveCurrentPoints(bodies, "Orbis_or_Ocellus")).toEqual({ t2: 0, t3: 0 });
    // No primary picked yet (undefined/"") -> no credit at all.
    expect(deriveCurrentPoints(bodies, undefined)).toEqual({ t2: 0, t3: 0 });
  });

  it("matches a real in-game system's confirmed current T2/T3 balance end-to-end", () => {
    // Regression test for a real reported discrepancy: this tool previously showed T2=11, T3=17
    // for this exact facility list; the correct in-game (and DaftMav spreadsheet) values are 5
    // and 6. The bug was threefold: computePresentPortsSeed added the escalating port cost
    // instead of subtracting it, shared one index across both Tier-2-cost and Tier-3-cost ports
    // instead of two separate ones, and the primary station's own generation credit was missing
    // entirely (see solve.ts's matching fix).
    const bodies: PresentFacilitiesBody[] = [
      // 8 Communication_Station (T1, +1 T2 each), 7 Medium_Agricultural_Settlement (T1, +1 T2
      // each), 2 Military_Outpost (T1, +1 T2 each), 1 Civilian_Planetary_Outpost (T1, +1 T2).
      {
        bodyId: 1,
        space: Array.from({ length: 8 }, () => ({ building: "Communication_Station", demolishable: false })),
        ground: [],
      },
      {
        bodyId: 2,
        space: [
          { building: "Military_Outpost", demolishable: false },
          { building: "Military_Outpost", demolishable: false },
        ],
        ground: Array.from({ length: 7 }, () => ({ building: "Medium_Agricultural_Settlement", demolishable: false })),
      },
      {
        bodyId: 3,
        space: [],
        ground: [{ building: "Civilian_Planetary_Outpost", demolishable: false }],
      },
      // 2 Government + 8 Refinery_Hub (non-port T2-tier: -1 T2 / +1 T3 each, fixed, not escalating).
      {
        bodyId: 4,
        space: [
          { building: "Government", demolishable: false },
          { building: "Government", demolishable: false },
        ],
        ground: Array.from({ length: 8 }, () => ({ building: "Refinery_Hub", demolishable: false })),
      },
      // 1 present (non-primary) Coriolis + 1 present Orbis_or_Ocellus, same body.
      {
        bodyId: 5,
        space: [
          { building: "Coriolis", demolishable: false },
          { building: "Orbis_or_Ocellus", demolishable: false },
        ],
        ground: [],
      },
    ];
    // Primary station is ALSO Coriolis, but tracked separately (bodyId 5's Coriolis above is a
    // second, non-primary instance) — matches the reported system's actual layout.
    expect(deriveCurrentPoints(bodies, "Coriolis")).toEqual({ t2: 5, t3: 6 });
  });
});

describe("toBuildingPlacements", () => {
  it("aggregates instances per (bodyId, building), across both space and ground", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Military_Outpost", demolishable: false }],
        ground: [
          { building: "Refinery_Hub", demolishable: false },
          { building: "Refinery_Hub", demolishable: false },
        ],
      },
      { bodyId: 2, space: [{ building: "Refinery_Hub", demolishable: false }], ground: [null] },
    ];
    expect(toBuildingPlacements(bodies)).toEqual([
      { building: "Military_Outpost", bodyId: 1, count: 1 },
      { building: "Refinery_Hub", bodyId: 1, count: 2 },
      { building: "Refinery_Hub", bodyId: 2, count: 1 },
    ]);
  });

  it("returns an empty array for a system with nothing built yet", () => {
    expect(toBuildingPlacements([{ bodyId: 1, space: [null], ground: [] }])).toEqual([]);
  });

  it("includes the primary by default, excludes it with excludePrimary (for callers that already get it from elsewhere, e.g. SolverResult.placements)", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false, primary: true }], ground: [] },
    ];
    expect(toBuildingPlacements(bodies)).toEqual([{ building: "Coriolis", bodyId: 1, count: 1 }]);
    expect(toBuildingPlacements(bodies, { excludePrimary: true })).toEqual([]);
  });
});

describe("presentBuildOrderHint", () => {
  it("orders building names by the same (bodyId, space-before-ground, index) rule as the T2/T3 seed", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 2,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [{ building: "Planetary_Port", demolishable: false }],
      },
      { bodyId: 1, space: [{ building: "Asteroid_Base", demolishable: false }], ground: [] },
    ];
    expect(presentBuildOrderHint(bodies)).toEqual(["Asteroid_Base", "Coriolis", "Planetary_Port"]);
  });
});

describe("toSlotUsageBodies", () => {
  it("maps a JournalBody's presentFacilities/slots into the shape deriveSlotUsage needs", () => {
    const bodies: JournalBody[] = [
      {
        bodyName: "Test A",
        bodyId: 1,
        kind: "planet",
        landable: false,
        parents: [],
        rings: [{ name: "A Ring", ringClass: "eMetalRich", massMT: 1 }],
        slots: { space: 2, ground: 1, asteroid: 1 },
        presentFacilities: {
          space: [{ building: "Asteroid_Base", demolishable: false }, null],
          ground: [null],
        },
        raw: {},
      },
      {
        bodyName: "Test B",
        bodyId: 2,
        kind: "planet",
        landable: false,
        parents: [],
        rings: [],
        slots: { space: 1, ground: 0, asteroid: 0 },
        raw: {},
      },
    ];
    expect(toSlotUsageBodies(bodies)).toEqual([
      {
        bodyId: 1,
        space: [{ building: "Asteroid_Base", demolishable: false }, null],
        ground: [null],
        asteroidEligible: true,
      },
      { bodyId: 2, space: [], ground: [], asteroidEligible: false },
    ]);
  });
});

describe("applyPrimaryReservation", () => {
  it("overwrites the primary's assigned body's space[0], authoritative regardless of what was there before", () => {
    const bodies: PresentFacilitiesBody[] = [
      // A stale manually-entered facility left behind before this body became the primary's.
      { bodyId: 1, space: [{ building: "Commercial_Outpost", demolishable: false }, null], ground: [] },
      { bodyId: 2, space: [{ building: "Coriolis", demolishable: false }], ground: [] },
    ];
    const result = applyPrimaryReservation(bodies, 1, "Orbis_or_Ocellus", "Apollo", "Galen Vision");
    expect(result[0]).toEqual({
      bodyId: 1,
      space: [{ building: "Orbis_or_Ocellus", demolishable: false, variant: "Apollo", customName: "Galen Vision", primary: true }, null],
      ground: [],
    });
    // Body 2 (not the primary's) is completely untouched.
    expect(result[1]).toBe(bodies[1]);
  });

  it("clears a stale primary:true leftover on a body that's no longer the primary's (it moved elsewhere)", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false, primary: true }], ground: [] },
      { bodyId: 2, space: [null], ground: [] },
    ];
    const result = applyPrimaryReservation(bodies, 2, "Coriolis");
    expect(result[0].space).toEqual([null]);
    expect(result[1].space).toEqual([{ building: "Coriolis", demolishable: false, primary: true }]);
  });

  it("is a no-op (same array reference) when already fully synced", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false, primary: true }], ground: [] },
    ];
    expect(applyPrimaryReservation(bodies, 1, "Coriolis")).toBe(bodies);
  });

  it("is a no-op when no primary is assigned at all", () => {
    const bodies: PresentFacilitiesBody[] = [{ bodyId: 1, space: [{ building: "Coriolis", demolishable: false }], ground: [] }];
    expect(applyPrimaryReservation(bodies, undefined, undefined)).toBe(bodies);
  });
});

describe("syncPrimaryIntoBodies", () => {
  it("writes the synced entry into JournalBody.presentFacilities (nested, unlike PresentFacilitiesBody's flat shape)", () => {
    const bodies: JournalBody[] = [
      {
        bodyName: "Test A",
        bodyId: 1,
        kind: "planet",
        landable: false,
        parents: [],
        rings: [],
        slots: { space: 1, ground: 0, asteroid: 0 },
        presentFacilities: { space: [null], ground: [] },
        raw: {},
      },
    ];
    const result = syncPrimaryIntoBodies(bodies, 1, "Coriolis", undefined, "Home Base");
    expect(result[0].presentFacilities).toEqual({
      space: [{ building: "Coriolis", demolishable: false, variant: undefined, customName: "Home Base", primary: true }],
      ground: [],
    });
    // Everything else about the body is untouched.
    expect(result[0].bodyName).toBe("Test A");
  });

  it("returns the input unchanged (same reference) when nothing needs reconciling", () => {
    const bodies: JournalBody[] = [
      { bodyName: "Test A", bodyId: 1, kind: "planet", landable: false, parents: [], rings: [], raw: {} },
    ];
    expect(syncPrimaryIntoBodies(bodies, undefined, undefined)).toBe(bodies);
  });
});
