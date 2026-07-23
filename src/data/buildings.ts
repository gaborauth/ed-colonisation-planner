// Ported from data.py, then refreshed 2026-07-23 against DaftMav's "Colonization Construction v3"
// spreadsheet v3.4.1 (current as of Dodec Update + Trailblazers Update 3), from the sheet's "Stats"
// tab. Costs are the sheet's "Total amount of Commodities" column, which is what construction_cost
// has always represented here (confirmed by exact matches on unchanged values, e.g. Coriolis
// 53,723). Link/population-driven economy mechanics (Update 3) are deliberately NOT modeled yet —
// see the project plan: that's a separate, deferred phase. Dependency chains were cross-checked
// against the sheet's "Prerequisites" column and needed no changes.

export type SlotType = "space" | "ground";

export const BASE_SCORES = [
  "initial_population_increase",
  "max_population_increase",
  "security",
  "tech_level",
  "wealth",
  "standard_of_living",
  "development_level",
  "construction_cost",
] as const;
export type BaseScore = (typeof BASE_SCORES)[number];

export const COMPOUND_SCORES = ["system_score_beta"] as const;
export type CompoundScore = (typeof COMPOUND_SCORES)[number];

export type Score = BaseScore | CompoundScore;
export const ALL_SCORES: Score[] = [...BASE_SCORES, ...COMPOUND_SCORES];

export const ALL_SLOTS = { space: "Orbital", ground: "Ground", asteroid: "Asteroid" } as const;
export type SlotKind = keyof typeof ALL_SLOTS;

/** A building's T2/T3 construction-point cost/benefit: a plain integer, or "port" meaning
 * "this is an orbital/planetary port, subject to the escalating per-slot cost curve". */
export type PortPoints = number | "port";

export interface Building {
  slot: SlotType;
  initial_population_increase: number;
  max_population_increase: number;
  security: number;
  tech_level: number;
  wealth: number;
  standard_of_living: number;
  development_level: number;
  construction_cost: number;
  T2points: PortPoints;
  T3points: PortPoints;
  dependencies: string[];
  first_station_offset: number;
}

interface Row {
  name: string;
  slot: SlotType;
  ip?: number;
  mp?: number;
  sec?: number;
  tl?: number;
  w?: number;
  sol?: number;
  dl?: number;
  cost: number;
  t2?: PortPoints;
  t3?: PortPoints;
  dependencies?: string[];
  firstStationOffset?: number;
}

function row(r: Row): [string, Building] {
  return [
    r.name,
    {
      slot: r.slot,
      initial_population_increase: r.ip ?? 0,
      max_population_increase: r.mp ?? 0,
      security: r.sec ?? 0,
      tech_level: r.tl ?? 0,
      wealth: r.w ?? 0,
      standard_of_living: r.sol ?? 0,
      development_level: r.dl ?? 0,
      construction_cost: r.cost,
      T2points: r.t2 ?? 0,
      T3points: r.t3 ?? 0,
      dependencies: r.dependencies ?? [],
      first_station_offset: r.firstStationOffset ?? 0,
    },
  ];
}

