import { describe, expect, it } from "vitest";
import { solve, type SolverInput } from "./solve";

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    slots: { space: 5, ground: 5, asteroid: 2 },
    objective: { kind: "simple", score: "wealth" },
    initialT2Points: 0,
    initialT3Points: 0,
    chooseFirstStation: false,
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

  it("lets the solver choose the first station when chooseFirstStation is true", async () => {
    const result = await solve(
      baseInput({
        chooseFirstStation: true,
        firstStationBuilding: undefined,
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.firstStation).not.toBeNull();
  }, 20000);

  it("counts a manually-chosen first station's own stats toward system scores at full weight", async () => {
    const result = await solve(
      baseInput({
        slots: { space: 0, ground: 0, asteroid: 0 },
        chooseFirstStation: false,
        firstStationBuilding: "Government", // security: +2, standard_of_living: +7, development_level: +3
        objective: { kind: "simple", score: "development_level" },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(Object.keys(result.toBuild)).toHaveLength(0); // no slots left for anything else
    expect(result.scores.development_level).toBe(3);
    expect(result.scores.security).toBe(2);
    expect(result.scores.standard_of_living).toBe(7);
  }, 20000);

  it("weights a facility built after the first station at the reduced 'subsequent facility' rate", async () => {
    const result = await solve(
      baseInput({
        slots: { space: 1, ground: 0, asteroid: 0 },
        initialT2Points: 5,
        chooseFirstStation: false,
        firstStationBuilding: "Criminal_Outpost", // development_level: 0, isolates Government's effect
        objective: { kind: "simple", score: "development_level" },
        constraints: { atLeast: { Government: 1 }, atMost: { Government: 1 } },
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Government).toBe(1);
    // Government's development_level is 3; built as a subsequent facility at the 40% weight ->
    // round(3 * 0.4) = round(1.2) = 1, not the full 3 it would get as the first station.
    expect(result.scores.development_level).toBe(1);
  }, 20000);

  it("respects allowDodecahedron: false by never picking it as the first station", async () => {
    const result = await solve(
      baseInput({
        chooseFirstStation: true,
        firstStationBuilding: undefined,
        objective: { kind: "simple", score: "development_level" },
        firstStationOptions: {
          allowCoriolis: false,
          allowAsteroidBase: false,
          allowOrbisOrOcellus: false,
          allowDodecahedron: false,
        },
      }),
    );
    // With every primary port disallowed, only the (lower development-level) outposts remain eligible.
    expect(result.status).toBe("optimal");
    expect(result.firstStation).not.toBe("Dodecahedron");
  }, 20000);
});
