import { describe, expect, it } from "vitest";
import { ALL_SCORES, type Score } from "../data/buildings";
import type { JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";
import { computeSolvedSystemLinks, toSolvedBuildingPlacements } from "./solvedLinks";

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

describe("toSolvedBuildingPlacements", () => {
  it("includes already-present facilities/ports alongside result.placements (not just the new-build ones)", () => {
    const bodies = [
      body(1, "A 1", {
        slots: { space: 1, ground: 1, asteroid: 0 },
        presentFacilities: {
          space: [{ building: "Commercial_Outpost", demolishable: false }],
          ground: [{ building: "Small_Military_Settlement", demolishable: false }],
        },
      }),
    ];
    const r = result({ placements: [{ building: "High_Tech_Hub", bodyId: 1, count: 1 }] });
    const placements = toSolvedBuildingPlacements(bodies, r);
    expect(placements).toContainEqual({ building: "Commercial_Outpost", bodyId: 1, count: 1 });
    expect(placements).toContainEqual({ building: "Small_Military_Settlement", bodyId: 1, count: 1 });
    expect(placements).toContainEqual({ building: "High_Tech_Hub", bodyId: 1, count: 1 });
  });

  it("excludes a present facility the solver demolished", () => {
    const bodies = [
      body(1, "A 1", {
        slots: { space: 0, ground: 1, asteroid: 0 },
        presentFacilities: { space: [], ground: [{ building: "Small_Military_Settlement", demolishable: true }] },
      }),
    ];
    const r = result({ demolished: [{ bodyId: 1, slotKind: "ground", index: 0, building: "Small_Military_Settlement" }] });
    const placements = toSolvedBuildingPlacements(bodies, r);
    expect(placements).toEqual([]);
  });
});

describe("computeSolvedSystemLinks", () => {
  // Real bug found 2026-07-26: the standalone Links panel (since removed) and SolvedSystemPanel.tsx
  // both used to feed `computeSystemLinks` only `result.placements`, which (see solve.ts) never
  // includes already-present facilities at all — they're folded into the MILP as constants, not as
  // their own decision-variable placement entry. That silently dropped every already-present
  // facility's strong/weak-link contribution from both panels' displayed link topology.
  it("forms a strong link from an already-present facility to an already-present port, with no new construction at all", () => {
    const bodies = [
      body(1, "A 1", {
        slots: { space: 1, ground: 1, asteroid: 0 },
        presentFacilities: {
          space: [{ building: "Commercial_Outpost", demolishable: false }],
          ground: [{ building: "Small_Military_Settlement", demolishable: false }],
        },
      }),
    ];
    const r = result({ placements: [] });
    const links = computeSolvedSystemLinks(bodies, r);
    expect(links.strongLinks).toContainEqual(
      expect.objectContaining({ fromBuilding: "Small_Military_Settlement", toPortBuilding: "Commercial_Outpost", bodyId: 1 }),
    );
  });
});
