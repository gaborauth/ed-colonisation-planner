import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import { computeSystemLinks, type BuildingPlacement } from "./links";

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

describe("computeSystemLinks", () => {
  it("reproduces the source's worked example: tier-2 port dominates a body with a tier-1 port and two facilities", () => {
    // Body 1: ground facility (Extraction_Hub) + orbital facility (Government) + a tier-1 port
    // (Commercial_Outpost) + a tier-2 port (Coriolis), all in orbit/on the body per the example.
    // Body 2: a ground port (Planetary_Port) + an orbital facility (Government).
    const body1 = makeBody(1, { planetClass: "Rocky body" });
    const body2 = makeBody(2, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Extraction_Hub", bodyId: 1, count: 1 },
      { building: "Government", bodyId: 1, count: 1 },
      { building: "Commercial_Outpost", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
      { building: "Planetary_Port", bodyId: 2, count: 1 },
      { building: "Government", bodyId: 2, count: 1 },
    ];
    const result = computeSystemLinks([body1, body2], placements, ["Commercial_Outpost", "Coriolis", "Planetary_Port"]);

    // Strong links on body 1 all target Coriolis (the tier-2 port), not Commercial_Outpost (tier 1).
    const body1Strong = result.strongLinks.filter((l) => l.bodyId === 1);
    expect(body1Strong.every((l) => l.toPortBuilding === "Coriolis")).toBe(true);
    expect(body1Strong.map((l) => l.fromBuilding).sort()).toEqual(
      ["Commercial_Outpost", "Extraction_Hub", "Government"].sort(),
    );

    // Body 1's Coriolis <-> Body 2's Planetary_Port get a weak link in both directions.
    expect(
      result.weakLinks.some((l) => l.fromBodyId === 1 && l.toPortBodyId === 2 && l.toPortBuilding === "Planetary_Port"),
    ).toBe(true);
    expect(
      result.weakLinks.some((l) => l.fromBodyId === 2 && l.toPortBodyId === 1 && l.toPortBuilding === "Coriolis"),
    ).toBe(true);
  });

  it("chains a planetary port's strong links onward to the orbital port on the same body", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Small_Agricultural_Settlement", bodyId: 1, count: 1 }, // ground facility
      { building: "Planetary_Port", bodyId: 1, count: 1 }, // ground port
      { building: "Coriolis", bodyId: 1, count: 1 }, // space port
    ];
    const result = computeSystemLinks([body], placements, ["Planetary_Port", "Coriolis"]);

    const groundFacilityLink = result.strongLinks.find((l) => l.fromBuilding === "Small_Agricultural_Settlement");
    expect(groundFacilityLink?.toPortBuilding).toBe("Planetary_Port");

    const chainLink = result.strongLinks.find((l) => l.fromBuilding === "Planetary_Port");
    expect(chainLink?.toPortBuilding).toBe("Coriolis");

    // Coriolis (the orbital port) is the body's representative for weak links, not Planetary_Port.
    const dominantPorts = result.ports.filter((p) => p.bodyId === 1 && p.isDominantOnBody);
    expect(dominantPorts.map((p) => p.building).sort()).toEqual(["Coriolis", "Planetary_Port"].sort());
  });

  it("breaks a same-tier tie between different port types using buildOrderHint", () => {
    // Coriolis and Asteroid_Base are both tier 2. Asteroid_Base appears earlier in the hint.
    const body = makeBody(1, { planetClass: "Rocky body", rings: [{ name: "r", ringClass: "x", massMT: 1 }] });
    const placements: BuildingPlacement[] = [
      { building: "Government", bodyId: 1, count: 1 },
      { building: "Asteroid_Base", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
    ];
    const result = computeSystemLinks([body], placements, ["Asteroid_Base", "Coriolis"]);
    const facilityLink = result.strongLinks.find((l) => l.fromBuilding === "Government");
    expect(facilityLink?.toPortBuilding).toBe("Asteroid_Base");
  });

  it("evaluates boost/decrease per individual strong link, not once per body", () => {
    // Matches the source's own example: a volcanic body's extraction facility strong link is
    // boosted, its agricultural facility strong link is not.
    const body = makeBody(1, { planetClass: "Icy body" }); // icy -> decreases Agriculture, not Extraction
    const placements: BuildingPlacement[] = [
      { building: "Extraction_Hub", bodyId: 1, count: 1 },
      { building: "Civilian_Hub", bodyId: 1, count: 1 }, // FACILITY_ECONOMY_GUESS maps this to Agriculture
      { building: "Coriolis", bodyId: 1, count: 1 },
    ];
    const result = computeSystemLinks([body], placements, ["Coriolis"]);
    const extractionLink = result.strongLinks.find((l) => l.fromBuilding === "Extraction_Hub")!;
    const agricultureLink = result.strongLinks.find((l) => l.fromBuilding === "Civilian_Hub")!;
    expect(extractionLink.decreasedEconomies).toEqual([]);
    expect(agricultureLink.decreasedEconomies).toEqual(["Agriculture"]);
  });

  it("warns about facilities on a body with no port instead of dropping them silently", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [{ building: "Government", bodyId: 1, count: 1 }];
    const result = computeSystemLinks([body], placements, []);
    expect(result.strongLinks).toEqual([]);
    expect(result.warnings.some((w) => w.includes("no port"))).toBe(true);
  });

  it("creates no weak links for a single-body system", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [{ building: "Coriolis", bodyId: 1, count: 1 }];
    const result = computeSystemLinks([body], placements, ["Coriolis"]);
    expect(result.weakLinks).toEqual([]);
  });
});
