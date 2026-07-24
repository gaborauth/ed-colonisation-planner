// Update 3 (May 2025) body-attribute economy modeling, sourced verbatim from official Frontier
// patch notes (2025-04-27 "Update 3" — see CLAUDE.md for the full source list). Two separate
// tables from that source are implemented here:
//  - The "Colony" economy OVERRIDE table: every port's economy defaults to "Colony" but gets this
//    stacked on top depending on the body it's on/around (computeBodyEconomyOverrides).
//  - The strong-link BOOST/DECREASE table: strong links (only) get their economic supply
//    performance boosted or decreased by the same kind of body/system characteristics
//    (computeBoostDecrease). Weak links are unaffected by this mechanic, per the source.
//
// Several trigger conditions in both tables (organics presence, geologicals presence, volcanism,
// system-wide resource level) are NOT derivable from the `Scan` events this app's journal parser
// ingests — they come from SAASignalsFound/FSSBodySignals (after a DSS/FSS scan) or reserve-level
// data this tool doesn't parse. Every predicate for those returns `null` (unknown), never a
// guessed `false` — silently treating "unknown" as "absent" would understate boosts/overrides the
// player actually has in-game. Callers should surface `null`/"unevaluated" distinctly from a
// confidently-computed absence.

import type { EconomyType } from "../data/buildings";
import type { JournalBody } from "../journal/parser";

function planetClassLower(body: JournalBody): string {
  return (body.planetClass ?? "").toLowerCase();
}

export function isELW(body: JournalBody): boolean {
  return planetClassLower(body).includes("earthlike");
}

export function isWaterWorld(body: JournalBody): boolean {
  return planetClassLower(body) === "water world";
}

export function isAmmoniaWorld(body: JournalBody): boolean {
  return planetClassLower(body) === "ammonia world";
}

/** Covers both "High metal content body" and "Metal rich body" — the source table lists them
 * together ("High metal content and metal rich world"). */
export function isHighMetalContent(body: JournalBody): boolean {
  const c = planetClassLower(body);
  return c.includes("high metal content") || c.includes("metal rich");
}

export function isGasGiant(body: JournalBody): boolean {
  return planetClassLower(body).includes("gas giant");
}

export function isRockyIce(body: JournalBody): boolean {
  return planetClassLower(body) === "rocky ice body";
}

export function isRockyBody(body: JournalBody): boolean {
  return planetClassLower(body) === "rocky body";
}

export function isIcyBody(body: JournalBody): boolean {
  return planetClassLower(body) === "icy body";
}

/** Also covers "stars with asteroid belts" per the source table — a star is just a JournalBody
 * with kind "star" and its own `rings`, so this needs no special-casing. */
export function hasRings(body: JournalBody): boolean {
  return body.rings.length > 0;
}

export function isTerraformable(body: JournalBody): boolean {
  return body.terraformState !== undefined;
}

export type StarCategory = "blackhole" | "neutronstar" | "whitedwarf" | "other";

/** Categorizes a star body for the override table's star-type rules. Brown dwarfs and every
 * regular star class collapse into "other" since the source table treats them identically
 * ("Brown Dwarves and all other star types" -> Military). Returns null for non-star bodies or
 * stars with no recorded StarType. */
export function starTypeOf(body: JournalBody): StarCategory | null {
  if (body.kind !== "star" || !body.starType) return null;
  if (body.starType === "H" || body.starType === "SupermassiveBlackHole") return "blackhole";
  if (body.starType === "N") return "neutronstar";
  if (body.starType.startsWith("D")) return "whitedwarf";
  return "other";
}

export function systemHasBlackHole(bodies: JournalBody[]): boolean {
  return bodies.some((b) => starTypeOf(b) === "blackhole");
}

export function systemHasWhiteDwarf(bodies: JournalBody[]): boolean {
  return bodies.some((b) => starTypeOf(b) === "whitedwarf");
}

export function systemHasNeutronStar(bodies: JournalBody[]): boolean {
  return bodies.some((b) => starTypeOf(b) === "neutronstar");
}

/** Walks a body's parent chain to determine "tidally locked to its star" (a planet directly) or
 * "a moon tidally locked to its planet, where the planet chain up to the star is also tidally
 * locked" (transitively) — the source table's two separate Agriculture-decrease bullets collapse
 * into one recursive check. Missing scan data anywhere in the chain (a parent body that was never
 * scanned) returns `false`, not a guessed decrease — this is a DEcrease condition, and inventing
 * one from absent data would be worse than just not applying it. */
