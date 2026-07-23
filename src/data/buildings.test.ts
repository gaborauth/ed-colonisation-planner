import { describe, expect, it } from "vitest";
import {
  ALL_BUILDINGS,
  ALL_CATEGORIES,
  computeCompoundScore,
  getT2PortCost,
  getT3PortCost,
  isPort,
} from "./buildings";

describe("buildings data", () => {
  it("has 54 buildings (the original 53 plus Dodecahedron, added in the Dodec Update)", () => {
    expect(Object.keys(ALL_BUILDINGS)).toHaveLength(54);
  });

  it("marks exactly the four primary ports as ports", () => {
    const ports = Object.entries(ALL_BUILDINGS)
      .filter(([, b]) => isPort(b))
      .map(([n]) => n)
      .sort();
    expect(ports).toEqual(["Asteroid_Base", "Coriolis", "Dodecahedron", "Orbis_or_Ocellus", "Planetary_Port"]);
  });

  it("First Station category contains the 4 primary ports plus the 6 starter outposts", () => {
    // Per data.py: any building with first_station_offset > 0, not just the primary ports.
    expect(new Set(ALL_CATEGORIES["First Station"])).toEqual(
      new Set([
        "Orbis_or_Ocellus",
        "Dodecahedron",
        "Coriolis",
        "Asteroid_Base",
        "Commercial_Outpost",
        "Industrial_Outpost",
        "Criminal_Outpost",
        "Civilian_Outpost",
        "Scientific_Outpost",
        "Military_Outpost",
      ]),
    );
  });

  it("Hub category contains exactly the 9 *_Hub buildings", () => {
    expect(ALL_CATEGORIES.Hub).toHaveLength(9);
  });

  it("settlement categories have 6 members each (one per settlement family)", () => {
    expect(ALL_CATEGORIES["Small Settlement"]).toHaveLength(6);
    expect(ALL_CATEGORIES["Medium Settlement"]).toHaveLength(6);
    expect(ALL_CATEGORIES["Large Settlement"]).toHaveLength(6);
  });

  it("Dodecahedron matches the v3.4.1 Stats tab (a T3 port, like Orbis/Ocellus)", () => {
    const dodec = ALL_BUILDINGS.Dodecahedron;
    expect(dodec.slot).toBe("space");
    expect(dodec.T3points).toBe("port");
    expect(dodec.construction_cost).toBe(236304);
    expect(dodec.development_level).toBe(10);
    expect(isPort(dodec)).toBe(true);
  });

  it("all Hub buildings grant +1 initial/max population increase (v3.4.1 fix)", () => {
    for (const name of ALL_CATEGORIES.Hub) {
      const hub = ALL_BUILDINGS[name];
      expect(hub.initial_population_increase, name).toBe(1);
      expect(hub.max_population_increase, name).toBe(1);
    }
  });
});

describe("escalating port construction-point cost", () => {
  it("matches the FDEV-confirmed T2 curve: 3,3,5,7,9...", () => {
    expect([0, 1, 2, 3, 4].map(getT2PortCost)).toEqual([3, 3, 5, 7, 9]);
  });

  it("matches the FDEV-confirmed T3 curve: 6,6,12,18,24...", () => {
    expect([0, 1, 2, 3, 4].map(getT3PortCost)).toEqual([6, 6, 12, 18, 24]);
  });
});

describe("system_score_(beta)", () => {
  it("sums security + tech_level + wealth + standard_of_living", () => {
    const score = computeCompoundScore("system_score_beta", {
      security: 1,
      tech_level: 2,
      wealth: 3,
      standard_of_living: 4,
      development_level: 100, // must be ignored
    });
    expect(score).toBe(10);
  });
});
