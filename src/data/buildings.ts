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

/** Scores that exist outside both the per-building stat table (`BASE_SCORES`) and the
 * base-score-derived compound formulas (`COMPOUND_SCORES`/`computeCompoundScore`) — computed
 * instead from *where* a building lands (per-body placement), not just *how many* of it exist.
 * `economy_synergy` is the only one: see `solve.ts`'s header comment and CLAUDE.md's "Update 3
 * link/economy modeling" section for what it means and how it's computed. Always 0 in aggregate
 * mode (no body layout applied) or in `domain/systemState.ts`'s already-present/build-order
 * accounting (neither has per-body placement data) — only `solve.ts`'s per-body MILP path ever
 * sets it to something else. */
export const DERIVED_SCORES = ["economy_synergy"] as const;
export type DerivedScore = (typeof DERIVED_SCORES)[number];

export type Score = BaseScore | CompoundScore | DerivedScore;
export const ALL_SCORES: Score[] = [...BASE_SCORES, ...COMPOUND_SCORES, ...DERIVED_SCORES];

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

/** WARNING: "port" means two different things in this file. This predicate is narrow — "subject
 * to the escalating T2/T3 port-slot cost curve" (5 buildings: Orbis_or_Ocellus, Dodecahedron,
 * Coriolis, Asteroid_Base, Planetary_Port). For Update 3's link-topology "Port" classification (14
 * buildings, also including Outposts and Planetary Outposts), see `isPortRole`/
 * `PORT_ROLE_BUILDINGS` below. Don't use this one where that one is meant. */
export function isPort(building: Building): boolean {
  return building.T2points === "port" || building.T3points === "port";
}

/** T2 cost of the (nbPreviousPorts+1)-th Tier-2-cost port (Coriolis/Asteroid_Base) built
 * system-wide: 3, 5, 7, 9, ... — confirmed against a real in-game system's already-built T2/T3
 * balance (see presentFacilities.ts's `computePresentPortsSeed`). Previously coded as
 * `max(3, 2n+1)` (3, 3, 5, 7, 9, ...), which undercounts every port after the first — a real bug,
 * not a recalibration of a flagged guess (this file's other placeholders are marked as such; this
 * one wasn't, and should have been caught sooner). `nbPreviousPorts` must count only OTHER
 * Tier-2-cost ports, never the primary/claim station (which is exempt from this cost entirely —
 * see solve.ts's `initialT2Points`) and never a Tier-3-cost port (Orbis/Ocellus/Dodecahedron/
 * Planetary_Port have their own separate sequence via `getT3PortCost`, not a shared counter). */
export function getT2PortCost(nbPreviousPorts: number): number {
  return 3 + 2 * nbPreviousPorts;
}

/** T3 cost of the (nbPreviousPorts+1)-th Tier-3-cost port (Orbis_or_Ocellus/Dodecahedron/
 * Planetary_Port) built system-wide: 6, 12, 18, 24, ... — same confirmation/correction as
 * `getT2PortCost` above (previously `max(6, 6n)`, i.e. 6, 6, 12, 18, ..., undercounting every port
 * after the first). `nbPreviousPorts` counts only OTHER Tier-3-cost ports — never the primary
 * station, and never a Tier-2-cost port (separate sequence, not shared). */
export function getT3PortCost(nbPreviousPorts: number): number {
  return 6 * (nbPreviousPorts + 1);
}

