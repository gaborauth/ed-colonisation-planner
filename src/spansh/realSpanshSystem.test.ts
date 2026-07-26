// Smoke test for the Spansh import path, sibling to ../realSystems.test.ts's pattern but not
// folded into its describe.each (the input shape differs: a Spansh dump record, not an already-
// JournalSystem-shaped exported file). Runs spanshDumpToJournalSystem on the committed real dump
// fixture, then the exact same pipeline a real "Solve for a system" click plus the "Solved system"
// panel's own post-solve computations perform — catches adapter bugs (bad field mapping, unit
// conversion mistakes, a crash on a Barycentre entry, etc.) that only surface downstream of the
// adapter itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "../App";
import { computeSolvedSystemLinks } from "../domain/solvedLinks";
import { computeSolvedPlacements } from "../domain/solvedPlacement";
import { getOrderingFromResult } from "../domain/ordering";
import { estimateBodySlots } from "../journal/eligibility";
import { solve } from "../solver/solve";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";
import { spanshDumpToJournalSystem } from "./adapter";
import type { SpanshDumpRecord } from "./types";

const record: SpanshDumpRecord = JSON.parse(
  readFileSync(path.join(process.cwd(), "spansh-jsons", "swoilz-aw-c-d52-dump.json"), "utf-8"),
).system;

describe("real Spansh system: swoilz-aw-c-d52-dump.json", () => {
  it("solves end-to-end after adaptation, never over-reports free capacity, and produces a valid build order + link topology", async () => {
    const system = spanshDumpToJournalSystem(record);
    // Mirrors JournalImportPanel's own pre-fill step (withDefaultSlots) — a freshly-loaded system
    // has no slots yet until estimateBodySlots seeds them, same as a fresh Journal upload.
    const bodies = system.bodies.map((b) => ({ ...b, slots: estimateBodySlots(b).slots }));

    const formState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      bodies,
      starSystem: system.starSystem,
      systemAddress: system.systemAddress,
      systemConfigured: true,
      // A fresh Spansh-loaded system (like a fresh Journal upload) has no primary station chosen
      // yet — a real user picks one in the System facilities panel before solving. Picking the
      // main star (bodyId 0, confirmed present above) here just to make the model feasible.
      firstStationBuilding: "Coriolis",
      firstStationBodyId: 0,
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");

    expect(result.slotsRemaining.space).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.ground).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.asteroid).toBeGreaterThanOrEqual(0);
    expect(result.finalT2Points).toBeGreaterThanOrEqual(0);
    expect(result.finalT3Points).toBeGreaterThanOrEqual(0);

    const planResult = toPlanResult(formState, result);
    let order: string[] = [];
    expect(() => {
      order = getOrderingFromResult(planResult, true, false);
    }).not.toThrow();

    expect(() => computeSolvedSystemLinks(formState.bodies, result)).not.toThrow();

    const solved = computeSolvedPlacements(formState.bodies, result, order);
    expect(solved.warnings).toEqual([]);
  }, 30000);
});
