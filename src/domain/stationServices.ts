// Update 3 follow-up: station-service activation rules, sourced verbatim from the official
// Frontier patch notes dated 2025-06-04 (see CLAUDE.md for the full source list). Ports only —
// the source also grants Commodities Market to "All Settlements," but this module is queried
// per-port by LinksPanel and doesn't report facility-level service availability.
//
// IMPORTANT CAVEAT on "Tier 1/2/3 Port": the source's tier language for service activation is
// about a specific port INSTANCE's own upgrade investment (has T2/T3 construction points been
// spent on *this* port yet), which this app's solver doesn't track — it only tracks aggregate
// T2/T3 points spent system-wide and a build-order SEQUENCE index (`port_k`), never per-instance
// upgrade state. This module instead reuses `getPortTier()` — a BUILDING TYPE's static escalation
// ceiling (does this building ever use T2/T3-point "port" costs at all, and which). For a
// building type whose ceiling is already Tier 2 or 3 (Coriolis, Asteroid_Base, Orbis_or_Ocellus,
// Dodecahedron, Planetary_Port), this treats every instance as already at that ceiling — an
// optimistic approximation that likely OVERSTATES service availability for a freshly-built,
// not-yet-upgraded instance of one of those building types. The source's separate "Tier 1 Planet
// Port" fallback bullets (for Shipyard, Vista Genomics) become moot under this approximation,
// since Planetary_Port already unconditionally qualifies via the "Tier 2/3 port" bullet — so
// they're deliberately not implemented as separate cases here.
//
// Two further interpretation calls, both flagged rather than silently resolved: "Pirate Outpost"
// (Black Market) has no exact building-name match in this app's data — mapped to `Criminal_Outpost`
// as the closest narrative equivalent. "Research Bio Settlements" (Universal Cartographics) has no
// building-name match either and isn't a port, so it's dropped entirely (ports-only scope, above).

import { getPortTier, isPortRole } from "../data/buildings";

export type StationService =
  | "Commodities Market"
  | "Shipyard"
  | "Outfitting"
  | "Universal Cartographics"
  | "Vista Genomics"
  | "Black Market"
  | "Crew Lounge"
  | "Pioneer Supplies";

export interface PortServicesResult {
  building: string;
  bodyId: number;
  available: StationService[];
  /** Services this port otherwise qualifies for, but which are blocked solely by
   * `systemTechLevel < 35` (the source's universal Shipyard/Outfitting gate). */
  missingForTechGate: StationService[];
}

const OUTPOST_NAMES = [
  "Commercial_Outpost",
  "Industrial_Outpost",
  "Criminal_Outpost",
  "Civilian_Outpost",
  "Scientific_Outpost",
  "Military_Outpost",
];
const CIVILIAN_FRIENDLY_OUTPOSTS = ["Commercial_Outpost", "Industrial_Outpost", "Civilian_Outpost"];
const OTHER_OUTPOSTS = ["Criminal_Outpost", "Scientific_Outpost", "Military_Outpost"];