export function isTidalLockChainToStar(body: JournalBody, allBodiesById: Map<number, JournalBody>): boolean {
  if (!body.tidalLocked) return false;
  const parent = body.parents[0];
  if (!parent) return false;
  if (parent.type === "Star") return true;
  if (parent.type !== "Planet") return false;
  const parentBody = allBodiesById.get(parent.bodyId);
  if (!parentBody) return false;
  return isTidalLockChainToStar(parentBody, allBodiesById);
}

// --- Genuinely unavailable from this app's Journal Scan-event data — always `null` ------------

export function hasOrganics(_body: JournalBody): boolean | null {
  return null;
}

export function hasGeologicals(_body: JournalBody): boolean | null {
  return null;
}

export function hasVolcanism(_body: JournalBody): boolean | null {
  return null;
}

/** Deliberately NOT proxied via `JournalRing.reserveLevel` (per-ring mining reserve) — that's a
 * different, per-ring concept from this table's system-wide "major/pristine/low/depleted
 * resources" rating. Always null until a real source is found. */
export function systemResourceLevel(_bodies: JournalBody[]): "major" | "pristine" | "low" | "depleted" | null {
  return null;
}

export interface OverrideResult {
  /** Stacked; empty means the port stays at the default "Colony" economy. */
  economies: EconomyType[];
  appliedRules: string[];
  /** Rules that would apply if this tool could evaluate their trigger (organics/geologicals),
   * but can't from Scan-event data alone — surfaced so the UI can say "unknown" rather than
   * silently omitting a real in-game override. */
  unevaluatedRules: string[];
}

/** Verbatim body-attribute -> Colony-override table. Every port's economy defaults to "Colony"
 * and gets this ADDED (stacked) based on the body it's on/around. */
export function computeBodyEconomyOverrides(body: JournalBody): OverrideResult {
  const economies = new Set<EconomyType>();
  const appliedRules: string[] = [];
  const unevaluatedRules: string[] = [];

  function add(types: EconomyType[], reason: string): void {
    for (const t of types) economies.add(t);
    appliedRules.push(reason);
  }

  const star = starTypeOf(body);
  if (star === "blackhole" || star === "neutronstar" || star === "whitedwarf") {
    add(["HighTech", "Tourism"], `star type ${body.starType} (black hole, neutron star, or white dwarf)`);
  } else if (star === "other") {
    add(["Military"], `star type ${body.starType} (brown dwarf or other star)`);
  }

  if (isELW(body)) add(["Agriculture", "HighTech", "Military", "Tourism"], "Earth-like world");
  if (isWaterWorld(body)) add(["Agriculture", "Tourism"], "Water world");
  if (isAmmoniaWorld(body)) add(["HighTech", "Tourism"], "Ammonia world");
  if (isGasGiant(body)) add(["HighTech", "Industrial"], "Gas giant");
  if (isHighMetalContent(body)) add(["Extraction"], "High metal content / metal rich world");
  if (isRockyIce(body)) add(["Industrial", "Refinery"], "Rocky ice body");
  if (isRockyBody(body)) add(["Refinery"], "Rocky body");
  if (isIcyBody(body)) add(["Industrial"], "Icy body");
  if (hasRings(body)) add(["Extraction"], "Has rings (or a star with an asteroid belt)");

  const organics = hasOrganics(body);
  if (organics === true) add(["Agriculture", "Terraforming"], "Has organics");
  else if (organics === null) {
    unevaluatedRules.push(
      "Has organics -> Agriculture, Terraforming (organics presence unknown: needs DSS/FSS scan data this tool doesn't parse)",
    );
  }

  const geologicals = hasGeologicals(body);
  if (geologicals === true) add(["Extraction", "Industrial"], "Has geologicals");
  else if (geologicals === null) {
    unevaluatedRules.push(
      "Has geologicals -> Extraction, Industrial (geologicals presence unknown: needs DSS/FSS scan data this tool doesn't parse)",
    );
  }

  return { economies: Array.from(economies), appliedRules, unevaluatedRules };
}

export interface BoostDecreaseResult {
  boosted: EconomyType[];
  decreased: EconomyType[];
  reasons: string[];
}

/** Verbatim strong-link boost/decrease table. Only meaningful for strong links (per the source —
 * weak links are unaffected). `economiesToCheck` should be the set of economy types actually
 * present at the linked port/facility pair (its own overrides plus whatever's being delivered by
 * this link), since the boost/decrease is per-economy-type, not a flat multiplier on the link. */
