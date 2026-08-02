// With a self-sufficiency goal checked, the forced combo must land at the very front of the build
// order (right after the primary station), not wherever the generic tier/alphabetical-body ordering
// would otherwise place it — see CLAUDE.md's "Self-sufficiency" section. Runs end-to-end against a
// real system (jsons/swoilz-eg-i-b2-3.json) rather than a synthetic fixture.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "./App";
import { computeForcedBuildingPriority } from "./domain/selfSufficiencyCombos";
import { computeSolvedPlacements, type SolvedSlot } from "./domain/solvedPlacement";
import { getOrderingFromResult } from "./domain/ordering";
import type { JournalSystem } from "./journal/parser";
import { solve } from "./solver/solve";
import { INITIAL_FORM_STATE, type PlannerFormState } from "./state/plannerState";
import { toPlanResult } from "./state/toPlanResult";

const system: JournalSystem = JSON.parse(
  readFileSync(path.join(process.cwd(), "jsons", "swoilz-eg-i-b2-3.json"), "utf-8"),
);

function orderNumbersFor(slots: SolvedSlot[]): number[] {
  return slots
    .filter((s): s is Extract<SolvedSlot, { status: "new" }> => s.status === "new")
    .map((s) => s.order);
}

describe("self-sufficiency build-order priority (real system regression)", () => {
  it("gives the forced Commodity Hub combo on body B 3 much earlier build-order numbers than without priority", async () => {
    const formState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      bodies: system.bodies,
      starSystem: system.starSystem,
      systemAddress: system.systemAddress,
      systemConfigured: true,
      firstStationBuilding: system.firstStationBuilding ?? "",
      firstStationBodyId: system.firstStationBodyId,
      firstStationVariant: system.firstStationVariant,
      firstStationCustomName: system.firstStationCustomName,
      selfSufficiencyGoals: { commodityHub: true },
    };

    const { buildingNames, bodyIds } = computeForcedBuildingPriority(formState.selfSufficiencyGoals, formState.bodies);
    // Sanity check: the best-fit body really is B 3 (bodyId 21).
    expect(bodyIds).toEqual(new Set([21]));
    expect(buildingNames).toEqual(new Set(["Civilian_Planetary_Outpost", "Refinery_Hub"]));

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");
    expect(result.toBuild.Civilian_Planetary_Outpost).toBeGreaterThanOrEqual(1);
    expect(result.toBuild.Refinery_Hub).toBeGreaterThanOrEqual(2);

    const planResult = toPlanResult(formState, result);

    const orderWithoutPriority = getOrderingFromResult(planResult, true, false);
    const { byBody: byBodyWithoutPriority } = computeSolvedPlacements(formState.bodies, result, orderWithoutPriority);
    const groundWithoutPriority = byBodyWithoutPriority.get(21)?.ground ?? [];
    const numbersWithoutPriority = orderNumbersFor(groundWithoutPriority);
    expect(numbersWithoutPriority).toHaveLength(3);

    const orderWithPriority = getOrderingFromResult(planResult, true, false, buildingNames);
    const { byBody: byBodyWithPriority } = computeSolvedPlacements(formState.bodies, result, orderWithPriority, bodyIds);
    const groundWithPriority = byBodyWithPriority.get(21)?.ground ?? [];
    const numbersWithPriority = orderNumbersFor(groundWithPriority);
    expect(numbersWithPriority).toHaveLength(3);

    // Prioritized numbers must be strictly earlier than the unprioritized ones...
    expect(Math.max(...numbersWithPriority)).toBeLessThan(Math.min(...numbersWithoutPriority));
    // ...and genuinely first, not merely earlier: the 3 forced units are the very first 3 things
    // built after the primary station, with no unrelated port or facility allowed to jump ahead of
    // a currently-buildable priority building.
    expect(numbersWithPriority.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  }, 30000);
});
