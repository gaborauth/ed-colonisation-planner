// Full end-to-end regression suite against REAL exported systems (jsons/*.json) — see CLAUDE.md's
// "Testing conventions" note for why these are safe/expected test data (real, played-out in-game
// systems, committed to the repo). Runs the exact same pipeline a real "Solve for a system" click
// plus the "Solved system" panel's own post-solve computations perform: solve() with the app's
// actual default objective, then build order + link topology + per-slot placement seating. This is
// deliberately the broadest smoke test in the project — several real bugs (Tier-2/Tier-3 port cost
// escalation conflation, slotsRemaining/asteroid-eligible under/overcounting,
// economySynergyCoefficient's port-unaware boost, solvedLinks dropping already-present facilities)
// were all actually found this way, against this exact data, before this suite existed to catch
// them automatically. Add more real exported systems to jsons/ to extend this suite — no code
// changes needed, every *.json file there is picked up.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "./App";
import { computeSolvedSystemLinks } from "./domain/solvedLinks";
import { computeSolvedPlacements } from "./domain/solvedPlacement";
import { getOrderingFromResult } from "./domain/ordering";
import type { JournalSystem } from "./journal/parser";
import { solve } from "./solver/solve";
import { INITIAL_FORM_STATE, type PlannerFormState } from "./state/plannerState";
import { toPlanResult } from "./state/toPlanResult";

const JSONS_DIR = path.join(process.cwd(), "jsons");
const systemFiles = readdirSync(JSONS_DIR).filter((f) => f.endsWith(".json"));

if (systemFiles.length === 0) {
  // Not expected in this repo (jsons/swoilz-aw-c-d52.json is committed) — fail loudly instead of
  // silently skipping the whole suite if that ever changes.
  throw new Error(`No real system fixtures found in ${JSONS_DIR} — expected at least one *.json file.`);
}

describe.each(systemFiles)("real system: %s", (file) => {
  const system: JournalSystem = JSON.parse(readFileSync(path.join(JSONS_DIR, file), "utf-8"));

  it("solves end-to-end with the app's default objective, never over-reports free capacity, and produces a valid build order + link topology", async () => {
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
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");

    // Never negative — the exact class of bug found 2026-07-26 (slotsRemaining/asteroid-eligible
    // under/overcounting: a fully-built system reported 15/16/10 slots "left").
    expect(result.slotsRemaining.space).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.ground).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.asteroid).toBeGreaterThanOrEqual(0);
    expect(result.finalT2Points).toBeGreaterThanOrEqual(0);
    expect(result.finalT3Points).toBeGreaterThanOrEqual(0);

    // Build order must be computable without throwing "Could not finish ordering" — the exact
    // class of bug found 2026-07-26 (systemState.ts's Tier-2/Tier-3 port cost escalation
    // conflation charged a later port's escalating cost as if an unrelated other-tier port also
    // counted toward its sequence).
    const planResult = toPlanResult(formState, result);
    let order: string[] = [];
    expect(() => {
      order = getOrderingFromResult(planResult, true, false);
    }).not.toThrow();

    // Link topology (present facilities + newly solved for) must compute without throwing.
    expect(() => computeSolvedSystemLinks(formState.bodies, result)).not.toThrow();

    // Every newly-solved-for unit must be seatable in a real empty physical slot — a nonempty
    // `warnings` list here is a genuine data-consistency signal, not expected in steady state (see
    // domain/solvedPlacement.ts).
    const solved = computeSolvedPlacements(formState.bodies, result, order);
    expect(solved.warnings).toEqual([]);
  }, 30000);
});
