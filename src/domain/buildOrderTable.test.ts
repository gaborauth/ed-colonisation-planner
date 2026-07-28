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
import { ALL_SCORES, type Score } from "../data/buildings";
import type { JournalBody, JournalSystem } from "../journal/parser";
import { solve, type SolverResult } from "../solver/solve";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { computeBuildOrderTable } from "./buildOrderTable";
import { computeSolvedPlacements } from "./solvedPlacement";
import { getOrderingFromResult } from "./ordering";
import { syncPrimaryIntoBodies } from "./presentFacilities";
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

    // The primary station's own row (always first) is flagged and shows its real body/slot, not "—".
    expect(rows[0].isPrimary).toBe(true);
    expect(rows[0].building).toBe(system.firstStationBuilding);
    expect(rows[0].bodyId).toBe(system.firstStationBodyId);
    expect(rows[0].slotLabel).toBe("Orbital 1");
    expect(rows.slice(1).every((r) => !r.isPrimary)).toBe(true);

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

  // Exercises a real interaction that only surfaces with an ESCALATING-cost primary like Coriolis
  // (never with a flat-cost Outpost): once the primary has its own real, synced `presentFacilities`
  // entry (`PresentFacilitySlot.primary`) — which the real app's `plannerReducer` always applies,
  // unlike this file's other tests, which bypass it by assigning `formState.bodies` directly —
  // `computeValidatedBuiltOrder` must not pick that entry up as an extra, un-exempted port on top of
  // the separate `firstStationBuilding` seed already given to `computeFeasibleOrder`; doing so would
  // double-charge the escalating port's cost and throw off every subsequent real port's sequence
  // position (`presentBuildOrderHint`'s `excludePrimary` option is what prevents this).
  it("doesn't throw when the primary station's own synced presentFacilities entry is present (real app path via plannerReducer)", async () => {
    const system: JournalSystem = JSON.parse(readFileSync(SYSTEM_PATH, "utf-8"));
    const reconciledBodies = syncPrimaryIntoBodies(
      system.bodies,
      system.firstStationBodyId,
      system.firstStationBuilding,
      system.firstStationVariant,
      system.firstStationCustomName,
    );
    // Confirms the fixture's primary really is an escalating-cost port (Coriolis), not a flat-cost
    // one (Outpost) — the distinction this test is specifically about.
    expect(system.firstStationBuilding).toBe("Coriolis");
    const primaryBody = reconciledBodies.find((b) => b.bodyId === system.firstStationBodyId)!;
    expect(primaryBody.presentFacilities?.space[0]).toMatchObject({ building: "Coriolis", primary: true });

    const formState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      bodies: reconciledBodies,
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
    for (const row of rows) {
      expect(row.t2Total).toBeGreaterThanOrEqual(0);
      expect(row.t3Total).toBeGreaterThanOrEqual(0);
    }
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

  it("survives extreme demolition (most present facilities removed) without throwing or going negative", async () => {
    // Regression test for the "Could not finish ordering" bug tracked as a backlog follow-up (see
    // CLAUDE.md's Gotchas + TASKS.md), reproduced here for real: mark EVERY present facility across
    // EVERY body demolishable, and cap `atMost` at 0 for every present non-port building type so the
    // solver removes essentially all of them (only the two escalating-cost ports — Coriolis and
    // Orbis_or_Ocellus — survive, since ports are never demolishable). Two distinct bugs both had to
    // be fixed for this to pass:
    // (1) `ordering.ts`'s `computeFeasibleOrder` only ever tried the head of its ports queue —
    //     fixed by searching the whole queue (see ordering.test.ts's dedicated unit test).
    // (2) Demolishing enough point-generating facilities while the two already-present ports keep
    //     their full historical escalating cost charged can force a real T2/T3 deficit if Demolish
    //     rows are all forced before any Planned (rebuild) row — fixed by `scheduleDemolishAndPlanned`
    //     interleaving them (deferring an unsafe demolish until a Planned row restores the balance),
    //     NOT by clamping the number (an earlier version of this fix did that, and got called out
    //     during user review for making the Delta/Total columns visibly disagree with each other).
    const system: JournalSystem = JSON.parse(readFileSync(SYSTEM_PATH, "utf-8"));
    for (const body of system.bodies) {
      if (!body.presentFacilities) continue;
      for (const kind of ["space", "ground"] as const) {
        body.presentFacilities[kind] = body.presentFacilities[kind].map((slot) =>
          slot ? { ...slot, demolishable: true } : slot,
        );
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
      atMost: {
        Communication_Station: 0,
        Government: 0,
        Medium_Agricultural_Settlement: 0,
        Military_Outpost: 0,
        Refinery_Hub: 0,
        Civilian_Planetary_Outpost: 0,
      },
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");
    // Sanity check this actually IS the extreme-demolition scenario, not a milder one.
    expect(result.demolished.length).toBeGreaterThan(20);

    const { rows, error } = computeBuildOrderTable(formState, result);
    expect(error).toBeNull();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.nr)).toEqual(rows.map((_, i) => i + 1));

    for (const row of rows) {
      expect(row.t2Total).toBeGreaterThanOrEqual(0);
      expect(row.t3Total).toBeGreaterThanOrEqual(0);
    }
    const lastRow = rows[rows.length - 1];
    expect(lastRow.t2Total).toBeGreaterThanOrEqual(result.finalT2Points);
    expect(lastRow.t3Total).toBeGreaterThanOrEqual(result.finalT3Points);

    // Prove the scheduler actually reordered rows rather than coincidentally staying safe with the
    // naive "all demolishes, then all planned builds" order: at least one Planned row must land
    // BEFORE the last Demolish row.
    const states = rows.map((r) => r.state);
    const lastDemolishIndex = states.lastIndexOf("demolish");
    const firstPlannedIndex = states.indexOf("planned");
    expect(firstPlannedIndex).toBeGreaterThan(-1);
    expect(firstPlannedIndex).toBeLessThan(lastDemolishIndex);
  }, 30000);

  it("shows a demolish-then-rebuild-the-SAME-building pair as one plain Built row, not a Demolish+Planned pair", () => {
    // 2026-07-28 user report: demolishing a facility only to rebuild the identical building type
    // there is real wasted commodities for zero net benefit. Uses a hand-built SolverResult (not a
    // real `solve()` call) since which specific slot HiGHS's tie-breaking lands a same-building
    // collision on is an implementation detail this test shouldn't depend on — this exercises the
    // FIX directly against a scenario known to trigger it, same as solvedPlacement.test.ts's own
    // dedicated case for the same bug.
    const bodies: JournalBody[] = [
      {
        bodyName: "A 1",
        bodyId: 1,
        kind: "planet",
        landable: true,
        parents: [],
        rings: [],
        raw: {},
        slots: { space: 0, ground: 1, asteroid: 0 },
        presentFacilities: {
          space: [],
          ground: [{ building: "Small_Military_Settlement", demolishable: true }],
        },
      },
    ];
    const formState: PlannerFormState = { ...INITIAL_FORM_STATE, bodies, systemConfigured: true };
    const result: SolverResult = {
      status: "optimal",
      toBuild: { Small_Military_Settlement: 1 },
      portOrder: [],
      firstStation: null,
      scores: Object.fromEntries(ALL_SCORES.map((s: Score) => [s, 0])) as Record<Score, number>,
      finalT2Points: 0,
      finalT3Points: 0,
      slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
      objectiveValue: 0,
      placements: [{ building: "Small_Military_Settlement", bodyId: 1, count: 1 }],
      firstStationBodyId: null,
      demolished: [{ bodyId: 1, slotKind: "ground", index: 0, building: "Small_Military_Settlement" }],
    };

    const { rows, error } = computeBuildOrderTable(formState, result);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "built", building: "Small_Military_Settlement", bodyId: 1 });
    expect(rows.some((r) => r.state === "demolish")).toBe(false);
    expect(rows.some((r) => r.state === "planned")).toBe(false);
  });
});
