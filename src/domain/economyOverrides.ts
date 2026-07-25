// Update 3 (May 2025) body-attribute economy modeling, sourced verbatim from official Frontier
// patch notes (2025-04-27 "Update 3" — see CLAUDE.md for the full source list). Two separate
// tables from that source are implemented here:
//  - The "Colony" economy OVERRIDE table: every port's economy defaults to "Colony" but gets this
//    stacked on top depending on the body it's on/around (computeBodyEconomyOverrides).
//  - The strong-link BOOST/DECREASE table: strong links (only) get their economic supply
//    performance boosted or decreased by the same kind of body/system characteristics
//    (computeBoostDecrease). Weak links are unaffected by this mechanic, per the source.
//
// Every trigger condition is now confidently answerable when the underlying Journal data is
// present: `Volcanism` is a plain field on every `Scan` event (not DSS-only, despite what an
// earlier version of this comment claimed); organics/geologicals are confidently `false` (not
// "unknown") for an unlandable body (gas giant, star) — there's no surface to have signals on — and
// confidently readable for a landable one via the Journal's `FSSBodySignals` event (an ordinary
// FSS/"honk" scan, no DSS needed — see `journal/parser.ts`'s `hasBiologicalSignals`/
// `hasGeologicalSignals`), when that body was actually FSS-signal-scanned; `ReserveLevel` is a
// top-level field on a ringed body's own `Scan` event (`JournalBody.reserveLevel` — confirmed
// against a real journal line; an earlier version of this parser incorrectly looked for it nested
// per-ring instead, where it's never actually populated) but represents a system-wide fact despite
// living on one specific body — any ringed body in the system reporting one is read as the whole
// system's resource level (`systemResourceLevel`). Every predicate below returns
// `null` only when truly unknown (the relevant event/field was never seen), never a guessed
// `false` — silently treating "unknown" as "absent" would understate boosts/overrides the player
// actually has in-game. Callers should surface `null`/"unevaluated" distinctly from a
// confidently-computed absence.

