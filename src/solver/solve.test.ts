import { describe, expect, it } from "vitest";
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

  it("assigns the primary station to a body without consuming that body's ordinary slot capacity", async () => {
    const result = await solve(
      baseInput({
        firstStationBuilding: "Coriolis",
        firstStationBodyId: 1,
        bodies: [{ bodyId: 1, slots: { space: 1, ground: 0, asteroid: 0 } }],
        objective: { kind: "simple", score: "wealth" },
        constraints: { atLeast: { Commercial_Outpost: 1 }, atMost: { Commercial_Outpost: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.firstStationBodyId).toBe(1);
    expect(result.placements).toContainEqual({ building: "Coriolis", bodyId: 1, count: 1 });
    // Body 1's only orbital slot went to the new Commercial_Outpost, proving Coriolis-as-primary
    // didn't consume it — it has its own dedicated, uncounted slot.
    expect(result.placements).toContainEqual({ building: "Commercial_Outpost", bodyId: 1, count: 1 });
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
