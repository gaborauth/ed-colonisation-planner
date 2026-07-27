import { describe, expect, it } from "vitest";
import { computePresentSystemLinks, strongLinkedInstances } from "./presentLinks";
import type { JournalBody } from "../journal/parser";

function makeBody(bodyId: number, overrides: Partial<JournalBody> = {}): JournalBody {
  return {
    bodyName: `Body ${bodyId}`,
    bodyId,
    kind: "planet",
    landable: true,
    parents: [{ type: "Star", bodyId: 0 }],
    rings: [],
    raw: {},
    ...overrides,
  };
}

describe("computePresentSystemLinks / strongLinkedInstances", () => {
  it("resolves nicknamed strong-linked instances for a real reported case (two same-body Refinery Hubs strong-linking to a Military Outpost)", () => {
    // Mirrors the user's own exported system: "Gens Landing" (Military_Outpost) on a rocky body,
    // with two ground Refinery_Hub facilities ("Egerton Horizons", "Werckmeister's Progress")
    // strong-linking to it.
    const body = makeBody(1, {
      bodyName: "Swoilz AW-C d52 1 a",
      planetClass: "Rocky body",
      presentFacilities: {
        space: [{ building: "Military_Outpost", demolishable: false, customName: "Gens Landing" }],
        ground: [
          { building: "Refinery_Hub", demolishable: false, customName: "Egerton Horizons" },
          { building: "Refinery_Hub", demolishable: false, customName: "Werckmeister's Progress" },
        ],
      },
    });

    const linksResult = computePresentSystemLinks([body]);
    const instances = strongLinkedInstances(linksResult, body, "Military_Outpost");

    expect(instances).toEqual(
      expect.arrayContaining([
        { building: "Refinery_Hub", nickname: "Egerton Horizons" },
        { building: "Refinery_Hub", nickname: "Werckmeister's Progress" },
      ]),
    );
    expect(instances).toHaveLength(2);
  });

  it("returns an empty array for a port with no strong links, and for a supporting facility (never a link target)", () => {
    const body = makeBody(1, {
      planetClass: "Rocky body",
      presentFacilities: {
        space: [{ building: "Military_Outpost", demolishable: false }],
        ground: [],
      },
    });
    const linksResult = computePresentSystemLinks([body]);
    expect(strongLinkedInstances(linksResult, body, "Military_Outpost")).toEqual([]);
    // Supporting facilities are never themselves a strong-link target, so querying one (even
    // though it isn't a port at all) correctly resolves to nothing rather than throwing.
    expect(strongLinkedInstances(linksResult, body, "Refinery_Hub")).toEqual([]);
  });

  it("folds the primary station in as its body's dominant port (via its own synced presentFacilities entry), receiving strong links from present facilities there", () => {
    const body = makeBody(1, {
      planetClass: "Rocky body",
      presentFacilities: {
        space: [{ building: "Coriolis", demolishable: false, primary: true }],
        ground: [{ building: "Small_Agricultural_Settlement", demolishable: false, customName: "Farm" }],
      },
    });
    const linksResult = computePresentSystemLinks([body]);
    expect(strongLinkedInstances(linksResult, body, "Coriolis")).toEqual([{ building: "Small_Agricultural_Settlement", nickname: "Farm" }]);
  });

  it("creates weak links across bodies from present facilities, same topology as the solved-plan case", () => {
    const body1 = makeBody(1, {
      planetClass: "Rocky body",
      presentFacilities: { space: [{ building: "Coriolis", demolishable: false }], ground: [] },
    });
    const body2 = makeBody(2, {
      planetClass: "Rocky body",
      presentFacilities: { space: [{ building: "Commercial_Outpost", demolishable: false }], ground: [] },
    });
    const linksResult = computePresentSystemLinks([body1, body2]);
    expect(
      linksResult.weakLinks.some((l) => l.fromBodyId === 1 && l.toPortBodyId === 2 && l.toPortBuilding === "Commercial_Outpost"),
    ).toBe(true);
  });
});