import { FACILITY_ECONOMY_GUESS, isPortRole, PORT_FIXED_ECONOMY, type EconomyType } from "../data/buildings";
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
 * into one recursive check. Real-game-verified (user report): the decrease requires the WHOLE chain
 * up to the star to be tidally locked — one un-locked link anywhere breaks it, confirming the
 * official wording is meant literally, not just "this body is tidally locked to *something*".
 *
 * Scans `body.parents` (not just its first entry) before giving up, to skip past a `"Null"`
 * entry — a binary-pair barycenter (two planets, or a planet and its parent star, orbiting their
 * shared center of mass) rather than a real body that can itself be tidally locked or not, and with
 * no scanned `Scan` event of its own to look up (confirmed: none of a real system's barycenter
 * `BodyID`s ever appear as a body in `allBodiesById`). An earlier version of this function treated
 * any non-"Planet"/non-"Star" immediate parent as an instant chain-break, which incorrectly zeroed
 * out real tidally-locked planets in a binary pair — e.g. a planet whose immediate parent hop is
 * `[Null, Star]` (two gas giants orbiting each other, that pair then orbiting the system's star).
 * Still recurses into the actual looked-up `JournalBody` on hitting a `"Planet"` entry (rather than
 * assuming `body.parents` is already the complete near-to-far chain) — real Journal data does list
 * the full chain on every body already, but recursing keeps this correct even if it didn't. Missing
 * scan data anywhere in the chain (a `"Planet"` ancestor that was never itself scanned) returns
 * `false`, not a guessed decrease — this is a DEcrease condition, and inventing one from absent data
 * would be worse than just not applying it. */
export function isTidalLockChainToStar(body: JournalBody, allBodiesById: Map<number, JournalBody>): boolean {
  if (!body.tidalLocked) return false;
  for (const parent of body.parents) {
    if (parent.type === "Star") return true;
    if (parent.type === "Null") continue;
    if (parent.type !== "Planet") return false;
    const parentBody = allBodiesById.get(parent.bodyId);
    if (!parentBody) return false;
    return isTidalLockChainToStar(parentBody, allBodiesById);
  }
  return false;
}

// --- Organics/geologicals/volcanism: confident where the data allows, `null` otherwise ---------

/** Confidently `false` for an unlandable body (no surface, no bio signals possible); otherwise the
 * Journal's `FSSBodySignals`-derived flag (see `journal/parser.ts`) when that body was actually
 * FSS-signal-scanned, `null` (genuinely unknown) if not. */
export function hasOrganics(body: JournalBody): boolean | null {
  if (!body.landable) return false;
  return body.hasBiologicalSignals ?? null;
}

/** Same reasoning as `hasOrganics` — confidently `false` when unlandable (R55 of the community
 * EconomicEffects.ods research sheet: "unlandable bodies are not treated as having geologicals"),
 * otherwise the parsed `FSSBodySignals` flag or `null` if unknown. */
export function hasGeologicals(body: JournalBody): boolean | null {
  if (!body.landable) return false;
  return body.hasGeologicalSignals ?? null;
}

/** `Volcanism` is a plain string field on every planet's `Scan` event (kept verbatim in
 * `body.raw`), independent of `Landable` — unlike `hasOrganics`/`hasGeologicals` (which read
 * DSS/FSS-derived *signal counts* that really are landable-gated per the community research sheet),
 * this is direct Scan data reported regardless of whether the body can be landed on. A previous
 * version of this function incorrectly returned `false` for any unlandable body, over-generalizing
 * that same landable-gating from `hasGeologicals` — real counterexample confirmed by the user: two
 * `Landable: false` bodies (a High Metal Content world and an Icy world in their own system) both
 * report real non-empty `Volcanism` text ("major rocky magma volcanism", "water geysers
 * volcanism"). `null` only when the field itself is genuinely absent (e.g. a star's Scan event, or
 * an older export predating `raw` capture), never inferred from landability. */
export function hasVolcanism(body: JournalBody): boolean | null {
  const volcanism = body.raw.Volcanism;
  return typeof volcanism === "string" ? volcanism.length > 0 : null;
}

/** Matches a raw `ReserveLevel` string case-insensitively by substring (Frontier's exact wording
 * — "Pristine" vs. "PristineResources" and similar — isn't confirmed, so this is robust to either).
 * "Common"/unrecognized values return `null`: a real, known, but non-boosting/non-decreasing
 * level, not something to treat as absent. */
function classifyReserveLevel(raw: string | undefined): "major" | "pristine" | "low" | "depleted" | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("pristine")) return "pristine";
  if (lower.includes("major")) return "major";
  if (lower.includes("depleted")) return "depleted";
  if (lower.includes("low")) return "low";
  return null;
}

/** `ReserveLevel` is a top-level field on a ringed body's own `Scan` event
 * (`JournalBody.reserveLevel` — confirmed against a real journal line; it's never nested per-ring)
 * but is a system-wide fact in-game, not an independent per-body one — confirmed directly by the
 * user. Returns the first classified level found across every body in the system, treating it as
 * the whole system's resource level; `null` if no body has reported one (e.g. no ringed body was
 * scanned closely enough — reserve level isn't populated by a distant FSS/"honk" scan alone). */
