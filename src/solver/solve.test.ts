import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import { solve, type SolverInput } from "./solve";

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    slots: { space: 5, ground: 5, asteroid: 2 },
    objective: { kind: "simple", score: "wealth" },
    firstStationBuilding: "Coriolis",
    allowCriminal: true,
    alreadyPresent: {},
    ...overrides,
  };
}

describe("solve", () => {
  it("maximizes wealth within slot limits and returns a feasible, scored solution", async () => {
    const result = await solve(baseInput());
    expect(result.status).toBe("optimal");
    expect(result.scores.wealth).toBeGreaterThan(0);
    expect(result.slotsRemaining.space).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.ground).toBeGreaterThanOrEqual(0);
  }, 20000);

  it("minimizes construction cost while requiring a minimum security score", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "simple", score: "construction_cost" },
        scoreConstraints: { min: { security: 5 } },
        slots: { space: 5, ground: 10, asteroid: 0 },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.scores.security).toBeGreaterThanOrEqual(5);
  }, 20000);

  it("reports infeasible when constraints cannot be satisfied", async () => {
    const result = await solve(
      baseInput({
        slots: { space: 0, ground: 0, asteroid: 0 },
        scoreConstraints: { min: { security: 100 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("never builds a dependent building without its prerequisite settlement", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "simple", score: "security" },
        slots: { space: 5, ground: 5, asteroid: 0 },
        constraints: { atLeast: { Military: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Military).toBeGreaterThanOrEqual(1);
    const hasSettlement =
      (result.toBuild.Small_Military_Settlement ?? 0) > 0 ||
      (result.toBuild.Medium_Military_Settlement ?? 0) > 0 ||
      (result.toBuild.Large_Military_Settlement ?? 0) > 0;
    expect(hasSettlement).toBe(true);
  }, 20000);

  it("solves a concave custom objective (sqrt of two scores)", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "custom", expression: "sqrt(w) + sqrt(n)", direction: "maximize" },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.objectiveValue).not.toBeNull();
    expect(result.objectiveValue as number).toBeGreaterThan(0);
  }, 20000);

  it("solves a convex term used correctly (subtracted abs(), matching the original preset 2*w+t-abs(w-2*t))", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "custom", expression: "2*w + t - abs(w - 2*t)", direction: "maximize" },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.objectiveValue).not.toBeNull();
  }, 20000);

  it("rejects a concave function used in a non-beneficial direction", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "custom", expression: "-sqrt(w)", direction: "maximize" },
      }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/concave/);
  }, 20000);

  it("errors when no first station is picked", async () => {
    const result = await solve(baseInput({ firstStationBuilding: "" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/pick your first station/);
  }, 20000);

  it("boosts the first station's own stats toward system scores (Dodec Update +40%/+40%/+40%)", async () => {
    const result = await solve(
      baseInput({
        slots: { space: 0, ground: 0, asteroid: 0 },
        firstStationBuilding: "Government", // security: +2, standard_of_living: +7, development_level: +3
        objective: { kind: "simple", score: "development_level" },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(Object.keys(result.toBuild)).toHaveLength(0); // no slots left for anything else
    // Each is boosted by +40% then rounded: dev round(3*1.4)=4, sec round(2*1.4)=3, sol round(7*1.4)=10.
    expect(result.scores.development_level).toBe(4);
    expect(result.scores.security).toBe(3);
    expect(result.scores.standard_of_living).toBe(10);
  }, 20000);

  it("weights a facility built after the first station at the reduced 'subsequent facility' rate", async () => {
    const result = await solve(
      baseInput({
        // T2/T3 seed is now derived from already-present facilities (never manually entered) — a
        // hard-present Small_Agricultural_Settlement (t2: 1) banks the 1 T2 point Government needs.
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 1, asteroid: 0 },
            presentFacilities: {
              space: [],
              ground: [{ building: "Small_Agricultural_Settlement", demolishable: false }],
            },
          },
        ],
        firstStationBuilding: "Criminal_Outpost", // development_level: 0, isolates Government's effect
        objective: { kind: "simple", score: "development_level" },
        constraints: { atLeast: { Government: 1 }, atMost: { Government: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Government).toBe(1);
    // Government's development_level is 3; built as a subsequent facility at the Dodec Update's
    // -10% reduction -> round(3 * 0.9) = round(2.7) = 3.
    expect(result.scores.development_level).toBe(3);
  }, 20000);

  it("shows the corrected -10% subsequent-facility reduction distinctly on a larger-stat facility", async () => {
    // Large_Industrial_Settlement's development_level (9) is big enough that the old, incorrect
    // -60%-guess formula (round(9*0.4)=4) and the Dodec Update's official -10% (round(9*0.9)=8)
    // produce clearly different, non-rounding-coincidental results.
    const result = await solve(
      baseInput({
        // Same seed-derivation note as the test above: a hard-present Small_Agricultural_Settlement
        // banks the 1 T2 point Large_Industrial_Settlement (t2: -1) needs.
        bodies: [
          {
            bodyId: 1,
            slots: { space: 0, ground: 2, asteroid: 0 },
            presentFacilities: {
              space: [],
              ground: [{ building: "Small_Agricultural_Settlement", demolishable: false }],
            },
          },
        ],
        firstStationBuilding: "Criminal_Outpost", // development_level: 0, isolates the settlement's effect
        objective: { kind: "simple", score: "development_level" },
        constraints: { atLeast: { Large_Industrial_Settlement: 1 }, atMost: { Large_Industrial_Settlement: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Large_Industrial_Settlement).toBe(1);
    expect(result.scores.development_level).toBe(8);
  }, 20000);

  it("echoes back the fixed first station unchanged (never solver-chosen)", async () => {
    const result = await solve(baseInput({ firstStationBuilding: "Dodecahedron" }));
    expect(result.status).toBe("optimal");
    expect(result.firstStation).toBe("Dodecahedron");
  }, 20000);
});

describe("solve with per-body placement (input.bodies)", () => {
  it("produces identical results whether `bodies` is omitted or an explicit empty array", async () => {
    const withoutBodies = await solve(baseInput());
    const withEmptyBodies = await solve(baseInput({ bodies: [] }));
    expect(withEmptyBodies.status).toBe(withoutBodies.status);
    expect(withEmptyBodies.toBuild).toEqual(withoutBodies.toBuild);
    expect(withEmptyBodies.scores).toEqual(withoutBodies.scores);
    expect(withEmptyBodies.portOrder).toEqual(withoutBodies.portOrder);
    expect(withEmptyBodies.slotsRemaining).toEqual(withoutBodies.slotsRemaining);
    expect(withEmptyBodies.placements).toEqual([]);
    expect(withoutBodies.placements).toEqual([]);
  }, 20000);

  it("enforces true per-body slot capacity, not just an aggregate sum", async () => {
    // Only 1 orbital slot total, split across two bodies with 0 on the second — demanding 2 units
    // of a space building must be infeasible here even though the (irrelevant, ignored in this
    // mode) aggregate `slots.space` below would have allowed it.
    const result = await solve(
      baseInput({
        slots: { space: 5, ground: 5, asteroid: 0 },
        bodies: [
          { bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 } },
          { bodyId: 2, slots: { space: 0, ground: 0, asteroid: 0 } },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 2 }, atMost: { Commercial_Outpost: 2 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("places buildings across bodies respecting each body's own capacity, and reports it in `placements`", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          { bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 } },
          { bodyId: 2, slots: { space: 1, ground: 0, asteroid: 0 } },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 2 }, atMost: { Commercial_Outpost: 2 } },
      }),
    );
    expect(result.status).toBe("optimal");
    const commercialPlacements = result.placements.filter((p) => p.building === "Commercial_Outpost");
    expect(commercialPlacements.map((p) => p.bodyId).sort()).toEqual([1, 2]);
    expect(commercialPlacements.every((p) => p.count === 1)).toBe(true);
  }, 20000);

  it("restricts Asteroid_Base to ring-eligible bodies only", async () => {
    const result = await solve(
      baseInput({
        // 3 hard-present, T2-generating settlements bank the 3 T2 points the first new port (k=0)
        // costs (getT2PortCost(0) = 3) — same seed-derivation note as the tests above.
        bodies: [
          {
            bodyId: 1,
            slots: { space: 2, ground: 3, asteroid: 0 },
            presentFacilities: {
              space: [],
              ground: [
                { building: "Small_Agricultural_Settlement", demolishable: false },
                { building: "Small_Agricultural_Settlement", demolishable: false },
                { building: "Small_Agricultural_Settlement", demolishable: false },
              ],
            },
          }, // not ring-eligible
          { bodyId: 2, slots: { space: 2, ground: 0, asteroid: 1 } }, // ring-eligible
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Asteroid_Base: 1 }, atMost: { Asteroid_Base: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    const placement = result.placements.find((p) => p.building === "Asteroid_Base");
    expect(placement?.bodyId).toBe(2);
  }, 20000);

  // Real-game-confirmed (2026-07-28, "A/B/etc Belt's orbit only bear Asteroid station."): a star
  // belt's own dedicated slot (`SolverBody.asteroidExclusive`, set from `JournalBody.kind ===
  // "ring"` — see `journal/parser.ts`'s `withRingBodies`) can ONLY ever hold an Asteroid_Base. A
  // ringed PLANET's own slot (asteroidExclusive unset) is unaffected — see the next test.
  it("restricts a star belt's dedicated slot (asteroidExclusive) to Asteroid_Base only", async () => {
    const result = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 1 }, asteroidExclusive: true }],
        constraints: { atLeast: { Commercial_Outpost: 1 } },
      }),
    );
    // The system's only space slot is asteroid-exclusive, so a forced Commercial_Outpost has
    // nowhere to go — correctly infeasible, not silently placed there anyway.
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("still allows an Asteroid_Base itself on a star belt's dedicated (asteroidExclusive) slot", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          { bodyId: 1, slots: { space: 1, ground: 0, asteroid: 1 }, asteroidExclusive: true },
          // A bare belt-only system has no way to fund even the escalating port's cheapest T2 cost
          // (an unbuilt Coriolis primary generates no flat T2 points on its own) — a second,
          // ordinary body gives the solver room to build whatever it needs to afford the Asteroid
          // Base, same as any other economically-grounded scenario.
          { bodyId: 2, slots: { space: 0, ground: 3, asteroid: 0 } },
        ],
        constraints: { atLeast: { Asteroid_Base: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.placements).toContainEqual({ building: "Asteroid_Base", bodyId: 1, count: 1 });
  }, 20000);

  // A ringed PLANET's own slot (as opposed to a star belt's dedicated synthetic body) stays an
  // ordinary orbital slot that merely additionally qualifies for Asteroid_Base — deliberately NOT
  // generalized to the star belt's exclusive treatment (see CLAUDE.md's "Star belts vs. planet
  // rings"). `asteroidExclusive` is left unset here, same as `App.tsx`'s `buildSolverInput` would
  // for a `kind: "planet"` body.
  it("still allows an ordinary building on a ringed PLANET's own slot (not asteroidExclusive)", async () => {
    const ringedPlanet: JournalBody = {
      bodyName: "Test Ringed Planet",
      bodyId: 2,
      kind: "planet",
      landable: false,
      parents: [],
      rings: [],
      raw: {},
    };
    const result = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 1 }, economy: ringedPlanet }],
        constraints: { atLeast: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.placements).toContainEqual({ building: "Commercial_Outpost", bodyId: 1, count: 1 });
  }, 20000);

  it("reserves one of the primary station's body's orbital slots, leaving the rest for other buildings", async () => {
    const result = await solve(
      baseInput({
        firstStationBuilding: "Coriolis",
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 3, ground: 0, asteroid: 0 } }],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 2 }, atMost: { Commercial_Outpost: 2 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.firstStationBodyId).toBe(1);
    expect(result.placements).toContainEqual({ building: "Coriolis", bodyId: 1, count: 1 });
    // Body 1 has 3 orbital slots; 1 is reserved for the Coriolis primary, leaving exactly 2 for
    // the forced Commercial_Outposts — a 3rd would make this infeasible if the reservation weren't
    // being enforced.
    expect(result.placements).toContainEqual({ building: "Commercial_Outpost", bodyId: 1, count: 2 });
  }, 20000);

  // A body's Orbital 1 slot can carry a stale, manually-entered facility from before that body was
  // ever assigned as the primary station — `domain/presentFacilities.ts`'s `applyPrimaryReservation`
  // overwrites that slot with the primary's own real, synced entry regardless of whatever the
  // caller's `presentFacilities` said was there, so it's never counted as occupied alongside the
  // primary's own reservation (`solve.ts` never trusted caller data hygiene for the primary's
  // identity either, matching how `firstStationBuilding` itself is always taken as given).
  it("doesn't double-count a stale presentFacilities entry left in the primary station's own Orbital-1 slot", async () => {
    const result = await solve(
      baseInput({
        firstStationBuilding: "Coriolis",
        firstStationBodyId: 1,
        bodies: [
          {
            bodyId: 1,
            slots: { space: 2, ground: 0, asteroid: 0 },
            presentFacilities: {
              space: [{ building: "Commercial_Outpost", demolishable: false }, null],
              ground: [],
            },
          },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    // Without the fix: the stale Commercial_Outpost entry occupies slot 0 (hardSpaceCount=1) AND
    // the primary's own reservation ALSO claims a slot, leaving 0 of body 1's 2 slots for the
    // forced Commercial_Outpost — infeasible even though only 1 slot is physically occupied.
    expect(result.status).toBe("optimal");
    expect(result.placements).toContainEqual({ building: "Coriolis", bodyId: 1, count: 1 });
    expect(result.placements).toContainEqual({ building: "Commercial_Outpost", bodyId: 1, count: 1 });
  }, 20000);

  it("is infeasible when the primary station's body has no spare orbital slot for it", async () => {
    // Body 1's single orbital slot is already fully claimed by a forced Commercial_Outpost, leaving
    // none for the Coriolis primary's own reservation.
    const result = await solve(
      baseInput({
        firstStationBuilding: "Coriolis",
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 } }],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("rejects a primary station assigned to a body with no orbital slot at all", async () => {
    const result = await solve(
      baseInput({
        firstStationBuilding: "Coriolis",
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 0, ground: 3, asteroid: 0 } }],
        objective: { kind: "simple", score: "wealth" },
      }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/orbital slot/);
  }, 20000);

  it("leaves firstStationBodyId null when not given, even in per-body mode", async () => {
    const result = await solve(
      baseInput({ bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 } }] }),
    );
    expect(result.status).toBe("optimal");
    expect(result.firstStationBodyId).toBeNull();
  }, 20000);

  it("solves within a reasonable time with 20 bodies (per-body variable-count tractability check)", async () => {
    const bodies = Array.from({ length: 20 }, (_, i) => ({
      bodyId: i + 1,
      slots: { space: 1, ground: 1, asteroid: i === 0 ? 1 : 0 },
    }));
    const start = Date.now();
    const result = await solve(baseInput({ bodies, objective: { kind: "simple", score: "wealth" } }));
    const elapsedMs = Date.now() - start;
    expect(result.status).toBe("optimal");
    expect(elapsedMs).toBeLessThan(20000);
  }, 30000);

  // Real bug found 2026-07-26 (user report): `slotsRemaining` only ever counted NEWLY-built units,
  // silently ignoring already-present facilities and the primary station's reserved slot — a fully-
  // built system still reported it had free slots. The per-body CAPACITY CONSTRAINT was always
  // correct (it separately accounted for present/primary occupancy); only the reported figure was
  // wrong.
  it("reports 0 slots remaining once every physical slot is occupied by present facilities", async () => {
    const result = await solve(
      baseInput({
        firstStationBodyId: 2,
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 1, asteroid: 0 },
            presentFacilities: {
              space: [{ building: "Commercial_Outpost", demolishable: false }],
              ground: [{ building: "Small_Agricultural_Settlement", demolishable: false }],
            },
          },
          { bodyId: 2, slots: { space: 1, ground: 0, asteroid: 0 } }, // primary station's own slot
        ],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.slotsRemaining).toEqual({ space: 0, ground: 0, asteroid: 0 });
  }, 20000);

  // Asteroid-eligible slots are a SUBSET of orbital slots (any orbital slot on a ring-eligible
  // body), not their own pool — occupying that slot with ANY building, not just an Asteroid_Base,
  // must reduce the asteroid-eligible count too. An earlier version only subtracted new/present
  // Asteroid_Base builds specifically, which could contradictorily report asteroid slots free while
  // plain orbital slots (a superset) were already all used up.
  it("counts a non-Asteroid_Base building occupying a ring-eligible body's only orbital slot against the asteroid-eligible pool", async () => {
    const result = await solve(
      baseInput({
        firstStationBodyId: 2,
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 0, asteroid: 1 },
            presentFacilities: { space: [{ building: "Commercial_Outpost", demolishable: false }], ground: [] },
          },
          { bodyId: 2, slots: { space: 1, ground: 0, asteroid: 0 } },
        ],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.slotsRemaining.asteroid).toBe(0);
  }, 20000);

  // A "leave empty" marker (`SolverBody.blockedSlots`) reduces usable capacity exactly like an
  // already-present hard facility, even though nothing is actually built there.
  it("prevents the solver from placing anything in a slot marked blockedSlots", async () => {
    const result = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 }, blockedSlots: { space: [true], ground: [] } }],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("reflects a blocked slot in slotsRemaining even though nothing is built there", async () => {
    // Minimizing construction_cost with no atLeast requirement means the solver's optimal choice
    // is to build nothing at all — isolates the blocked slot's own contribution to slotsRemaining
    // from whatever else a wealth-maximizing objective might otherwise choose to build in the
    // still-open second slot.
    const result = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, blockedSlots: { space: [true, false], ground: [] } }],
        objective: { kind: "simple", score: "construction_cost" },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.slotsRemaining.space).toBe(1);
  }, 20000);

  // The `!present[i]` guard in `countBlockedEmptySlots`: a blocked index that's ALSO occupied by a
  // real present facility (a data-hygiene edge case the UI itself never produces, since it only
  // offers the toggle on an empty slot) must not double-subtract capacity for that one physical slot.
  it("doesn't double-subtract capacity when a blocked index also has a stale present facility", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 0, asteroid: 0 },
            presentFacilities: { space: [{ building: "Commercial_Outpost", demolishable: false }], ground: [] },
            blockedSlots: { space: [true], ground: [] },
          },
        ],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.slotsRemaining.space).toBe(0);
  }, 20000);

  it("blockedSlots omitted is byte-identical to today's behavior", async () => {
    const withoutBlocked = await solve(
      baseInput({ bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 } }] }),
    );
    const withEmptyBlocked = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, blockedSlots: { space: [], ground: [] } }],
      }),
    );
    expect(withEmptyBlocked).toEqual(withoutBlocked);
  }, 20000);
});