function hasAny(haystack: string[], needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function commoditiesMarket(building: string, tier: number, strong: string[], system: Set<string>): boolean {
  if (tier >= 2) return true;
  if (CIVILIAN_FRIENDLY_OUTPOSTS.includes(building)) {
    if (hasAny(strong, ["Communication_Station", "Relay_Station"])) return true;
    if (hasAny([...system], ["Tourist", "Space_Bar", "Outpost_Hub"])) return true;
    return false;
  }
  if (OTHER_OUTPOSTS.includes(building)) {
    return hasAny(strong, ["Communication_Station", "Relay_Station", "Tourist", "Space_Bar", "Outpost_Hub"]);
  }
  return false;
}

function shipyard(_building: string, tier: number): boolean {
  return tier >= 2;
}

function outfitting(building: string, tier: number, strong: string[], system: Set<string>): boolean {
  if (tier >= 2) return true;
  if (building === "Military_Outpost") return true;
  if (building === "Industrial_Planetary_Outpost") return true;
  const nonMilitaryOutpost = OUTPOST_NAMES.includes(building) && building !== "Military_Outpost";
  const nonIndustrialPlanetaryOutpost = ["Civilian_Planetary_Outpost", "Scientific_Planetary_Outpost"].includes(building);
  if (nonMilitaryOutpost || nonIndustrialPlanetaryOutpost) {
    if (hasAny(strong, ["Industrial_Hub"])) return true;
    if (hasAny([...system], ["Military", "High_Tech_Hub"])) return true;
  }
  return false;
}

function universalCartographics(building: string, tier: number, strong: string[], system: Set<string>): boolean {
  if (tier === 3) return true;
  if (building === "Scientific_Outpost") return true;
  if (tier === 1 || tier === 2) {
    if (hasAny(strong, ["Satellite", "Communication_Station", "Relay_Station"])) return true;
    if (hasAny([...system], ["Research_Station", "Exploration_Hub"])) return true;
  }
  return false;
}

function vistaGenomics(_building: string, tier: number, strong: string[], system: Set<string>): boolean {
  if (tier === 3) return true;
  if (tier === 2) {
    if (hasAny(strong, ["Satellite", "Communication_Station", "Relay_Station"])) return true;
    if (hasAny([...system], ["Medical", "Scientific_Hub"])) return true;
  }
  return false;
}

function blackMarket(building: string, strong: string[]): boolean {
  if (building === "Criminal_Outpost") return true; // "Pirate Outpost" in the source — see header caveat
  return hasAny(strong, ["Pirate_Base"]);
}

function crewLounge(building: string, tier: number, system: Set<string>): boolean {
  if (tier >= 2) return true;
  if (building === "Criminal_Outpost" || building === "Civilian_Outpost") return true;
  if (building === "Civilian_Planetary_Outpost") return true;
  return tier === 1 && system.has("Space_Bar");
}

/** Verbatim (with the caveats documented above) station-service unlock rules for a single port.
 * `stronglyLinkedBuildings` should be every building name strong-linked to this port (from
 * `links.ts`'s `StrongLink.fromBuilding`, filtered to this port). `systemBuildingNames` is every
 * building type present anywhere in the system, regardless of link, for the source's "X built in
 * system" (not strong-link-gated) conditions. */
export function computePortServices(
  port: { building: string; bodyId: number },
  stronglyLinkedBuildings: string[],
  systemBuildingNames: Set<string>,
  systemTechLevel: number,
): PortServicesResult {
  if (!isPortRole(port.building)) throw new Error(`"${port.building}" is not a Port-role building`);
  const tier = getPortTier(port.building);
  const available: StationService[] = [];
  const missingForTechGate: StationService[] = [];

  if (commoditiesMarket(port.building, tier, stronglyLinkedBuildings, systemBuildingNames)) {
    available.push("Commodities Market");
  }
  if (blackMarket(port.building, stronglyLinkedBuildings)) available.push("Black Market");
  if (crewLounge(port.building, tier, systemBuildingNames)) available.push("Crew Lounge");
  if (universalCartographics(port.building, tier, stronglyLinkedBuildings, systemBuildingNames)) {
    available.push("Universal Cartographics");
  }
  if (vistaGenomics(port.building, tier, stronglyLinkedBuildings, systemBuildingNames)) available.push("Vista Genomics");
  available.push("Pioneer Supplies"); // every tier of every port, unconditionally

  function techGated(qualifies: boolean, service: StationService): void {
    if (!qualifies) return;
    if (systemTechLevel >= 35) available.push(service);
    else missingForTechGate.push(service);
  }
  techGated(shipyard(port.building, tier), "Shipyard");
  techGated(outfitting(port.building, tier, stronglyLinkedBuildings, systemBuildingNames), "Outfitting");

  return { building: port.building, bodyId: port.bodyId, available, missingForTechGate };
}