export function systemResourceLevel(bodies: JournalBody[]): "major" | "pristine" | "low" | "depleted" | null {
  for (const body of bodies) {
    const level = classifyReserveLevel(body.reserveLevel);
    if (level) return level;
  }
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

/** A facility/port's own base economy type(s), before any body-feature boost/decrease or strong-link
 * contribution is applied. Three cases, checked in order: a port with a sheet-confirmed fixed,
 * non-"Colony" economy — its `PORT_FIXED_ECONOMY` entry (e.g. Military Outpost is always 100%
 * Military, regardless of the body — checked first since these buildings are also `isPortRole`); a
 * generic Colony-default port's `computeBodyEconomyOverrides(body).economies` (defaulting to
 * `["Colony"]` when empty, same convention `LinksPanel.tsx` already uses for display); or a
 * supporting facility's single `FACILITY_ECONOMY_GUESS` entry (empty for a deliberately-unmapped
 * building, which correctly omits the Economy ratios section entirely for those). Shared by
 * `SystemConfigPanel.tsx` (a facility's own displayed ratio) and `links.ts` (what a port/facility
 * forwards through a strong link) — lives here rather than in either caller so both use the exact
 * same base-economy determination. */
export function facilityBaseEconomies(building: string, body: JournalBody): EconomyType[] {
  const specialized = PORT_FIXED_ECONOMY[building];
  if (specialized) return specialized;
  if (isPortRole(building)) {
    const economies = computeBodyEconomyOverrides(body).economies;
    return economies.length > 0 ? economies : ["Colony"];
  }
  return FACILITY_ECONOMY_GUESS[building] ?? [];
}

export interface BoostDecreaseResult {
  boosted: EconomyType[];
  decreased: EconomyType[];
  reasons: string[];
  /** Signed sum of every individual ±0.4 contribution actually applied, per economy in
   * `economiesToCheck` — unlike `boosted`/`decreased` (plain Set membership), this preserves
   * magnitude when multiple independent conditions stack on the same economy (community-sourced
   * additive-stacking rule, `EconomicEffects.ods` R68 — see `computeEconomyRatios`, the only
   * current consumer of this field; `boosted`/`decreased` are still derived from its sign for
   * `links.ts`'s existing use). Economies with no applicable condition are simply absent (delta 0). */
  deltas: Partial<Record<EconomyType, number>>;
}

/** Per-condition boost/decrease magnitude — community-sourced (`EconomicEffects.ods`'s "Strong
 * Link Modifiers" table), not an official Frontier-published number, but close to universal across
 * every row in that sheet regardless of which economy or condition. See CLAUDE.md's "Explicitly
 * unverified/best-effort constants" section. */
const BOOST_DECREASE_DELTA = 0.4;

/** The official patch notes (and `EconomicEffects.ods`'s "Strong Link Modifiers" sheet) both list a
 * Terraformable body as an Agriculture strong-link boost condition — but real-game testing
 * (user-confirmed against actual builds) found it has no observable effect on Agriculture's value at
 * all, suspected to be a Frontier bug rather than a documentation error. Deliberately excluded from
 * every boost/decrease computation in this file (`computeBoostDecrease`,
 * `computeColonyEconomyBreakdown`, `computeStrongLinkBreakdown`) so displayed values match what the
 * game actually does, not what the patch notes say it should — trivial to re-enable (search this
 * constant's usages) if/when Frontier fixes it. Surfaced as a short UI disclaimer instead, right next
 * to the body-info hover's economy tables (see `SystemConfigPanel.tsx`'s `bodyInfoContent`), linking
 * to the full explanation on `public/known-issues.html` (`TERRAFORMABLE_AGRICULTURE_BUG_LINK` below)
 * rather than spelling it all out inline — the hover box uses a `white-space: nowrap` bubble
 * (`Tooltip.css`), so a long inline sentence used to force it absurdly wide instead of wrapping. See
 * CLAUDE.md's "Explicitly unverified/best-effort constants" section. */
export const TERRAFORMABLE_AGRICULTURE_BUG_NOTE = "Terraformable's Agriculture boost isn't applied (suspected game bug).";

/** `public/known-issues.html`'s matching `id`, kept as one string constant so the two ends of the
 * link can't silently drift apart — see `TERRAFORMABLE_AGRICULTURE_BUG_NOTE` above. Relative (no
 * leading slash) so it resolves correctly under both the Vite dev server and the production build's
 * `/ed-colonisation-planner/` base path (`vite.config.ts`) without hardcoding either. */
export const TERRAFORMABLE_AGRICULTURE_BUG_LINK = "known-issues.html#terraformable-agriculture-boost";

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
  const deltas: Partial<Record<EconomyType, number>> = {};
  const reasons: string[] = [];
  const allBodiesById = new Map(bodies.map((b) => [b.bodyId, b]));

  function boost(economy: EconomyType): void {
    boosted.add(economy);
    deltas[economy] = (deltas[economy] ?? 0) + BOOST_DECREASE_DELTA;
  }
  function decrease(economy: EconomyType): void {
    decreased.add(economy);
    deltas[economy] = (deltas[economy] ?? 0) - BOOST_DECREASE_DELTA;
  }

  const resourceLevel = systemResourceLevel(bodies);
  const organics = hasOrganics(body);
  const geologicals = hasGeologicals(body);
  const volcanism = hasVolcanism(body);
  const tidalDecrease = isTidalLockChainToStar(body, allBodiesById);

  const wants = (economy: EconomyType) => economiesToCheck.includes(economy);

  if (wants("Agriculture")) {
    if (isELW(body)) {
      boost("Agriculture");
      reasons.push("Agriculture boosted: orbiting an Earth-like world");
    }
    // Terraformable's +0.4 Agriculture boost is a real rule per the source tables, but deliberately
    // NOT applied — see TERRAFORMABLE_AGRICULTURE_BUG_NOTE.
    if (organics === true) {
      boost("Agriculture");
      reasons.push("Agriculture boosted: on/orbiting a body with organics");
    } else if (organics === null) {
      reasons.push("Agriculture: organics presence unknown (needs DSS/FSS scan data)");
    }
    if (isIcyBody(body)) {
      decrease("Agriculture");
      reasons.push("Agriculture decreased: on/orbiting an icy body");
    }
    if (tidalDecrease) {
      decrease("Agriculture");
      reasons.push("Agriculture decreased: tidally locked to its star (directly, or via a locked moon chain)");
    }
  }

  if (wants("Extraction")) {
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      boost("Extraction");
      reasons.push("Extraction boosted: system has major/pristine resources");
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      decrease("Extraction");
      reasons.push("Extraction decreased: system has low/depleted resources");
    } else {
      reasons.push("Extraction: system resource level unknown (not derivable from Journal Scan data)");
    }
    if (volcanism === true) {
      boost("Extraction");
      reasons.push("Extraction boosted: on/orbiting a body with volcanism");
    } else if (volcanism === null) {
      reasons.push("Extraction: volcanism presence unknown (needs DSS/FSS scan data)");
    }
  }

  if (wants("HighTech")) {
    if (isAmmoniaWorld(body)) {
      boost("HighTech");
      reasons.push("HighTech boosted: orbiting an ammonia world");
    }
    if (isELW(body)) {
      boost("HighTech");
      reasons.push("HighTech boosted: orbiting an Earth-like world");
    }
    if (geologicals === true) {
      boost("HighTech");
      reasons.push("HighTech boosted: on/orbiting a body with geologicals");
    } else if (geologicals === null) {
      reasons.push("HighTech: geologicals presence unknown (needs DSS/FSS scan data)");
    }
    if (organics === true) {
      boost("HighTech");
      reasons.push("HighTech boosted: on/orbiting a body with organics");
    }
  }

  const industrialRefineryTargets = (["Industrial", "Refinery"] as const).filter(wants);
  if (industrialRefineryTargets.length > 0) {
    const label = industrialRefineryTargets.join("/");
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      for (const t of industrialRefineryTargets) boost(t);
      reasons.push(`${label} boosted: system has major/pristine resources`);
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      for (const t of industrialRefineryTargets) decrease(t);
      reasons.push(`${label} decreased: system has low/depleted resources`);
    } else {
      reasons.push(`${label}: system resource level unknown (not derivable from Journal Scan data)`);
    }
  }

  if (wants("Tourism")) {
    if (isAmmoniaWorld(body)) {
      boost("Tourism");
      reasons.push("Tourism boosted: orbiting an ammonia world");
    }
    if (systemHasBlackHole(bodies)) {
      boost("Tourism");
      reasons.push("Tourism boosted: system has a black hole");
    }
    if (isELW(body)) {
      boost("Tourism");
      reasons.push("Tourism boosted: orbiting an Earth-like world");
    }
    if (geologicals === true) {
      boost("Tourism");
      reasons.push("Tourism boosted: on/orbiting a body with geologicals");
    }
    if (organics === true) {
      boost("Tourism");
      reasons.push("Tourism boosted: on/orbiting a body with organics");
    }
    if (isWaterWorld(body)) {
      boost("Tourism");
      reasons.push("Tourism boosted: orbiting a water world");
    }
    if (systemHasWhiteDwarf(bodies)) {
      boost("Tourism");
      reasons.push("Tourism boosted: system has a white dwarf");
    }
    if (systemHasNeutronStar(bodies)) {
      boost("Tourism");
      reasons.push("Tourism boosted: system has a neutron star");
    }
  }

  return { boosted: Array.from(boosted), decreased: Array.from(decreased), reasons, deltas };
}

