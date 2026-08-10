// Real HiGHS end-to-end tests (no solver mocking, matching CLAUDE.md's testing conventions) against
// jsons/swoilz-aw-c-d52.json, the user's own committed real exported system — see
// realSystems.test.ts for the same "always fair game as a test-data source" precedent. This file
// exercises solveIteratively's own orchestration (pass count, convergence, backward-compat parity),
// not solver correctness — solve.test.ts's "solve with economy_synergy" describe block already
// covers synergyKnownPortBodyIds's actual scoring effect in isolation. See
// iterativeSolve.fallback.test.ts for the (mocked) non-optimal-pass fallback path, which isn't
// reachable from a real solve of this always-feasible fixture.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "../App";
import type { JournalSystem } from "../journal/parser";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { solveIteratively } from "./iterativeSolve";
import { solveInWorker } from "./solveInWorker";

const FIXTURE_PATH = path.join(process.cwd(), "jsons", "swoilz-aw-c-d52.json");

function realFormState(): PlannerFormState {
  const system: JournalSystem = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return {
    ...INITIAL_FORM_STATE,
    bodies: system.bodies,
    starSystem: system.starSystem,
    systemAddress: system.systemAddress,
    systemConfigured: true,
    firstStationBuilding: system.firstStationBuilding ?? "",
    firstStationBodyId: system.firstStationBodyId,
    firstStationVariant: system.firstStationVariant,
    firstStationCustomName: system.firstStationCustomName,
  };
}

describe("solveIteratively", () => {
  it("passes: 1 reproduces a direct solveInWorker call exactly (backward-compat)", async () => {
    const input = buildSolverInput(realFormState());
    const direct = await solveInWorker({ ...input, synergyKnownPortBodyIds: [] });
    const { result, passesRun } = await solveIteratively(input, 1);
    expect(passesRun).toBe(1);
    expect(result).toEqual(direct);
  }, 30000);

  it("passes: 0 or negative is clamped to at least one pass", async () => {
    const input = buildSolverInput(realFormState());
    const { result, passesRun } = await solveIteratively(input, 0);
    expect(result.status).toBe("optimal");
    expect(passesRun).toBe(1);
  }, 30000);

  it("a multi-pass run against a real system completes without throwing, never exceeds the requested pass count, and reports convergence whenever it stops early", async () => {
    const input = buildSolverInput(realFormState());
    const onProgressCalls: Array<{ pass: number; total: number }> = [];
    const { result, passesRun, converged } = await solveIteratively(input, 3, (pass, total) =>
      onProgressCalls.push({ pass, total }),
    );

    expect(result.status).toBe("optimal");
    expect(passesRun).toBeGreaterThanOrEqual(1);
    expect(passesRun).toBeLessThanOrEqual(3);
    if (passesRun < 3) expect(converged).toBe(true);

    // onProgress is called once per pass actually run, 1-indexed, total fixed at the requested cap.
    expect(onProgressCalls).toHaveLength(passesRun);
    expect(onProgressCalls.every((c) => c.total === 3)).toBe(true);
    expect(onProgressCalls.map((c) => c.pass)).toEqual(Array.from({ length: passesRun }, (_, i) => i + 1));
  }, 60000);
});