// SOURCED: Dodec Update patch notes (2025-11-11), "Balanced how building certain facilities
// affects system development level, security, standard of living, tech level, and wealth." The
// claim/first station's own contribution to these five scores is BOOSTED by FIRST_STATION_BONUS;
// every other facility's contribution (already-present or newly built) is REDUCED by
// SUBSEQUENT_FACILITY_REDUCTION. This replaced an earlier "unverified, best-known figures"
// version of this constant that used a single full-weight-vs-fraction split with different
// (guessed) magnitudes — the official numbers differ substantially for some scores (e.g.
// development_level's subsequent-facility reduction is only -10%, not the previously-guessed -60%)
// and add a first-station bonus the old version didn't model at all.
// Population increase and construction cost are not listed as affected and stay full-weight.
// Moved here from solve.ts (2026-07-26) once `domain/currentSystemScores.ts` needed the exact same
// constants for a plain-number (non-MILP) reweighting of the CURRENT (not-yet-solved) system's
// totals — this is a general game rule, not something specific to the solver's own LP formulation.
export const FIRST_STATION_BONUS: Partial<Record<Score, number>> = {
  development_level: 0.4, // +40%
  security: 0.4, // +40%
  standard_of_living: 0.4, // +40%
  tech_level: 0.2, // +20%
  wealth: 0.4, // +40%
};
export const SUBSEQUENT_FACILITY_REDUCTION: Partial<Record<Score, number>> = {
  development_level: 0.1, // -10%
  security: 0.1, // -10%
  standard_of_living: 0.2, // -20%
  tech_level: 0.25, // -25%
  wealth: 0.25, // -25%
};

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

/** Purely cosmetic real-world design/name variants for every building type, sourced verbatim from
 * DaftMav's "Colonization Construction v3" spreadsheet's "Lists" tab (v3.4.1) — the same list that
 * drives that sheet's own "Layout Variant" dropdown. These are named layouts observed in-game (e.g.
 * Coriolis's "No Truss"/"Dual Truss"/"Quad Truss" hull variants, or a Scientific Outpost's single
 * observed name "Prometheus"); they have identical stats/costs/dependencies to their building type
 * (this app's `ALL_BUILDINGS` — and the source spreadsheet's own "Stats" tab — track only one row
 * per building type, never per-variant), so this table exists purely for the System facilities
 * panel's "what does this actually look like" dropdown, never consumed by the solver. The sheet's
 * "(Primary)"/"(P)" suffixed duplicate rows (the same named layouts, listed again for when that
 * building is the system's primary/claim station) and settlement rows' "(S)/(M)/(L)" landing-pad-
 * size annotations are both stripped here — this table only tracks the name, not those orthogonal
 * distinctions. `Orbis_or_Ocellus` merges two distinct real station types that share one stats row
 * (see the row comment above): "Ocellus" has one named layout, "Orbis" has two ("Apollo"/"Artemis"),
 * both listed with an "Orbis (...)" prefix so the merge is visible in the dropdown. The sheet's
 * "Surface - Settlement - Research Bio" rows map to this app's Scientific Settlement buildings —
 * "Research Bio" is the game's own name for that settlement economy (confirmed: the sheet has no
 * separate "Scientific" settlement rows at all), not a substitution this app introduced. */