describe("solve with already-present facility demolition", () => {
  it("frees a demolishable present facility's slot when a forced new building needs it", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 0, asteroid: 0 },
            presentFacilities: { space: [{ building: "Satellite", demolishable: true }], ground: [] },
          },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Commercial_Outpost).toBe(1);
    expect(result.demolished).toEqual([{ bodyId: 1, slotKind: "space", index: 0, building: "Satellite" }]);
  }, 20000);

  it("never demolishes a non-demolishable present facility, even when infeasible otherwise", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 0, asteroid: 0 },
            presentFacilities: { space: [{ building: "Satellite", demolishable: false }], ground: [] },
          },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);

  it("never treats a present port as demolishable, even if marked so upstream", async () => {
    const result = await solve(
      baseInput({
        bodies: [
          {
            bodyId: 1,
            slots: { space: 1, ground: 0, asteroid: 0 },
            presentFacilities: { space: [{ building: "Coriolis", demolishable: true }], ground: [] },
          },
        ],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("infeasible");
  }, 20000);
});

describe("solve with economy_synergy (input.bodies[].economy)", () => {
  // High metal content + reported Volcanism -> a Colony-default port here picks up an Extraction
  // override (computeBodyEconomyOverrides) AND that Extraction gets a +0.4 strong-link boost
  // (computeBoostDecrease) — see domain/economyOverrides.test.ts for the same rules tested in
  // isolation. Minimal JournalBody: only the fields those two functions actually read are set.
  const volcanicBody: JournalBody = {
    bodyName: "Test 1",
    bodyId: 1,
    kind: "planet",
    planetClass: "High metal content world",
    landable: false,
    parents: [],
    rings: [],
    raw: { Volcanism: "major rocky magma volcanism" },
  };

  it("stays 0 when a body has no `economy` context, even in per-body mode", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 } }],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.objectiveValue).toBe(0);
  }, 20000);

  it("rewards placing a building whose economy is boosted by its body's attributes", async () => {
    const result = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: volcanicBody }],
      }),
    );
    expect(result.status).toBe("optimal");
    // objectiveValue is the exact (un-rounded) LP value the solver actually maximized — the
    // displayed `scores.economy_synergy` is rounded and could read 0 for a single 0.4 delta.
    expect(result.objectiveValue).toBeGreaterThan(0);
  }, 20000);

  it("only gives a small flat weak-link-style trickle — not the full strong-link boost — on a body with no known port", async () => {
    // No `firstStationBodyId` and no present port here: a real strong link can never form on this
    // body (nothing to link to), so the full +0.4-per-condition boost must NOT apply — only
    // domain/links.ts's flat, body-attribute-independent WEAK_LINK_CONTRIBUTION (0.05) per economy
    // the picked building carries (every building here carries exactly one economy type, so this
    // pins the exact value rather than just checking a direction).
    const result = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 }, economy: volcanicBody }],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.objectiveValue).toBeCloseTo(0.05, 5);
  }, 20000);

  it("systemResourceLevel omitted defaults to the same result as explicit 'pristine' (backward-compat)", async () => {
    // volcanicBody has no `reserveLevel` of its own, so before this field existed the system's
    // resource level was "unknown" (no Extraction boost from it). Omitting `systemResourceLevel`
    // must resolve identically to explicitly passing "pristine" — the documented default — not to
    // the old "unknown" behavior.
    const omitted = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: volcanicBody }],
      }),
    );
    const explicitPristine = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: volcanicBody }],
        systemResourceLevel: "pristine",
      }),
    );
    expect(omitted).toEqual(explicitPristine);
  }, 20000);

  it("a manual 'low' override lowers economy_synergy relative to the 'pristine' default, on a body with a known port", async () => {
    const withPristine = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: volcanicBody }],
        systemResourceLevel: "pristine",
      }),
    );
    const withLow = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: volcanicBody }],
        systemResourceLevel: "low",
      }),
    );
    expect(withLow.objectiveValue).toBeLessThan(withPristine.objectiveValue as number);
  }, 20000);

  it("real per-body reserveLevel data always wins over the manual override", async () => {
    const depletedBody: JournalBody = { ...volcanicBody, reserveLevel: "DepletedResources" };
    const withDepletedData = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: depletedBody }],
        systemResourceLevel: "pristine",
      }),
    );
    const withNoOverride = await solve(
      baseInput({
        objective: { kind: "simple", score: "economy_synergy" },
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 2, ground: 0, asteroid: 0 }, economy: depletedBody }],
      }),
    );
    // Real "Depleted" data on the body itself wins over the "pristine" manual override — same
    // result whether the override is set or left at its default.
    expect(withDepletedData).toEqual(withNoOverride);
  }, 20000);
});