// Values from "Colonization Construction v3 (By DaftMav)" v3.4.1, "Stats" tab:
// https://docs.google.com/spreadsheets/d/1jsZOzNJSnPIWlU88puOc9gQXvsw-MGp8meoQ6k-Yj-Y/copy?usp=sharing
// first_station_offset values are computed from the sheet's own Primary vs regular cost rows
// (e.g. Coriolis 70,533 / 53,723 - 1) rather than the changelog's rounded "roughly +33%" language.
//         NAME                            SLOT     IP MP SEC TL  W SoL DL   cost   T2      T3
export const ALL_BUILDINGS: Record<string, Building> = Object.fromEntries([
  row({ name: "Orbis_or_Ocellus", slot: "space", ip: 5, mp: 1, sec: -3, tl: 7, w: 8, sol: 5, dl: 9, cost: 209122, t2: 0, t3: "port", firstStationOffset: 0.1608 }),
  row({ name: "Dodecahedron", slot: "space", ip: 8, mp: 4, sec: -4, tl: 8, w: 9, sol: 7, dl: 10, cost: 236304, t2: 0, t3: "port", firstStationOffset: 0.1423 }),
  row({ name: "Coriolis", slot: "space", ip: 1, mp: 1, sec: -2, tl: 2, w: 3, sol: 3, dl: 3, cost: 53723, t2: "port", t3: 1, firstStationOffset: 0.3129 }),
  row({ name: "Asteroid_Base", slot: "space", ip: 1, mp: 1, sec: -1, tl: 3, w: 5, sol: -4, dl: 7, cost: 53723, t2: "port", t3: 1, firstStationOffset: 0.3129 }),

  row({ name: "Commercial_Outpost", slot: "space", ip: 1, mp: 1, sec: -1, tl: 0, w: 3, sol: 5, dl: 0, cost: 18988, t2: 1, t3: 0, firstStationOffset: 0.1499 }),
  row({ name: "Industrial_Outpost", slot: "space", ip: 1, mp: 1, sec: 0, tl: 3, w: 0, sol: 0, dl: 3, cost: 18987, t2: 1, t3: 0, firstStationOffset: 0.1499 }),
  row({ name: "Criminal_Outpost", slot: "space", ip: 1, mp: 1, sec: -2, tl: 0, w: 3, sol: 0, dl: 0, cost: 18988, t2: 1, t3: 0, firstStationOffset: 0.1499 }),
  row({ name: "Civilian_Outpost", slot: "space", ip: 1, mp: 1, sec: -1, tl: 0, w: 1, sol: 2, dl: 1, cost: 18988, t2: 1, t3: 0, firstStationOffset: 0.1499 }),
  row({ name: "Scientific_Outpost", slot: "space", ip: 1, mp: 1, sec: 0, tl: 3, w: 0, sol: 0, dl: 0, cost: 18988, t2: 1, t3: 0, firstStationOffset: 0.1499 }),
  row({ name: "Military_Outpost", slot: "space", ip: 1, mp: 1, sec: 2, tl: 0, w: 0, sol: 0, dl: 0, cost: 18988, t2: 1, t3: 0, firstStationOffset: 0.1499 }),

  row({ name: "Satellite", slot: "space", w: 0, sol: 1, dl: 2, cost: 6721, t2: 1, t3: 0 }),
  row({ name: "Communication_Station", slot: "space", sec: 1, tl: 3, cost: 6721, t2: 1, t3: 0 }),
  row({ name: "Space_Farm", slot: "space", sol: 5, dl: 1, cost: 6722, t2: 1, t3: 0 }),
  row({ name: "Pirate_Base", slot: "space", sec: -4, w: 4, cost: 6721, t2: 1, t3: 0 }),
  row({ name: "Mining_Outpost", slot: "space", w: 4, sol: -2, cost: 6723, t2: 1, t3: 0 }),
  row({ name: "Relay_Station", slot: "space", sec: 1, dl: 1, cost: 6721, t2: 1, t3: 0 }),

  row({ name: "Military", slot: "space", sec: 7, cost: 10080, t2: -1, t3: 1, dependencies: ["Small_Military_Settlement", "Medium_Military_Settlement", "Large_Military_Settlement"] }),
  row({ name: "Security_Station", slot: "space", sec: 9, sol: 3, dl: 3, cost: 10082, t2: -1, t3: 1, dependencies: ["Relay_Station"] }),
  row({ name: "Government", slot: "space", sec: 2, sol: 7, dl: 3, cost: 10077, t2: -1, t3: 1 }),
  row({ name: "Medical", slot: "space", tl: 3, sol: 5, cost: 10081, t2: -1, t3: 1 }),
  row({ name: "Research_Station", slot: "space", tl: 8, dl: 3, cost: 10083, t2: -1, t3: 1, dependencies: ["Small_Scientific_Settlement", "Medium_Scientific_Settlement", "Large_Scientific_Settlement"] }),
  row({ name: "Tourist", slot: "space", sec: -3, sol: 6, dl: 3, cost: 10087, t2: -1, t3: 1, dependencies: ["Small_Tourism_Settlement", "Medium_Tourism_Settlement", "Large_Tourism_Settlement"] }),
  row({ name: "Space_Bar", slot: "space", sec: -2, sol: 3, w: 0, dl: 0, cost: 10076, t2: -1, t3: 1 }),

  //         NAME                            SLOT     IP MP SEC TL  W SoL DL   cost   T2      T3
  row({ name: "Civilian_Planetary_Outpost", slot: "ground", ip: 2, mp: 1, sec: -2, sol: 3, cost: 36829, t2: 1, t3: 0 }),
  row({ name: "Industrial_Planetary_Outpost", slot: "ground", ip: 1, mp: 1, sec: -1, w: 3, cost: 36829, t2: 1, t3: 0 }),
  row({ name: "Scientific_Planetary_Outpost", slot: "ground", ip: 1, mp: 1, sec: -1, tl: 5, dl: 1, cost: 36829, t2: 1, t3: 0 }),
  row({ name: "Planetary_Port", slot: "ground", ip: 10, mp: 10, sec: -3, tl: 5, w: 5, sol: 7, dl: 10, cost: 216030, t2: 0, t3: "port" }),

  // v3.4.1 fix: "All Hub surface facilities have +1 in initial and max population increase (was zero)".
  row({ name: "Extraction_Hub", slot: "ground", ip: 1, mp: 1, w: 10, sol: -4, dl: 3, cost: 9893, t2: -1, t3: 1, dependencies: ["Small_Extraction_Settlement", "Medium_Extraction_Settlement", "Large_Extraction_Settlement"] }),
  row({ name: "Civilian_Hub", slot: "ground", ip: 1, mp: 1, sec: -3, sol: 3, dl: 3, cost: 9772, t2: -1, t3: 1, dependencies: ["Small_Agricultural_Settlement", "Medium_Agricultural_Settlement", "Large_Agricultural_Settlement"] }),
  row({ name: "Exploration_Hub", slot: "ground", ip: 1, mp: 1, sec: -1, tl: 7, dl: 3, cost: 9923, t2: -1, t3: 1, dependencies: ["Communication_Station"] }),
  row({ name: "Outpost_Hub", slot: "ground", ip: 1, mp: 1, sec: -2, sol: 3, dl: 3, cost: 9198, t2: -1, t3: 1, dependencies: ["Space_Farm"] }),
  row({ name: "Scientific_Hub", slot: "ground", ip: 1, mp: 1, tl: 10, cost: 9924, t2: -1, t3: 1 }),
  row({ name: "Military_Hub", slot: "ground", ip: 1, mp: 1, sec: 10, cost: 9922, t2: -1, t3: 1, dependencies: ["Military"] }),
  row({ name: "Refinery_Hub", slot: "ground", ip: 1, mp: 1, sec: -1, tl: 3, w: 5, sol: -2, dl: 7, cost: 9919, t2: -1, t3: 1 }),
  row({ name: "High_Tech_Hub", slot: "ground", ip: 1, mp: 1, sec: -2, tl: 10, w: 3, cost: 9921, t2: -1, t3: 1 }),
  row({ name: "Industrial_Hub", slot: "ground", ip: 1, mp: 1, tl: 3, w: 5, sol: -4, dl: 3, cost: 9753, t2: -1, t3: 1, dependencies: ["Mining_Outpost"] }),

  row({ name: "Small_Agricultural_Settlement", slot: "ground", ip: 1, mp: 1, sol: 3, cost: 2839, t2: 1 }),
  row({ name: "Medium_Agricultural_Settlement", slot: "ground", ip: 1, mp: 1, sol: 7, cost: 5678, t2: 1 }),
  row({ name: "Large_Agricultural_Settlement", slot: "ground", ip: 1, mp: 1, sol: 10, cost: 8517, t2: -1, t3: 2 }),

  row({ name: "Small_Extraction_Settlement", slot: "ground", ip: 1, mp: 1, w: 3, cost: 2845, t2: 1 }),
  row({ name: "Medium_Extraction_Settlement", slot: "ground", ip: 1, mp: 1, w: 5, cost: 5690, t2: 1 }),
  row({ name: "Large_Extraction_Settlement", slot: "ground", ip: 1, mp: 1, tl: 2, w: 8, sol: -2, cost: 8535, t2: -1, t3: 2 }),

  row({ name: "Small_Industrial_Settlement", slot: "ground", ip: 1, mp: 1, dl: 3, cost: 2845, t2: 1 }),
  row({ name: "Medium_Industrial_Settlement", slot: "ground", ip: 1, mp: 1, dl: 6, cost: 5690, t2: 1 }),
  row({ name: "Large_Industrial_Settlement", slot: "ground", ip: 1, mp: 1, dl: 9, w: 3, cost: 8535, t2: -1, t3: 2 }),

  row({ name: "Small_Military_Settlement", slot: "ground", ip: 1, mp: 1, sec: 2, cost: 2842, t2: 1 }),
  row({ name: "Medium_Military_Settlement", slot: "ground", ip: 1, mp: 1, sec: 4, cost: 5684, t2: 1 }),
  row({ name: "Large_Military_Settlement", slot: "ground", ip: 1, mp: 1, sec: 7, dl: 3, cost: 8526, t2: -1, t3: 2 }),

  row({ name: "Small_Scientific_Settlement", slot: "ground", ip: 1, mp: 1, tl: 3, dl: 1, cost: 2841, t2: -1, t3: 1 }),
  row({ name: "Medium_Scientific_Settlement", slot: "ground", ip: 1, mp: 1, tl: 7, dl: 1, cost: 5682, t2: -1, t3: 1 }),
  row({ name: "Large_Scientific_Settlement", slot: "ground", ip: 1, mp: 1, tl: 10, dl: 3, cost: 8523, t2: -1, t3: 2 }),

  row({ name: "Small_Tourism_Settlement", slot: "ground", ip: 1, mp: 1, sec: -1, w: 1, cost: 2846, t2: -1, t3: 1, dependencies: ["Satellite"] }),
  row({ name: "Medium_Tourism_Settlement", slot: "ground", ip: 1, mp: 1, sec: -1, w: 3, cost: 5692, t2: -1, t3: 1, dependencies: ["Satellite"] }),
  row({ name: "Large_Tourism_Settlement", slot: "ground", ip: 1, mp: 1, sec: -1, w: 5, cost: 8538, t2: -1, t3: 2, dependencies: ["Satellite"] }),
]);

