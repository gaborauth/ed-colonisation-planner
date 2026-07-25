import { describe, expect, it } from "vitest";
import {
  ALL_BUILDINGS,
  ALL_CATEGORIES,
  computeCompoundScore,
  FACILITY_ECONOMY_GUESS,
  getPortTier,
  getT2PortCost,
  getT3PortCost,
  isPort,
  isPortRole,
  PORT_ROLE_BUILDINGS,
  PORT_FIXED_ECONOMY,
  SUPPORTING_FACILITY_BUILDINGS,
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

describe("Update 3 link-topology classification", () => {
  it("PORT_ROLE_BUILDINGS and SUPPORTING_FACILITY_BUILDINGS partition all 54 buildings with no overlap", () => {
    expect(PORT_ROLE_BUILDINGS).toHaveLength(14);
    expect(SUPPORTING_FACILITY_BUILDINGS).toHaveLength(40);
    const overlap = PORT_ROLE_BUILDINGS.filter((n) => SUPPORTING_FACILITY_BUILDINGS.includes(n));
    expect(overlap).toEqual([]);
    const union = new Set([...PORT_ROLE_BUILDINGS, ...SUPPORTING_FACILITY_BUILDINGS]);
    expect(union).toEqual(new Set(Object.keys(ALL_BUILDINGS)));
  });

  it("isPortRole agrees with PORT_ROLE_BUILDINGS membership", () => {
    for (const name of Object.keys(ALL_BUILDINGS)) {
      expect(isPortRole(name), name).toBe(PORT_ROLE_BUILDINGS.includes(name));
    }
  });

  it("getPortTier groups ports into the official Tier 1/2/3 vocabulary", () => {
    const byTier = { 1: [] as string[], 2: [] as string[], 3: [] as string[] };
    for (const name of PORT_ROLE_BUILDINGS) byTier[getPortTier(name)].push(name);
    expect(new Set(byTier[1])).toEqual(
      new Set([
        "Commercial_Outpost",
        "Industrial_Outpost",
        "Criminal_Outpost",
        "Civilian_Outpost",
        "Scientific_Outpost",
        "Military_Outpost",
        "Civilian_Planetary_Outpost",
        "Industrial_Planetary_Outpost",
        "Scientific_Planetary_Outpost",
      ]),
    );
    expect(new Set(byTier[2])).toEqual(new Set(["Coriolis", "Asteroid_Base"]));
    expect(new Set(byTier[3])).toEqual(new Set(["Orbis_or_Ocellus", "Dodecahedron", "Planetary_Port"]));
  });

  it("getPortTier throws for a non-Port-role building", () => {
    expect(() => getPortTier("Government")).toThrow();
  });

  it("FACILITY_ECONOMY_GUESS only maps Supporting Facility buildings", () => {
    for (const name of Object.keys(FACILITY_ECONOMY_GUESS)) {
      expect(SUPPORTING_FACILITY_BUILDINGS, name).toContain(name);
    }
  });

  it("PORT_FIXED_ECONOMY only maps Port-role buildings, one economy each — sourced from DaftMav-v3.4.1.ods's Stats tab", () => {
    for (const [name, economies] of Object.entries(PORT_FIXED_ECONOMY)) {
      expect(PORT_ROLE_BUILDINGS, name).toContain(name);
      expect(economies, name).toHaveLength(1);
    }
    expect(new Set(Object.keys(PORT_FIXED_ECONOMY))).toEqual(
      new Set([
        "Asteroid_Base",
        "Military_Outpost",
        "Industrial_Outpost",
        "Scientific_Outpost",
        "Industrial_Planetary_Outpost",
        "Scientific_Planetary_Outpost",
      ]),
    );
  });

  it("Asteroid Base and the Military/Industrial/Scientific Outposts (space + ground) get their sheet-confirmed named economy, not a guess", () => {
    expect(PORT_FIXED_ECONOMY.Asteroid_Base).toEqual(["Extraction"]);
    expect(PORT_FIXED_ECONOMY.Military_Outpost).toEqual(["Military"]);
    expect(PORT_FIXED_ECONOMY.Industrial_Outpost).toEqual(["Industrial"]);
    expect(PORT_FIXED_ECONOMY.Scientific_Outpost).toEqual(["HighTech"]);
    expect(PORT_FIXED_ECONOMY.Industrial_Planetary_Outpost).toEqual(["Industrial"]);
    expect(PORT_FIXED_ECONOMY.Scientific_Planetary_Outpost).toEqual(["HighTech"]);
  });

  it("Civilian/Commercial Outposts (space) and Civilian Planetary Outpost (ground) are NOT in PORT_FIXED_ECONOMY — the sheet lists them as plain Colony, so they take the body-derived economy like the other generic ports", () => {
    expect(PORT_FIXED_ECONOMY.Civilian_Outpost).toBeUndefined();
    expect(PORT_FIXED_ECONOMY.Commercial_Outpost).toBeUndefined();
    expect(PORT_FIXED_ECONOMY.Civilian_Planetary_Outpost).toBeUndefined();
  });
});

describe("escalating port construction-point cost", () => {
  // Corrected 2026-07-24: this used to assert [3,3,5,7,9]/[6,6,12,18,24] (a `max(3,2n+1)`/
  // `max(6,6n)` formula) — a real bug, confirmed against a real in-game system's already-built
  // T2/T3 balance (see presentFacilities.test.ts's `computePresentPortsSeed` tests). The correct
  // curve never repeats its first value.
  it("matches the confirmed T2 curve: 3,5,7,9,11...", () => {
    expect([0, 1, 2, 3, 4].map(getT2PortCost)).toEqual([3, 5, 7, 9, 11]);
  });

  it("matches the confirmed T3 curve: 6,12,18,24,30...", () => {
    expect([0, 1, 2, 3, 4].map(getT3PortCost)).toEqual([6, 12, 18, 24, 30]);
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