/** Community-sourced floor — a boost/decrease stack should never actually zero out or invert an
 * economy's presence (`EconomicEffects.ods` R68: "modifiers stack additively, and result in a
 * minimum final influence of 0.1 if it would become 0 or negative"). */
const ECONOMY_RATIO_FLOOR_PERCENT = 10;

export interface EconomyRatio {
  economy: EconomyType;
  percent: number;
}

/** Each economy type a facility/port carries at all starts at a flat 100% (`EconomicEffects.ods`
 * R30/R91: "the resulting economy is 1", "all Odyssey settlements have 1 in their corresponding
 * economy" — not tier-scaled; the sheet's separate 0.4/0.8/1.2 tier-scaled numbers are about how
 * much a facility *contributes to a linked port*, not its own displayed ratio), then shifted by
 * `computeBoostDecrease`'s per-economy `deltas` (already in the same ±0.4 community-sourced units),
 * floored at `ECONOMY_RATIO_FLOOR_PERCENT`. Deliberately body-driven only, own-economy-only — this
 * function itself never folds in a strong/weak link contribution; `links.ts`'s `computeSystemLinks`
 * is the link-aware caller that does (its `PortEconomyLine.ownPercent` is exactly this function's
 * output for a port's own base economies, with the 0.4/0.8/1.2 tier-scaled numbers this docstring
 * mentions finally applied there, per link, via `getLinkContributionTier`). `economies` is the
 * facility/port's own base set: a port's
 * `computeBodyEconomyOverrides(body).economies` (or `["Colony"]` if empty — ports without an
 * override default to Colony, same convention `LinksPanel.tsx` already uses for display), or a
 * supporting facility's single `FACILITY_ECONOMY_GUESS` entry. Sorted descending by percent, since
 * that's how every real reference (and this function's own tests) present it. */