export function isPort(building: Building): boolean {
  return building.T2points === "port" || building.T3points === "port";
}

/** T2 cost of the (nbPreviousPorts+1)-th orbital/planetary port built system-wide. */
export function getT2PortCost(nbPreviousPorts: number): number {
  return Math.max(3, 2 * nbPreviousPorts + 1);
}

/** T3 cost of the (nbPreviousPorts+1)-th orbital/planetary port built system-wide. */
export function getT3PortCost(nbPreviousPorts: number): number {
  return Math.max(6, 6 * nbPreviousPorts);
}

/** system_score_(beta), per the DaftMav "Colonization Construction" spreadsheet. */
export function computeCompoundScore(
  _score: CompoundScore,
  values: Partial<Record<BaseScore, number>>,
): number {
  return (
    (values.security ?? 0) +
    (values.tech_level ?? 0) +
    (values.wealth ?? 0) +
    (values.standard_of_living ?? 0)
  );
}

export const ALL_DEPENDENCIES: string[][] = Array.from(
  new Set(
    Object.values(ALL_BUILDINGS)
      .filter((b) => b.dependencies.length > 0)
      .map((b) => JSON.stringify(b.dependencies)),
  ),
).map((s) => JSON.parse(s));

// Categories, mirroring data.py's make_category calls — used for UI filtering.
function names(predicate: (name: string, b: Building) => boolean): string[] {
  return Object.entries(ALL_BUILDINGS)
    .filter(([n, b]) => predicate(n, b))
    .map(([n]) => n);
}