export const BUILDING_VARIANTS: Record<string, string[]> = {
  Coriolis: ["No Truss", "Dual Truss", "Quad Truss"],
  Asteroid_Base: ["Ice", "Metal", "Rock"],
  Orbis_or_Ocellus: ["Ocellus", "Orbis (Apollo)", "Orbis (Artemis)"],
  Dodecahedron: ["No Truss Dodo", "Quint Truss", "Dec Truss"],

  Commercial_Outpost: ["Plutus"],
  Industrial_Outpost: ["Vulcan"],
  Criminal_Outpost: ["Dysnomia"],
  Civilian_Outpost: ["Vesta"],
  Scientific_Outpost: ["Prometheus"],
  Military_Outpost: ["Nemesis"],

  Satellite: ["Hermes", "Angelia", "Eirene"],
  Communication_Station: ["Pistis", "Soter", "Aletheia"],
  Space_Farm: ["Demeter"],
  Pirate_Base: ["Apate", "Laverna"],
  Mining_Outpost: ["Euthenia", "Phorcys"],
  Relay_Station: ["Enodia", "Ichnaea"],

  Military: ["Vacuna", "Alastor"],
  Security_Station: ["Dicaeosyne", "Poena", "Eunomia", "Nomos"],
  Government: ["Harmonia"],
  Medical: ["Asclepius", "Eupraxia"],
  Research_Station: ["Astraeus", "Coeus", "Dodona", "Dione"],
  Tourist: ["Hedone", "Opora", "Pasithea"],
  Space_Bar: ["Dionysus", "Bacchus"],

  Civilian_Planetary_Outpost: ["Hestia", "Decima", "Atropos", "Nona", "Lachesis", "Clotho"],
  Industrial_Planetary_Outpost: ["Hephaestus", "Opis", "Ponos", "Tethys", "Bia", "Mefitis"],
  Scientific_Planetary_Outpost: ["Necessitas", "Ananke", "Fauna", "Providentia", "Antevorta", "Porrima"],
  Planetary_Port: ["Zeus", "Hera", "Poseidon", "Aphrodite"],

  Extraction_Hub: ["Tartarus"],
  Civilian_Hub: ["Aegle"],
  Exploration_Hub: ["Tellus A"],
  Outpost_Hub: ["Io"],
  Scientific_Hub: ["Athena", "Caelus"],
  Military_Hub: ["Alala", "Ares"],
  Refinery_Hub: ["Silenus"],
  High_Tech_Hub: ["Janus"],
  Industrial_Hub: ["Molae", "Tellus B", "Eunostus"],

  Small_Agricultural_Settlement: ["Consus"],
  Medium_Agricultural_Settlement: ["Picumnus", "Annona"],
  Large_Agricultural_Settlement: ["Ceres", "Fornax"],

  Small_Extraction_Settlement: ["Ourea"],
  Medium_Extraction_Settlement: ["Mantus", "Orcus"],
  Large_Extraction_Settlement: ["Erebus", "Aerecura"],

  Small_Industrial_Settlement: ["Fontus"],
  Medium_Industrial_Settlement: ["Meteope", "Palici", "Minthe"],
  Large_Industrial_Settlement: ["Gaea"],

  Small_Military_Settlement: ["Ioke"],
  Medium_Military_Settlement: ["Bellona", "Enyo", "Polemos"],
  Large_Military_Settlement: ["Minerva"],

  Small_Scientific_Settlement: ["Pheobe"],
  Medium_Scientific_Settlement: ["Asteria", "Caerus"],
  Large_Scientific_Settlement: ["Chronos"],

  Small_Tourism_Settlement: ["Aergia"],
  Medium_Tourism_Settlement: ["Comos", "Gelos"],
  Large_Tourism_Settlement: ["Fufluns"],
};

export function getBuildingVariants(name: string): string[] | undefined {
  return BUILDING_VARIANTS[name];
}

// --- Update 3 (May 2025) link/economy topology ------------------------------------------------
// Sourced from official Frontier patch notes (2025-04-27 "Update 3", 2025-06-04 Station Services
// follow-up, 2025-11-11 Dodec Update) — see CLAUDE.md for the full source list.

export type EconomyType =
  | "Agriculture"
  | "Extraction"
  | "HighTech"
  | "Industrial"
  | "Refinery"
  | "Tourism"
  | "Military"
  | "Terraforming"
  | "Colony";

/** Update 3's link-topology "Ports" bucket (14 buildings): Outposts, Coriolis/Orbis/Ocellus/
 * Dodecahedron, Asteroid Base, Planetary Port, and the Planetary Port Outposts — i.e.
 * `ALL_CATEGORIES["Star/Ground Port"]` (8) unioned with the 6 `*_Outpost` space buildings. This is
 * NOT the same set as `isPort()` above (5 buildings, a narrower "escalating-cost-curve" concept) —
 * see that function's doc comment. */
export const PORT_ROLE_BUILDINGS: string[] = [
  ...ALL_CATEGORIES["Star/Ground Port"],
  "Commercial_Outpost",
  "Industrial_Outpost",
  "Criminal_Outpost",
  "Civilian_Outpost",
  "Scientific_Outpost",
  "Military_Outpost",
];

export function isPortRole(name: string): boolean {
  return PORT_ROLE_BUILDINGS.includes(name);
}

/** Update 3's other link-topology bucket: Settlements, Installations, and Hubs — everything that
 * isn't a Port (`PORT_ROLE_BUILDINGS`). */
