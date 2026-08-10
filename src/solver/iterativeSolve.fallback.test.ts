// solveIteratively's non-optimal-pass fallback (see iterativeSolve.ts's doc comment: widening
// synergyKnownPortBodyIds can never change feasibility, so a non-optimal pass 2+ is a transient
// solver-internal issue, not a consequence of this feature — the last known-optimal result should
// win instead of surfacing an error the user didn't cause). Not reachable from a real solve of the
// always-feasible fixture iterativeSolve.test.ts uses, so this mocks `solveInWorker` to force the
// sequence directly — testing this file's own orchestration/control-flow, not solver correctness
// (see JournalImportPanel.test.tsx for the same "mock one collaborator module" precedent).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SCORES, type Score } from "../data/buildings";
import type { SolverInput, SolverResult } from "./solve";

vi.mock("./solveInWorker", () => ({ solveInWorker: vi.fn() }));

import { solveIteratively } from "./iterativeSolve";
import { solveInWorker } from "./solveInWorker";

const mockedSolveInWorker = vi.mocked(solveInWorker);

const ZERO_SCORES = Object.fromEntries(ALL_SCORES.map((s) => [s, 0])) as Record<Score, number>;

function fakeInput(): SolverInput {
  return {
    slots: { space: 5, ground: 5, asteroid: 0 },
    objective: { kind: "simple", score: "wealth" },
    firstStationBuilding: "Coriolis",
    allowCriminal: true,
    alreadyPresent: {},
  };
}

function optimalResult(overrides: Partial<SolverResult> = {}): SolverResult {
  return {
    status: "optimal",
    toBuild: {},
    portOrder: [],
    firstStation: "Coriolis",
    scores: ZERO_SCORES,
    finalT2Points: 0,
    finalT3Points: 0,
    slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
    objectiveValue: 0,
    placements: [{ building: "Coriolis", bodyId: 1, count: 1 }],
    firstStationBodyId: 1,
    demolished: [],
    ...overrides,
  };
}

describe("solveIteratively fallback on a non-optimal pass 2+", () => {
  beforeEach(() => {
    mockedSolveInWorker.mockReset();
  });

  it("falls back to the last known-optimal result instead of surfacing a later pass's failure", async () => {
    const pass1 = optimalResult();
    const pass2Failure: SolverResult = { status: "infeasible", toBuild: {}, portOrder: [], firstStation: null,
      scores: ZERO_SCORES, finalT2Points: 0, finalT3Points: 0, slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
      objectiveValue: null, placements: [], firstStationBodyId: null, demolished: [] };
    mockedSolveInWorker.mockResolvedValueOnce(pass1).mockResolvedValueOnce(pass2Failure);

    const { result, passesRun, converged } = await solveIteratively(fakeInput(), 3);

    expect(result).toEqual(pass1);
    expect(passesRun).toBe(1);
    expect(converged).toBe(false);
    // Stops after the failing pass — never attempts a 3rd call.
    expect(mockedSolveInWorker).toHaveBeenCalledTimes(2);
  });

  it("propagates a pass-1 failure as-is (nothing to fall back to)", async () => {
    const pass1Failure: SolverResult = { status: "error", message: "boom", toBuild: {}, portOrder: [],
      firstStation: null, scores: ZERO_SCORES, finalT2Points: 0, finalT3Points: 0,
      slotsRemaining: { space: 0, ground: 0, asteroid: 0 }, objectiveValue: null, placements: [],
      firstStationBodyId: null, demolished: [] };
    mockedSolveInWorker.mockResolvedValueOnce(pass1Failure);

    const { result, passesRun, converged } = await solveIteratively(fakeInput(), 3);

    expect(result).toEqual(pass1Failure);
    expect(passesRun).toBe(1);
    expect(converged).toBe(false);
    expect(mockedSolveInWorker).toHaveBeenCalledTimes(1);
  });

  it("stops early (converged) once a pass reproduces the exact known-port set it was given", async () => {
    const stable = optimalResult({ placements: [{ building: "Coriolis", bodyId: 1, count: 1 }] });
    // Pass 1 starts from [] and builds a port at body 1 -> next set is [1], different from [] -> continues.
    // Pass 2 starts from [1] and builds the identical port at body 1 -> next set is [1] again -> converged.
    mockedSolveInWorker.mockResolvedValueOnce(stable).mockResolvedValueOnce(stable);

    const { result, passesRun, converged } = await solveIteratively(fakeInput(), 5);

    expect(result).toEqual(stable);
    expect(passesRun).toBe(2);
    expect(converged).toBe(true);
    expect(mockedSolveInWorker).toHaveBeenCalledTimes(2);
  });
});