export const ALL_CATEGORIES: Record<string, string[]> = {
  All: Object.keys(ALL_BUILDINGS),
  "First Station": names((_, b) => b.first_station_offset > 0),
  Space: names((_, b) => b.slot === "space"),
  Ground: names((_, b) => b.slot === "ground"),
  T1: names((_, b) => b.T2points !== "port" && b.T2points > 0),
  T2: names((_, b) => b.T2points === "port" || b.T2points < 0),
  T3: names((_, b) => b.T3points === "port" || b.T3points < 0),
  "Star/Ground Port": [
    "Orbis_or_Ocellus",
    "Dodecahedron",
    "Coriolis",
    "Asteroid_Base",
    "Civilian_Planetary_Outpost",
    "Industrial_Planetary_Outpost",
    "Scientific_Planetary_Outpost",
    "Planetary_Port",
  ],
  Installation: [
    "Satellite",
    "Communication_Station",
    "Space_Farm",
    "Pirate_Base",
    "Mining_Outpost",
    "Relay_Station",
    "Military",
    "Security_Station",
    "Government",
    "Medical",
    "Research_Station",
    "Tourist",
    "Space_Bar",
  ],
  Hub: names((n) => n.endsWith("Hub")),
  "Small Settlement": names((n) => n.endsWith("Settlement") && n.startsWith("Small")),
  "Medium Settlement": names((n) => n.endsWith("Settlement") && n.startsWith("Medium")),
  "Large Settlement": names((n) => n.endsWith("Settlement") && n.startsWith("Large")),
};

export function toPrintable(name: string): string {
  return name.replace(/_/g, " ");
}

export function fromPrintable(displayName: string): string {
  return displayName.replace(/ /g, "_");
}