export const SUPPORTING_FACILITY_BUILDINGS: string[] = Object.keys(ALL_BUILDINGS).filter(
  (name) => !isPortRole(name),
);

/** Port tier for link-topology "highest tier port on this body" comparisons, matching the
 * official "Tier 1/2/3 Port" vocabulary (2025-06-04 Station Services patch note) — derived from
 * the same `T2points`/`T3points === "port"` escalation fields `isPort()` already uses, not a
 * separate hand-authored table. Tier 1 = never escalates past a plain T2-point cost (the 6
 * Outposts + 3 Planetary Outposts); Tier 2 = escalates via T2 points (Coriolis, Asteroid_Base);
 * Tier 3 = escalates via T3 points (Orbis_or_Ocellus, Dodecahedron, Planetary_Port). Only
 * meaningful for `PORT_ROLE_BUILDINGS` — throws for anything else. */
export function getPortTier(name: string): 1 | 2 | 3 {
  if (!isPortRole(name)) throw new Error(`"${name}" is not a Port-role building`);
  const building = ALL_BUILDINGS[name];
  if (building.T3points === "port") return 3;
  if (building.T2points === "port") return 2;
  return 1;
}

/** How much of a linked economy a building contributes onward through a strong link — a different
 * axis than `getPortTier()`'s official "Tier 1/2/3 Port" vocabulary above (that's about escalating
 * construction cost and same-body strong-link dominance priority, and only applies to
 * `PORT_ROLE_BUILDINGS`; this applies to every building, ports and supporting facilities alike, and
 * is purely about how big a proportion of its economy a link carries). User-supplied rule, derived
 * directly from a building's own T2/T3 point generation (the same `T2points`/`T3points` fields
 * `getPortTier`/`isPort` already use, i.e. no new hand-authored table): a building that grants a
 * flat T2 point is Tier 1; one that grants a flat T3 point instead (1 or 2 — the amount doesn't
 * matter, only that it's a fixed positive number, not the escalating `"port"` sentinel) is Tier 2;
 * a building that grants neither a fixed T2 nor T3 amount (only the 3 buildings whose own
 * escalation currency IS T3 itself — `Orbis_or_Ocellus`/`Dodecahedron`/`Planetary_Port`) is Tier 3.
 * `Coriolis`/`Asteroid_Base` escalate via T2 cost but still grant a flat, non-escalating T3points=1,
 * so they land in Tier 2 here — coincidentally the same number `getPortTier` gives them, but from an
 * entirely different computation (that one reads T2points==="port"; this one reads T3points>0). */
export function getLinkContributionTier(name: string): 1 | 2 | 3 {
  const building = ALL_BUILDINGS[name];
  if (typeof building.T2points === "number" && building.T2points > 0) return 1;
  if (typeof building.T3points === "number" && building.T3points > 0) return 2;
  return 3;
}