export function computeBoostDecrease(
  body: JournalBody,
  bodies: JournalBody[],
  economiesToCheck: EconomyType[],
): BoostDecreaseResult {
  const boosted = new Set<EconomyType>();
  const decreased = new Set<EconomyType>();
  const reasons: string[] = [];
  const allBodiesById = new Map(bodies.map((b) => [b.bodyId, b]));

  const resourceLevel = systemResourceLevel(bodies);
  const organics = hasOrganics(body);
  const geologicals = hasGeologicals(body);
  const volcanism = hasVolcanism(body);
  const tidalDecrease = isTidalLockChainToStar(body, allBodiesById);

  const wants = (economy: EconomyType) => economiesToCheck.includes(economy);

  if (wants("Agriculture")) {
    if (isELW(body)) {
      boosted.add("Agriculture");
      reasons.push("Agriculture boosted: orbiting an Earth-like world");
    }
    if (isTerraformable(body)) {
      boosted.add("Agriculture");
      reasons.push("Agriculture boosted: on/orbiting a terraformable body");
    }
    if (organics === true) {
      boosted.add("Agriculture");
      reasons.push("Agriculture boosted: on/orbiting a body with organics");
    } else if (organics === null) {
      reasons.push("Agriculture: organics presence unknown (needs DSS/FSS scan data)");
    }
    if (isIcyBody(body)) {
      decreased.add("Agriculture");
      reasons.push("Agriculture decreased: on/orbiting an icy body");
    }
    if (tidalDecrease) {
      decreased.add("Agriculture");
      reasons.push("Agriculture decreased: tidally locked to its star (directly, or via a locked moon chain)");
    }
  }

  if (wants("Extraction")) {
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      boosted.add("Extraction");
      reasons.push("Extraction boosted: system has major/pristine resources");
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      decreased.add("Extraction");
      reasons.push("Extraction decreased: system has low/depleted resources");
    } else {
      reasons.push("Extraction: system resource level unknown (not derivable from Journal Scan data)");
    }
    if (volcanism === true) {
      boosted.add("Extraction");
      reasons.push("Extraction boosted: on/orbiting a body with volcanism");
    } else if (volcanism === null) {
      reasons.push("Extraction: volcanism presence unknown (needs DSS/FSS scan data)");
    }
  }

  if (wants("HighTech")) {
    if (isAmmoniaWorld(body)) {
      boosted.add("HighTech");
      reasons.push("HighTech boosted: orbiting an ammonia world");
    }
    if (isELW(body)) {
      boosted.add("HighTech");
      reasons.push("HighTech boosted: orbiting an Earth-like world");
    }
    if (geologicals === true) {
      boosted.add("HighTech");
      reasons.push("HighTech boosted: on/orbiting a body with geologicals");
    } else if (geologicals === null) {
      reasons.push("HighTech: geologicals presence unknown (needs DSS/FSS scan data)");
    }
    if (organics === true) {
      boosted.add("HighTech");
      reasons.push("HighTech boosted: on/orbiting a body with organics");
    }
  }

  const industrialRefineryTargets = (["Industrial", "Refinery"] as const).filter(wants);
  if (industrialRefineryTargets.length > 0) {
    const label = industrialRefineryTargets.join("/");
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      for (const t of industrialRefineryTargets) boosted.add(t);
      reasons.push(`${label} boosted: system has major/pristine resources`);
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      for (const t of industrialRefineryTargets) decreased.add(t);
      reasons.push(`${label} decreased: system has low/depleted resources`);
    } else {
      reasons.push(`${label}: system resource level unknown (not derivable from Journal Scan data)`);
    }
  }

  if (wants("Tourism")) {
    if (isAmmoniaWorld(body)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: orbiting an ammonia world");
    }
    if (systemHasBlackHole(bodies)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: system has a black hole");
    }
    if (isELW(body)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: orbiting an Earth-like world");
    }
    if (geologicals === true) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: on/orbiting a body with geologicals");
    }
    if (organics === true) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: on/orbiting a body with organics");
    }
    if (isWaterWorld(body)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: orbiting a water world");
    }
    if (systemHasWhiteDwarf(bodies)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: system has a white dwarf");
    }
    if (systemHasNeutronStar(bodies)) {
      boosted.add("Tourism");
      reasons.push("Tourism boosted: system has a neutron star");
    }
  }

  return { boosted: Array.from(boosted), decreased: Array.from(decreased), reasons };
}
