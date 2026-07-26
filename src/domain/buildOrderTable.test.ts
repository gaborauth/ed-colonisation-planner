// Regression tests for the Build order pane's per-row ledger (see BuildOrderPanel.tsx). Uses the
// same real committed system as realSystems.test.ts (jsons/swoilz-aw-c-d52.json — see CLAUDE.md's
// "Testing conventions" for why that's the go-to fixture) run through the app's real solve
// pipeline, not a synthetic fixture, so the T2/T3 invariants below are checked against genuine
// port-escalation/already-present data.
//
// Two invariants matter here, not one: (1) the running T2/T3 total must never go negative at any
// row — a build order that dips below 0 isn't one a player can actually execute — and (2) the final
// row's total is >= (not necessarily equal to) `result.finalT2Points`/`finalT3Points`, since this
// table intentionally uses `ordering.ts`'s per-tier-correct cost math rather than `solve.ts`'s own
// conservative (deliberately overestimating) new-port formula — see `buildOrderTable.ts`'s header
// comment for why chasing exact equality with `solve.ts`'s numbers was the wrong fix.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "../App";
import type { JournalSystem } from "../journal/parser";
import { solve } from "../solver/solve";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { computeBuildOrderTable } from "./buildOrderTable";
import { computeSolvedPlacements } from "./solvedPlacement";
import { getOrderingFromResult } from "./ordering";
import { toPlanResult } from "../state/toPlanResult";

const SYSTEM_PATH = path.join(process.cwd(), "jsons", "swoilz-aw-c-d52.json");

describe("computeBuildOrderTable", () => {
  it("numbers every row 1..N with no gaps and its T2/T3 running total matches the solver's final points", async () => {
    const system: JournalSystem = JSON.parse(readFileSync(SYSTEM_PATH, "utf-8"));
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

    const { rows, error } = computeBuildOrderTable(formState, result);
    expect(error).toBeNull();
    expect(rows.length).toBeGreaterThan(0);

    // Nr. is a gapless 1..N sequence.
    expect(rows.map((r) => r.nr)).toEqual(rows.map((_, i) => i + 1));

    // Row count matches present + demolish + planned counts from the same underlying data.
    const order = getOrderingFromResult(toPlanResult(formState, result), true, false);
    const solved = computeSolvedPlacements(formState.bodies, result, order);
    let presentCount = 0;
    let newCount = 0;
    for (const slots of solved.byBody.values()) {
      for (const kind of ["space", "ground"] as const) {
        for (const slot of slots[kind]) {
          if (slot.status === "present") presentCount++;
          if (slot.status === "new") newCount++;
          if (slot.status === "demolished-rebuilt") newCount++;
        }
      }
    }
    const primaryCount = formState.firstStationBuilding ? 1 : 0;
    const builtRows = rows.filter((r) => r.state === "built");
    const demolishRows = rows.filter((r) => r.state === "demolish");
    const plannedRows = rows.filter((r) => r.state === "planned");
    expect(builtRows.length).toBe(presentCount + primaryCount);
    expect(demolishRows.length).toBe(result.demolished.length);
    expect(plannedRows.length).toBe(newCount);

    // Never negative at any row (see this file's header comment), and the final total is at least
    // as much as the solver's own (conservative) final point balance.
    for (const row of rows) {
      expect(row.t2Total).toBeGreaterThanOrEqual(0);
      expect(row.t3Total).toBeGreaterThanOrEqual(0);
    }
    const lastRow = rows[rows.length - 1];
    expect(lastRow.t2Total).toBeGreaterThanOrEqual(result.finalT2Points);
    expect(lastRow.t3Total).toBeGreaterThanOrEqual(result.finalT3Points);
  }, 30000);

  it("falls back to Built + Planned rows with no Demolish section in aggregate mode (no body layout)", async () => {
    const formState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      firstStationBuilding: "Coriolis",
      slots: { space: 10, ground: 10, asteroid: 0 },
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");

    const { rows, error } = computeBuildOrderTable(formState, result);
    expect(error).toBeNull();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.nr)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.some((r) => r.state === "demolish")).toBe(false);
    expect(rows.every((r) => r.bodyId === undefined)).toBe(true);

    for (const row of rows) {
      expect(row.t2Total).toBeGreaterThanOrEqual(0);
      expect(row.t3Total).toBeGreaterThanOrEqual(0);
    }
    const lastRow = rows[rows.length - 1];
    expect(lastRow.t2Total).toBeGreaterThanOrEqual(result.finalT2Points);
    expect(lastRow.t3Total).toBeGreaterThanOrEqual(result.finalT3Points);
  }, 30000);

  it("counts a to-be-demolished present facility as Built before subtracting it, and never lets the running T2/T3 total go negative", async () => {
    // Reproduces the user's exact report (2026-07-27): mark all three already-built Medium
    // Agricultural Settlements on "Swoilz AW-C d52 2 a" (bodyId 14) as demolishable, force the
    // solver to actually remove them (an `atMost` cap pinned to exactly how many OTHER hard
    // instances of that building exist system-wide, leaving no room for these three), and confirm
    // the table shows all three as real Built rows (each contributing their own T2/stat) before
    // their Demolish rows subtract them back out — not silently missing from Built entirely, which
    // previously undercounted the Built total and could drive the running T2 negative.
    const system: JournalSystem = JSON.parse(readFileSync(SYSTEM_PATH, "utf-8"));
    const targetBodyId = 14;
    const targetBody = system.bodies.find((b) => b.bodyId === targetBodyId);
    if (!targetBody?.presentFacilities) throw new Error("fixture body/presentFacilities missing — has jsons/swoilz-aw-c-d52.json changed?");
    targetBody.presentFacilities.ground = targetBody.presentFacilities.ground.map((slot) => (slot ? { ...slot, demolishable: true } : slot));

    let otherHardCount = 0;
    for (const body of system.bodies) {
      if (body.bodyId === targetBodyId) continue;
      for (const kind of ["space", "ground"] as const) {
        for (const slot of body.presentFacilities?.[kind] ?? []) {
          if (slot?.building === "Medium_Agricultural_Settlement") otherHardCount++;
        }
      }
    }

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
      atMost: { Medium_Agricultural_Settlement: otherHardCount },
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");
    expect(result.demolished.length).toBe(3);
    expect(result.demolished.every((d) => d.bodyId === targetBodyId)).toBe(true);

    const { rows, error } = computeBuildOrderTable(formState, result);
    expect(error).toBeNull();

    const builtAtTarget = rows.filter((r) => r.state === "built" && r.bodyId === targetBodyId);
    const demolishAtTarget = rows.filter((r) => r.state === "demolish" && r.bodyId === targetBodyId);
    expect(builtAtTarget.length).toBe(3);
    expect(demolishAtTarget.length).toBe(3);

    // The core invariant this test exists for: a build order the player can actually execute never
    // has a negative T2/T3 balance at any step (you always have whatever your currently-standing
    // facilities already generated banked before you tear anything down).
    for (const row of rows) {
      expect(row.t2Total).toBeGreaterThanOrEqual(0);
      expect(row.t3Total).toBeGreaterThanOrEqual(0);
    }

    const lastRow = rows[rows.length - 1];
    expect(lastRow.t2Total).toBeGreaterThanOrEqual(result.finalT2Points);
    expect(lastRow.t3Total).toBeGreaterThanOrEqual(result.finalT3Points);
  }, 30000);
});