// UNVERIFIED, best-effort. Update 3's body-attribute -> Colony-override table (see
// domain/economyOverrides.ts) and the strong-link boost/decrease table are verbatim from official
// patch notes, but no verbatim mapping from every Hub/Settlement/Installation building to an
// economy type was ever given — this is inferred from naming convention where it's unambiguous,
// and left deliberately unmapped (contributes no additional economy type via links) where it
// isn't, rather than guessed. Revise freely — this is exactly the kind of constant the
// FIRST_STATION_BONUS/GROUND_SLOT_RADIUS_THRESHOLDS precedent calls for: named, commented, easy to
// correct once confirmed in-game. Deliberately left unmapped (no confident naming signal):
// Government, Medical, Communication_Station, Relay_Station, Pirate_Base, Outpost_Hub, Space_Farm.
export const FACILITY_ECONOMY_GUESS: Partial<Record<string, EconomyType[]>> = {
  Extraction_Hub: ["Extraction"],
  Small_Extraction_Settlement: ["Extraction"],
  Medium_Extraction_Settlement: ["Extraction"],
  Large_Extraction_Settlement: ["Extraction"],
  Mining_Outpost: ["Extraction"],
  Industrial_Hub: ["Industrial"],
  Small_Industrial_Settlement: ["Industrial"],
  Medium_Industrial_Settlement: ["Industrial"],
  Large_Industrial_Settlement: ["Industrial"],
  Civilian_Hub: ["Agriculture"],
  Small_Agricultural_Settlement: ["Agriculture"],
  Medium_Agricultural_Settlement: ["Agriculture"],
  Large_Agricultural_Settlement: ["Agriculture"],
  High_Tech_Hub: ["HighTech"],
  Scientific_Hub: ["HighTech"],
  Research_Station: ["HighTech"],
  Small_Scientific_Settlement: ["HighTech"],
  Medium_Scientific_Settlement: ["HighTech"],
  Large_Scientific_Settlement: ["HighTech"],
  Exploration_Hub: ["HighTech"],
  Refinery_Hub: ["Refinery"],
  Military_Hub: ["Military"],
  Military: ["Military"],
  Security_Station: ["Military"],
  Small_Military_Settlement: ["Military"],
  Medium_Military_Settlement: ["Military"],
  Large_Military_Settlement: ["Military"],
  Tourist: ["Tourism"],
  Space_Bar: ["Tourism"],
  Satellite: ["Tourism"],
  Small_Tourism_Settlement: ["Tourism"],
  Medium_Tourism_Settlement: ["Tourism"],
  Large_Tourism_Settlement: ["Tourism"],
};

// Sourced verbatim from DaftMav-v3.4.1.ods's "Stats" tab, "Facility Economy" column (column O) —
// of the 14 `PORT_ROLE_BUILDINGS`, these are the ones with a fixed, non-"Colony" facility economy
// there (`Asteroid Base` -> Extraction; `Military`/`Industrial`/`Scientific Outpost` (space) and
// `Industrial`/`Scientific Planetary Outpost` (ground) -> their own named economy). Everything else
// in `PORT_ROLE_BUILDINGS` (the sheet lists it as plain "Colony", not fixed) defaults to "Colony"
// and picks up `economyOverrides.ts`'s `computeBodyEconomyOverrides` body-attribute table on top,
// per the official patch notes' "every port's economy defaults to Colony... gets this ADDED based
// on the body" rule — including `Civilian_Outpost`/`Commercial_Outpost` (space) and
// `Civilian_Planetary_Outpost` (ground), despite sharing the Military/Industrial/Scientific
// Outposts' naming convention: this was the actual bug the user found (`Civilian_Planetary_Outpost`
// was wrongly hardcoded to fixed Colony 100% instead of the body-derived economy, confirmed
// in-game), and the sheet confirms `Civilian`/`Commercial_Outpost` should get the same treatment,
// not the fixed-100%-Colony one an earlier version of this table gave them (see
// `SystemConfigPanel.tsx`'s `facilityBaseEconomies` — this table takes priority over the body-driven
// branch only for the entries actually listed here).
//
// `Criminal_Outpost`'s sheet economy is "Contraband" — not one of this app's `EconomyType` union
// values at all (Contraband isn't in any of the officially-sourced Update 3 tables CLAUDE.md
// documents either), so there's no way to represent it; deliberately left OUT of this table
// (falls through to the Colony-default branch instead, which is a known-approximate placeholder,
// not a confirmed value) rather than guessed at. Revisit if this app ever adds Contraband support.
export const PORT_FIXED_ECONOMY: Partial<Record<string, EconomyType[]>> = {
  Asteroid_Base: ["Extraction"],
  Military_Outpost: ["Military"],
  Industrial_Outpost: ["Industrial"],
  Scientific_Outpost: ["HighTech"],
  Industrial_Planetary_Outpost: ["Industrial"],
  Scientific_Planetary_Outpost: ["HighTech"],
};

export function toPrintable(name: string): string {
  return name.replace(/_/g, " ");
}

export function fromPrintable(displayName: string): string {
  return displayName.replace(/ /g, "_");
}