export function computeEconomyRatios(economies: EconomyType[], body: JournalBody, allBodies: JournalBody[]): EconomyRatio[] {
  const { deltas } = computeBoostDecrease(body, allBodies, economies);
  return economies
    .map((economy) => ({
      economy,
      percent: Math.max(ECONOMY_RATIO_FLOOR_PERCENT, Math.round((1 + (deltas[economy] ?? 0)) * 100)),
    }))
    .sort((a, b) => b.percent - a.percent);
}

/** Matches `data/buildings.ts`'s `EconomyType` union declaration order — used only to give
 * `computeColonyEconomyBreakdown`'s output a stable, predictable order (Extraction before
 * Industrial before Refinery, etc.), not because that order carries any game meaning. */
const ECONOMY_TYPE_ORDER: EconomyType[] = [
  "Agriculture",
  "Extraction",
  "HighTech",
  "Industrial",
  "Refinery",
  "Tourism",
  "Military",
  "Terraforming",
  "Colony",
];

export interface EconomyBreakdownLine {
  /** Positive for a base grant or boost, negative for a decrease — always exactly ±1 (base) or
   * ±`BOOST_DECREASE_DELTA` (boost/decrease), never anything else. */
  amount: number;
  label: string;
}

export interface EconomyBreakdown {
  economy: EconomyType;
  lines: EconomyBreakdownLine[];
}