describe("solve with economyPreferences (0-200 slider, Forbid)", () => {
  // Small_Military_Settlement is a leaf building (no `dependencies`) whose economy comes from
  // FACILITY_ECONOMY_GUESS (body-independent) — a real body still needs to be attached via
  // `economy` for solve.ts to evaluate `facilityBaseEconomies` at all (see SolverBody.economy's
  // doc comment: no `economy` means no economy-based effect whatsoever, Forbid/preference slider
  // included, same backward-compatible degrade `economy_synergy` already follows).
  const plainBody: JournalBody = {
    bodyName: "Test 1",
    bodyId: 1,
    kind: "planet",
    landable: false,
    parents: [],
    rings: [],
    raw: {},
  };

  it("Forbid zeroes out every building carrying that economy, making an otherwise-satisfiable atLeast requirement infeasible", async () => {
    const bodies = [{ bodyId: 1, slots: { space: 0, ground: 3, asteroid: 0 }, economy: plainBody }];

    const withoutForbid = await solve(
      baseInput({ bodies, constraints: { atLeast: { Small_Military_Settlement: 1 } } }),
    );
    expect(withoutForbid.status).toBe("optimal");
    expect(withoutForbid.toBuild.Small_Military_Settlement).toBeGreaterThanOrEqual(1);

    const withForbid = await solve(
      baseInput({
        bodies,
        constraints: { atLeast: { Small_Military_Settlement: 1 } },
        economyPreferences: { Military: "forbid" },
      }),
    );
    expect(withForbid.status).toBe("infeasible");
  }, 20000);

  it("a high slider value never makes the solve infeasible, even with zero physical capacity for that economy (the old hard Must state was dropped for exactly this risk)", async () => {
    const result = await solve(
      baseInput({
        bodies: [{ bodyId: 1, slots: { space: 0, ground: 0, asteroid: 0 }, economy: plainBody }],
        economyPreferences: { Military: 200 },
      }),
    );
    expect(result.status).toBe("optimal");
  }, 20000);

  it("higher slider values pull more strongly toward an economy than lower ones (maximizing economy_preference alone)", async () => {
    const bodies = [{ bodyId: 1, slots: { space: 0, ground: 1, asteroid: 0 }, economy: plainBody }];
    const objective: SolverInput["objective"] = { kind: "simple", score: "economy_preference" };

    const boostResult = await solve(baseInput({ bodies, objective, economyPreferences: { Military: 150 } }));
    const avoidResult = await solve(baseInput({ bodies, objective, economyPreferences: { Military: 25 } }));

    expect(boostResult.status).toBe("optimal");
    expect(avoidResult.status).toBe("optimal");
    const militaryCount = (r: typeof boostResult) =>
      (r.toBuild.Small_Military_Settlement ?? 0) +
      (r.toBuild.Medium_Military_Settlement ?? 0) +
      (r.toBuild.Large_Military_Settlement ?? 0);
    expect(militaryCount(boostResult)).toBeGreaterThan(0);
    expect(militaryCount(avoidResult)).toBe(0);
  }, 20000);

  it("50 is the slider's neutral crossing point — contributes 0 to economy_preference, same as omitting the economy entirely", async () => {
    const bodies = [{ bodyId: 1, slots: { space: 0, ground: 1, asteroid: 0 }, economy: plainBody }];
    const neutral = await solve(baseInput({ bodies, economyPreferences: { Military: 50 } }));
    const omitted = await solve(baseInput({ bodies }));
    expect(neutral.scores.economy_preference).toBeCloseTo(omitted.scores.economy_preference, 6);
  }, 20000);

  it("economyPreferences omitted, {}, and every value explicitly undefined are byte-identical (backward-compat)", async () => {
    const bodies = [{ bodyId: 1, slots: { space: 1, ground: 1, asteroid: 0 }, economy: plainBody }];
    const omitted = await solve(baseInput({ bodies }));
    const empty = await solve(baseInput({ bodies, economyPreferences: {} }));
    const allUndefined = await solve(
      baseInput({ bodies, economyPreferences: { Military: undefined, Agriculture: undefined } }),
    );
    expect(empty).toEqual(omitted);
    expect(allUndefined).toEqual(omitted);
  }, 20000);

  it("has no effect in aggregate mode (bodies absent) — silently ignored, not an error", async () => {
    const withPrefs = await solve(baseInput({ economyPreferences: { Military: "forbid" } }));
    const without = await solve(baseInput());
    expect(withPrefs).toEqual(without);
  }, 20000);
});
