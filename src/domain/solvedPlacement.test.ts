import { describe, expect, it } from "vitest";
import { ALL_SCORES, type Score } from "../data/buildings";
import type { JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";
import { computeSolvedPlacements } from "./solvedPlacement";

function body(bodyId: number, bodyName: string, overrides: Partial<JournalBody> = {}): JournalBody {
  return {
    bodyName,
    bodyId,
    kind: "planet",
    landable: true,
    parents: [],
    rings: [],
    raw: {},
    ...overrides,
  };
}

function result(overrides: Partial<SolverResult> = {}): SolverResult {
  return {
    status: "optimal",
    toBuild: {},
    portOrder: [],
    firstStation: "Coriolis",
    scores: Object.fromEntries(ALL_SCORES.map((s: Score) => [s, 0])) as Record<Score, number>,
    finalT2Points: 0,
    finalT3Points: 0,
    slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
    objectiveValue: 0,
    placements: [],
    firstStationBodyId: null,
    demolished: [],
    ...overrides,
  };
}

describe("computeSolvedPlacements", () => {
  it("labels the primary station's reserved slot, present facilities, and a newly-solved slot on the same body", () => {
    const bodies = [
      body(1, "A 1", {
        slots: { space: 3, ground: 0, asteroid: 0 },
        presentFacilities: {
          space: [null, { building: "Commercial_Outpost", demolishable: false }, null],
          ground: [],
        },
      }),
    ];
    const r = result({
      firstStation: "Coriolis",
      firstStationBodyId: 1,
      placements: [
        { building: "Coriolis", bodyId: 1, count: 1 },
        { building: "Military_Outpost", bodyId: 1, count: 1 },
      ],
    });
    const { byBody, warnings } = computeSolvedPlacements(bodies, r, ["Military_Outpost"]);
    expect(warnings).toEqual([]);
    expect(byBody.get(1)?.space).toEqual([
      { status: "primary" },
      { status: "present", building: "Commercial_Outpost", nickname: undefined, variant: undefined },
      { status: "new", building: "Military_Outpost", order: 1 },
    ]);
  });

  it("labels a demolished-and-rebuilt slot and a demolished-with-nothing-rebuilt slot separately", () => {
    // Small_Agricultural_Settlement is a ground-slot building — demolished/rebuilt on a ground
    // slot here, so the pool lookup's slot-kind filter actually matches.
    const bodies = [
      body(2, "A 2", {
        slots: { space: 0, ground: 1, asteroid: 0 },
        presentFacilities: { space: [], ground: [{ building: "Small_Military_Settlement", demolishable: true }] },
      }),
      body(3, "A 3", {
        slots: { space: 0, ground: 1, asteroid: 0 },
        presentFacilities: { space: [], ground: [{ building: "Small_Military_Settlement", demolishable: true }] },
      }),
    ];
    const r = result({
      demolished: [
        { bodyId: 2, slotKind: "ground", index: 0, building: "Small_Military_Settlement" },
        { bodyId: 3, slotKind: "ground", index: 0, building: "Small_Military_Settlement" },
      ],
      placements: [{ building: "Small_Agricultural_Settlement", bodyId: 2, count: 1 }],
    });
    const { byBody } = computeSolvedPlacements(bodies, r, ["Small_Agricultural_Settlement"]);
    expect(byBody.get(2)?.ground).toEqual([
      { status: "demolished-rebuilt", demolishedBuilding: "Small_Military_Settlement", building: "Small_Agricultural_Settlement", order: 1 },
    ]);
    expect(byBody.get(3)?.ground).toEqual([{ status: "demolished", building: "Small_Military_Settlement" }]);
  });

  it("treats a demolish-then-rebuild-the-SAME-building pair as untouched instead, carrying forward the original nickname/variant", () => {
    // 2026-07-28 user report: demolishing a facility only to rebuild the identical building type
    // there is real wasted commodities for zero net benefit — a pure artifact of this module's
    // arbitrary seating order, not a deliberate recommendation. Should read as `"present"`, not
    // `"demolished-rebuilt"`.
    const bodies = [
      body(6, "A 6", {
        slots: { space: 0, ground: 1, asteroid: 0 },
        presentFacilities: {
          space: [],
          ground: [{ building: "Small_Military_Settlement", demolishable: true, customName: "Jacob's outpost", variant: "Some variant" }],
        },
      }),
    ];
    const r = result({
      demolished: [{ bodyId: 6, slotKind: "ground", index: 0, building: "Small_Military_Settlement" }],
      placements: [{ building: "Small_Military_Settlement", bodyId: 6, count: 1 }],
    });
    const { byBody, warnings } = computeSolvedPlacements(bodies, r, ["Small_Military_Settlement"]);
    expect(byBody.get(6)?.ground).toEqual([
      { status: "present", building: "Small_Military_Settlement", nickname: "Jacob's outpost", variant: "Some variant" },
    ]);
    // The new-build unit is still consumed from the pool (via `takeNext`), so no phantom
    // "nowhere to seat this" warning should appear.
    expect(warnings).toEqual([]);
  });

  it("reproduces the user's real 3-in-a-row report: 3 demolished Medium Agricultural Settlements, 3 new ones needed on the same body", () => {
    const bodies = [
      body(7, "A 7", {
        slots: { space: 0, ground: 3, asteroid: 0 },
        presentFacilities: {
          space: [],
          ground: [
            { building: "Medium_Agricultural_Settlement", demolishable: true },
            { building: "Medium_Agricultural_Settlement", demolishable: true },
            { building: "Medium_Agricultural_Settlement", demolishable: true },
          ],
        },
      }),
    ];
    const r = result({
      demolished: [
        { bodyId: 7, slotKind: "ground", index: 0, building: "Medium_Agricultural_Settlement" },
        { bodyId: 7, slotKind: "ground", index: 1, building: "Medium_Agricultural_Settlement" },
        { bodyId: 7, slotKind: "ground", index: 2, building: "Medium_Agricultural_Settlement" },
      ],
      placements: [{ building: "Medium_Agricultural_Settlement", bodyId: 7, count: 3 }],
    });
    const { byBody, warnings } = computeSolvedPlacements(bodies, r, [
      "Medium_Agricultural_Settlement",
      "Medium_Agricultural_Settlement",
      "Medium_Agricultural_Settlement",
    ]);
    expect(byBody.get(7)?.ground).toEqual([
      { status: "present", building: "Medium_Agricultural_Settlement", nickname: undefined, variant: undefined },
      { status: "present", building: "Medium_Agricultural_Settlement", nickname: undefined, variant: undefined },
      { status: "present", building: "Medium_Agricultural_Settlement", nickname: undefined, variant: undefined },
    ]);
    expect(warnings).toEqual([]);
  });

  it("leaves a slot with no present facility and no solved placement as empty", () => {
    const bodies = [body(4, "A 4", { slots: { space: 1, ground: 0, asteroid: 0 } })];
    const { byBody } = computeSolvedPlacements(bodies, result(), []);
    expect(byBody.get(4)?.space).toEqual([{ status: "empty" }]);
  });

  it("warns instead of throwing when a placement can't be seated in any empty slot", () => {
    const bodies = [body(5, "A 5", { slots: { space: 1, ground: 0, asteroid: 0 } })];
    const r = result({ placements: [{ building: "Commercial_Outpost", bodyId: 5, count: 2 }] });
    const { byBody, warnings } = computeSolvedPlacements(bodies, r, ["Commercial_Outpost", "Commercial_Outpost"]);
    expect(byBody.get(5)?.space).toEqual([{ status: "new", building: "Commercial_Outpost", order: 1 }]);
    expect(warnings).toHaveLength(1);
    // Exact message, not just a substring match — `poolKey`'s join separator and this warning's
    // parse-back split must actually agree (real bug found 2026-07-26: `poolKey` joined with a
    // literal NUL character while this split on a plain space, so `building` always came back
    // `undefined` here — a `.toMatch(/Commercial_Outpost/)`-only assertion didn't catch it, since
    // the bodyId/building were still concatenated together elsewhere in the string).
    expect(warnings[0]).toBe("1x Commercial_Outpost solved for body 5 but no empty slot was found there.");
  });
});