/** Per-economy labeled contribution list for a hypothetical Colony-type port at this body — the
 * body-level "i" icon in the System facilities tree's "what would a Colony-type port here start
 * with" breakdown, independent of whatever's actually built there (if anything). Deliberately
 * *not* a refactor of `computeBodyEconomyOverrides`/`computeBoostDecrease` (both stay exactly as
 * they are — already shipped, already tested, and `links.ts`/`computeEconomyRatios` already depend
 * on their exact shapes): this reuses the same exported boolean predicates those two functions are
 * themselves built from, just re-sequenced to emit labeled per-economy lines instead of a flat
 * Set/delta. Exactly one base line per economy the Colony-override table grants at all (`+1`,
 * never stacked even if multiple base rules would otherwise match the same economy — R30 of
 * `EconomicEffects.ods`: "does not stack with intrinsic body effects, if both list 1 the resulting
 * economy is 1 in that respect" — first matching rule, in the same order
 * `computeBodyEconomyOverrides` checks them, wins), then the same `±BOOST_DECREASE_DELTA`-per-
 * condition boost/decrease lines `computeBoostDecrease` already applies to that same economy.
 * Labels are short/compact (`Body type: X`, `Body has: X`, `Buff:`/`Debuff: X`), matching the
 * `EconomicEffects.ods`-style wording the user asked for — verified against three of their own
 * worked real-game examples (Extraction/Industrial/Refinery), the rest extrapolated consistently
 * by me for conditions they didn't happen to show; easy to relabel if any read wrong in practice. */
export function computeColonyEconomyBreakdown(body: JournalBody, allBodies: JournalBody[]): EconomyBreakdown[] {
  const allBodiesById = new Map(allBodies.map((b) => [b.bodyId, b]));
  const baseReason = new Map<EconomyType, string>();

  function base(types: EconomyType[], label: string): void {
    for (const t of types) if (!baseReason.has(t)) baseReason.set(t, label);
  }

  // Labels the actual reported star type (e.g. "F", "L", "H") rather than a hardcoded bucket name
  // — "other" covers both brown dwarfs AND every ordinary main-sequence star (per the official
  // "Brown Dwarves and all other star types -> Military" rule), so a fixed "BROWN DWARF/OTHER"
  // label would falsely claim an F-type star is a brown dwarf. Real star type codes for the
  // compact-remnant bucket read oddly raw ("H", "N", "D...") so those three get real names instead.
  const star = starTypeOf(body);
  if (star === "blackhole") {
    base(["HighTech", "Tourism"], "Star type: BLACK HOLE");
  } else if (star === "neutronstar") {
    base(["HighTech", "Tourism"], "Star type: NEUTRON STAR");
  } else if (star === "whitedwarf") {
    base(["HighTech", "Tourism"], "Star type: WHITE DWARF");
  } else if (star === "other") {
    base(["Military"], `Star type: ${body.starType}`);
  }
  if (isELW(body)) base(["Agriculture", "HighTech", "Military", "Tourism"], "Body type: EARTH-LIKE WORLD");
  if (isWaterWorld(body)) base(["Agriculture", "Tourism"], "Body type: WATER WORLD");
  if (isAmmoniaWorld(body)) base(["HighTech", "Tourism"], "Body type: AMMONIA WORLD");
  if (isGasGiant(body)) base(["HighTech", "Industrial"], "Body type: GAS GIANT");
  if (isHighMetalContent(body)) base(["Extraction"], "Body type: HMC/METAL RICH");
  if (isRockyIce(body)) base(["Industrial", "Refinery"], "Body type: ROCKY ICE");
  if (isRockyBody(body)) base(["Refinery"], "Body type: ROCKY");
  if (isIcyBody(body)) base(["Industrial"], "Body type: ICY");
  if (hasRings(body)) base(["Extraction"], "Body has: RINGS");
  if (hasOrganics(body) === true) base(["Agriculture", "Terraforming"], "Body has: BIO");
  if (hasGeologicals(body) === true) base(["Extraction", "Industrial"], "Body has: GEO");

  const lines = new Map<EconomyType, EconomyBreakdownLine[]>();
  for (const [economy, label] of baseReason) lines.set(economy, [{ amount: 1, label }]);

  function add(economy: EconomyType, amount: number, label: string): void {
    lines.get(economy)?.push({ amount, label });
  }
  const has = (economy: EconomyType) => lines.has(economy);

  const resourceLevel = systemResourceLevel(allBodies);
  const organics = hasOrganics(body);
  const geologicals = hasGeologicals(body);
  const volcanism = hasVolcanism(body);
  const tidalDecrease = isTidalLockChainToStar(body, allBodiesById);

  if (has("Agriculture")) {
    if (isELW(body)) add("Agriculture", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
    // Terraformable's +0.4 Agriculture boost is deliberately not applied — see
    // TERRAFORMABLE_AGRICULTURE_BUG_NOTE.
    if (organics === true) add("Agriculture", BOOST_DECREASE_DELTA, "Buff: body has BIO");
    if (isIcyBody(body)) add("Agriculture", -BOOST_DECREASE_DELTA, "Debuff: body is ICY");
    if (tidalDecrease) add("Agriculture", -BOOST_DECREASE_DELTA, "Debuff: TIDALLY LOCKED to star");
  }
  if (has("Extraction")) {
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      add("Extraction", BOOST_DECREASE_DELTA, "Buff: reserveLevel MAJOR or PRISTINE");
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      add("Extraction", -BOOST_DECREASE_DELTA, "Debuff: reserveLevel LOW or DEPLETED");
    }
    if (volcanism === true) add("Extraction", BOOST_DECREASE_DELTA, "Buff: body has VOLCANISM");
  }
  if (has("HighTech")) {
    if (isAmmoniaWorld(body)) add("HighTech", BOOST_DECREASE_DELTA, "Buff: orbiting AMMONIA WORLD");
    if (isELW(body)) add("HighTech", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
    if (geologicals === true) add("HighTech", BOOST_DECREASE_DELTA, "Buff: body has GEO");
    if (organics === true) add("HighTech", BOOST_DECREASE_DELTA, "Buff: body has BIO");
  }
  for (const t of ["Industrial", "Refinery"] as const) {
    if (!has(t)) continue;
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      add(t, BOOST_DECREASE_DELTA, "Buff: reserveLevel MAJOR or PRISTINE");
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      add(t, -BOOST_DECREASE_DELTA, "Debuff: reserveLevel LOW or DEPLETED");
    }
  }
  if (has("Tourism")) {
    if (isAmmoniaWorld(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting AMMONIA WORLD");
    if (systemHasBlackHole(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a BLACK HOLE");
    if (isELW(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
    if (geologicals === true) add("Tourism", BOOST_DECREASE_DELTA, "Buff: body has GEO");
    if (organics === true) add("Tourism", BOOST_DECREASE_DELTA, "Buff: body has BIO");
    if (isWaterWorld(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting WATER WORLD");
    if (systemHasWhiteDwarf(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a WHITE DWARF");
    if (systemHasNeutronStar(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a NEUTRON STAR");
  }

  return Array.from(lines.entries())
    .map(([economy, economyLines]) => ({ economy, lines: economyLines }))
    .sort((a, b) => ECONOMY_TYPE_ORDER.indexOf(a.economy) - ECONOMY_TYPE_ORDER.indexOf(b.economy));
}

/** The six economy types the "Strong Link Modifiers" sheet (`EconomicEffects.ods`) actually lists a
 * row for — Military, Terraforming, and Colony never appear as a strong-link-modifier column/target
 * in that table (or in CLAUDE.md's verbatim boost/decrease table), so they're never evaluated here. */
const STRONG_LINK_ECONOMIES: EconomyType[] = ["Agriculture", "Extraction", "HighTech", "Industrial", "Refinery", "Tourism"];

/** Per-economy labeled strong-link boost/decrease list for a body — the "Strong links" block in the
 * System facilities tree's body "i" icon hover, showing what modifier ANY strong link at this body
 * would receive, for every economy type the modifier table covers (not just the ones this body's
 * own Colony-port would intrinsically carry — see `computeColonyEconomyBreakdown`'s "Default
 * economies" block for that, gated one). A strong link only ever forms port<->facility (never
 * facility<->facility, per CLAUDE.md's link topology rules), and this modifier applies to whichever
 * economy type the linked facility/port on the other end supplies — independent of what economy
 * type(s) a Colony-default port built at THIS body would itself carry. Reuses the same
 * `computeBoostDecrease`-derived condition checks and Buff/Debuff-style labels
 * `computeColonyEconomyBreakdown` already uses, just unconditionally (no "has this economy already"
 * gate) and per-condition rather than collapsed into a single signed delta — deliberately not a
 * shared refactor of that function for the same reason its own header comment gives: both are
 * already shipped/tested with their own exact shapes, and re-sequencing the same boolean predicates
 * for a different presentation is cheaper and safer than merging the two. */
export function computeStrongLinkBreakdown(body: JournalBody, allBodies: JournalBody[]): EconomyBreakdown[] {
  const allBodiesById = new Map(allBodies.map((b) => [b.bodyId, b]));
  const lines = new Map<EconomyType, EconomyBreakdownLine[]>();

  function add(economy: EconomyType, amount: number, label: string): void {
    if (!lines.has(economy)) lines.set(economy, []);
    lines.get(economy)!.push({ amount, label });
  }

  const resourceLevel = systemResourceLevel(allBodies);
  const organics = hasOrganics(body);
  const geologicals = hasGeologicals(body);
  const volcanism = hasVolcanism(body);
  const tidalDecrease = isTidalLockChainToStar(body, allBodiesById);

  if (isELW(body)) add("Agriculture", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
  // Terraformable's +0.4 Agriculture boost is deliberately not applied — see
  // TERRAFORMABLE_AGRICULTURE_BUG_NOTE.
  if (organics === true) add("Agriculture", BOOST_DECREASE_DELTA, "Buff: body has BIO");
  if (isIcyBody(body)) add("Agriculture", -BOOST_DECREASE_DELTA, "Debuff: body is ICY");
  if (tidalDecrease) add("Agriculture", -BOOST_DECREASE_DELTA, "Debuff: TIDALLY LOCKED to star");

  if (resourceLevel === "major" || resourceLevel === "pristine") {
    add("Extraction", BOOST_DECREASE_DELTA, "Buff: reserveLevel MAJOR or PRISTINE");
  } else if (resourceLevel === "low" || resourceLevel === "depleted") {
    add("Extraction", -BOOST_DECREASE_DELTA, "Debuff: reserveLevel LOW or DEPLETED");
  }
  if (volcanism === true) add("Extraction", BOOST_DECREASE_DELTA, "Buff: body has VOLCANISM");

  if (isAmmoniaWorld(body)) add("HighTech", BOOST_DECREASE_DELTA, "Buff: orbiting AMMONIA WORLD");
  if (isELW(body)) add("HighTech", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
  if (geologicals === true) add("HighTech", BOOST_DECREASE_DELTA, "Buff: body has GEO");
  if (organics === true) add("HighTech", BOOST_DECREASE_DELTA, "Buff: body has BIO");

  for (const t of ["Industrial", "Refinery"] as const) {
    if (resourceLevel === "major" || resourceLevel === "pristine") {
      add(t, BOOST_DECREASE_DELTA, "Buff: reserveLevel MAJOR or PRISTINE");
    } else if (resourceLevel === "low" || resourceLevel === "depleted") {
      add(t, -BOOST_DECREASE_DELTA, "Debuff: reserveLevel LOW or DEPLETED");
    }
  }

  if (isAmmoniaWorld(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting AMMONIA WORLD");
  if (systemHasBlackHole(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a BLACK HOLE");
  if (isELW(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting ELW");
  if (geologicals === true) add("Tourism", BOOST_DECREASE_DELTA, "Buff: body has GEO");
  if (organics === true) add("Tourism", BOOST_DECREASE_DELTA, "Buff: body has BIO");
  if (isWaterWorld(body)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: orbiting WATER WORLD");
  if (systemHasWhiteDwarf(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a WHITE DWARF");
  if (systemHasNeutronStar(allBodies)) add("Tourism", BOOST_DECREASE_DELTA, "Buff: system has a NEUTRON STAR");

  return STRONG_LINK_ECONOMIES.filter((economy) => lines.has(economy))
    .map((economy) => ({ economy, lines: lines.get(economy)! }))
    .sort((a, b) => ECONOMY_TYPE_ORDER.indexOf(a.economy) - ECONOMY_TYPE_ORDER.indexOf(b.economy));
}
