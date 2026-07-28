// Update 3 (May 2025) link topology, sourced verbatim from official Frontier patch notes
// (2025-04-27 "Update 3" — see CLAUDE.md for the full source list). Pure post-solve computation:
// given a solved system's building placements (which body each new construction sits on), figures
// out Strong/Weak links and each port's resulting economy types. Mirrors ordering.ts's existing
// precedent of a deterministic layer computed *after* solve() returns — this never touches or is
// touched by the MILP itself (see solve.ts's `SolverBody`/`placements` for the solver side).
//
// Link rules implemented here:
//  - Strong links: between a port and any facility on/around the same body; also between multiple
//    ports on the same body, where the highest-tier port receives the link (ties broken by build
//    order — earlier wins). If a body has both a ground (planetary) and a space (orbital) port,
//    ground-side facilities/ports strong-link to the dominant ground port, which itself strong-
//    links onward to the dominant space port (the space port is the ultimate "top of body" — see
//    `pickBodyRepresentative` below for the inference this requires beyond the literal source
//    text).
//  - Weak links: between ports on different bodies in the same system. The coarse `WeakLink` list
//    (`SystemLinksResult.weakLinks`) is one link per direction between each pair of bodies'
//    *representative* (dominant) port — the source's own worked example (a body's facilities/
//    lower-tier port supply a weak link that's created "to the port on Body 2") describes a single
//    link per body pair, not an all-pairs bipartite graph; that's the interpretation used there.
//    The per-economy accumulation feeding `PortEconomyLine`/`MarketLinkLine` (a user-supplied rule,
//    not from the official patch notes' text, which never gives an exact weak-link number) is
//    richer: every strong-link giver system-wide — INCLUDING a facility on a body with no port at
//    all, which can't strong-link locally but still weak-links elsewhere — contributes a flat 5% (no
//    tier-scaling) to every OTHER body's representative port, EXCEPT the ground->space forwarding
//    hop itself (see `addStrongLink`'s `skipWeakGiver` doc comment) to avoid double-counting a
//    ground-side economy that already reached the system via its own original sources. Confirmed
//    against a real in-game system's exact weak-link counts for two different economies.
//  - Only strong links get boost/decrease from body characteristics (weak links are unaffected,
//    per the source), evaluated per individual strong link (not once per body) — see the source's
//    own example: "the strong link from the extraction facility to the port will be strengthened
//    while the strong link from the agricultural facility will not," i.e. each source's own
//    economy types are checked independently against the shared body's attributes.

import { ALL_BUILDINGS, type EconomyType, getLinkContributionTier, getPortTier, isPortRole } from "../data/buildings";
import {
  computeBodyEconomyOverrides,
  computeBoostDecrease,
  computeEconomyRatios,
  facilityBaseEconomies,
  type OverrideResult,
} from "./economyOverrides";
import type { JournalBody } from "../journal/parser";

/** Community-sourced (`EconomicEffects.ods`'s "Strong Link Modifiers" sheet — see CLAUDE.md's
 * "Explicitly unverified/best-effort constants" section): how much of a linked economy a facility/
 * port contributes to the port it strong-links to, based on ITS OWN `getLinkContributionTier`,
 * *regardless* of what percentage that economy shows on the giving facility itself — confirmed
 * against a user-reported real in-game example (a Military Settlement's own Military value is 100%,
 * unaffected by any boost/decrease rule, but it only contributes 40% Military to a linked port). */
const LINK_TIER_CONTRIBUTION_RATE: Record<1 | 2 | 3, number> = { 1: 0.4, 2: 0.8, 3: 1.2 };

/** Same floor as `economyOverrides.ts`'s `ECONOMY_RATIO_FLOOR_PERCENT` (`EconomicEffects.ods` R68),
 * applied here to a single link's contribution rather than a facility's own displayed ratio —
 * untested against a real decreased-link example, but applying the same documented floor rule
 * consistently seemed better than leaving a link's contribution unfloored while everything else
 * respects it. */
const LINK_CONTRIBUTION_FLOOR = 0.1;

/** User-supplied rule (not from the official patch notes' text, which never gives an exact weak-
 * link number — only "a proportion"): every weak link contributes a flat 5% of an economy,
 * regardless of the giving building's tier or any strong-link boost/decrease (weak links are
 * unaffected by that mechanic per CLAUDE.md's verbatim table — same reason there's no per-body
 * delta added here, unlike `LINK_TIER_CONTRIBUTION_RATE`). */
export const WEAK_LINK_CONTRIBUTION = 0.05;

export interface BuildingPlacement {
  building: string;
  bodyId: number;
  count: number;
}

export interface StrongLink {
  fromBuilding: string;
  toPortBuilding: string;
  bodyId: number; // strong links are always same-body, by definition
  count: number;
  facilityEconomies: EconomyType[];
  boostedEconomies: EconomyType[];
  decreasedEconomies: EconomyType[];
  reasons: string[];
}

export interface WeakLink {
  fromBuilding: string;
  fromBodyId: number;
  toPortBuilding: string;
  toPortBodyId: number;
}

/** One economy type's full breakdown at a port: its own body-driven value (`ownPercent`, exactly
 * what `economyOverrides.ts`'s `computeEconomyRatios` already computes — 0 if this port carries the
 * economy only via a received link, never intrinsically), the summed contribution from every
 * incoming strong link (`strongPercent`, see `LINK_TIER_CONTRIBUTION_RATE` above), the summed
 * contribution from every incoming weak link (`weakPercent`, see `WEAK_LINK_CONTRIBUTION` above —
 * either can be 0 while the other isn't), and their sum (`totalPercent`). */
export interface PortEconomyLine {
  economy: EconomyType;
  ownPercent: number;
  strongPercent: number;
  weakPercent: number;
  totalPercent: number;
}

/** One economy type's strong- vs. weak-link *count* at a port — the "Market links" hover block:
 * how many separate strong-link-giver building instances (`strongCount`) and weak-link-giver
 * building instances (`weakCount`) contribute this economy, not a percentage (unlike
 * `PortEconomyLine` above, which already covers the percentage side of strong+weak). Either can be
 * 0 while the other isn't — a row only exists here at all if at least one of the two is nonzero. */
export interface MarketLinkLine {
  economy: EconomyType;
  strongCount: number;
  weakCount: number;
}

export interface PortSummary {
  building: string;
  bodyId: number;
  tier: 1 | 2 | 3;
  economies: EconomyType[];
  appliedOverrideRules: string[];
  unevaluatedOverrideRules: string[];
  /** False for a lower-tier (or later-built, same-tier) port on a body that also has a higher-
   * priority port — it still exists and still gets strong-linked to the dominant one, but doesn't
   * itself receive facility links or represent the body for weak links. */
  isDominantOnBody: boolean;
  /** Sorted descending by `totalPercent`, same convention `computeEconomyRatios` uses. */
  economyRatios: PortEconomyLine[];
  /** Sorted descending by `strongCount + weakCount`. `weakCount` is only ever nonzero for a body's
   * *representative* port (see `SystemLinksResult`'s header comment) — a non-representative
   * dominant port (the ground side of a ground->space chain) never itself receives a weak link;
   * its own contribution already reaches other bodies indirectly, via the space-dominant port it
   * forwards to. */
  marketLinks: MarketLinkLine[];
}

export interface SystemLinksResult {
  ports: PortSummary[];
  strongLinks: StrongLink[];
  weakLinks: WeakLink[];
  warnings: string[];
}

function pickDominant(names: string[], buildOrderHint: string[]): string | null {
  if (names.length === 0) return null;
  const unique = Array.from(new Set(names));
  unique.sort((a, b) => {
    const tierDiff = getPortTier(b) - getPortTier(a);
    if (tierDiff !== 0) return tierDiff;
    const orderA = buildOrderHint.indexOf(a);
    const orderB = buildOrderHint.indexOf(b);
    const ia = orderA === -1 ? Infinity : orderA;
    const ib = orderB === -1 ? Infinity : orderB;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b); // deterministic last-resort fallback, not a real tiebreak signal
  });
  return unique[0];
}

/** Pure post-solve computation. `placements` should include the first station (folded in by the
 * caller as a `count: 1` entry) if it's meant to participate in links — this function doesn't
 * special-case it. `buildOrderHint` (typically `SolverResult.portOrder`) is used only as an
 * approximate same-tier tie-break signal — the solver doesn't thread body assignment through the
 * port build-sequence index (that would need a `5 port types × slots × N bodies` variable blow-up
 * with heavy MILP symmetry), so this is a display-only approximation, not exact per-body build
 * order. */
export function computeSystemLinks(bodies: JournalBody[], placements: BuildingPlacement[], buildOrderHint: string[]): SystemLinksResult {
  const bodiesById = new Map(bodies.map((b) => [b.bodyId, b]));
  const ports: PortSummary[] = [];
  const strongLinks: StrongLink[] = [];
  const warnings: string[] = [];

  const placementsByBody = new Map<number, BuildingPlacement[]>();
  for (const p of placements) {
    if (p.count <= 0) continue;
    if (!placementsByBody.has(p.bodyId)) placementsByBody.set(p.bodyId, []);
    placementsByBody.get(p.bodyId)!.push(p);
  }

  // bodyId -> the port that represents this body for cross-body weak links.
  const representativePort = new Map<number, string>();

  // Every strong-link giver in the system, collected while the main per-body pass below runs —
  // user-supplied rule: "every facility provides weak links too, like strong links" (system-wide,
  // to every OTHER body's representative port, since a giver already strong-links whatever's
  // dominant on its OWN body — see the weak-contribution pass right after the per-body loop).
  const weakGivers: { fromBodyId: number; count: number; economies: EconomyType[] }[] = [];

  // Per-body state stashed here instead of being pushed straight into `ports`, since a port's final
  // `marketLinks` (which folds in weak-link contributions) can't be computed until EVERY body has
  // been processed — weak links are system-wide, so a body's incoming weak contribution depends on
  // every other body's strong-link givers too.
  const bodyStates: {
    bodyId: number;
    body: JournalBody;
    portNames: string[];
    groundDominant: string | null;
    spaceDominant: string | null;
    bodyOverride: OverrideResult;
    incomingStrongContribution: Map<string, Map<EconomyType, number>>;
    incomingStrongCount: Map<string, Map<EconomyType, number>>;
  }[] = [];

  for (const [bodyId, bodyPlacements] of placementsByBody) {
    const bodyMaybe = bodiesById.get(bodyId);
    if (!bodyMaybe) {
      warnings.push(`Placement references body ${bodyId}, which isn't in the imported body list — skipped.`);
      continue;
    }
    // Rebind to a fresh `const` of the narrowed type — TS doesn't retain narrowing of `bodyMaybe`
    // across the `addStrongLink` function declaration below (a hoisted closure).
    const body: JournalBody = bodyMaybe;

    const portNames = Array.from(new Set(bodyPlacements.filter((p) => isPortRole(p.building)).map((p) => p.building)));
    const facilities = bodyPlacements.filter((p) => !isPortRole(p.building));

    // A body can physically have MULTIPLE instances of the exact same port building type (e.g. two
    // Commercial_Outposts on one body with 2 orbital slots — nothing in solve.ts's per-body slot
    // capacity constraint forbids it, and it's a real scenario the solver produces, not just a
    // present-facilities edge case). `portNames` above already collapses those into a single name
    // for the tie-break/dominance computation below (which only cares about DISTINCT building
    // types), but the true per-name instance COUNT is still needed: only ONE physical instance of a
    // port can ever be dominant/receiving in the real game, so every OTHER instance — including
    // extra instances of the SAME winning building type — must itself behave as its own independent
    // strong-link GIVER into the one true dominant, exactly like a different, losing port type
    // already does. Treating "count > 1 of the identical port name" as if it were one logical port
    // that several physical UI slots could equally claim to be would silently under-count these
    // givers — see `facilityEconomyRatios`/`facilityMarketLinks`'s `isDominantInstance` parameter
    // for the matching per-slot display handling.
    const portCounts = new Map<string, number>();
    for (const p of bodyPlacements) {
      if (!isPortRole(p.building)) continue;
      portCounts.set(p.building, (portCounts.get(p.building) ?? 0) + p.count);
    }

    if (portNames.length === 0) {
      if (facilities.length > 0) {
        warnings.push(
          `${body.bodyName}: has ${facilities.length} facility type(s) but no port — they can't form a strong link here.`,
        );
        // Weak links are system-wide and, per the user's rule, don't require a local port — a
        // facility that can't strong-link (nothing on its own body to strong-link to) still
        // weak-links to every OTHER body's representative port. Confirmed against a real in-game
        // system: 3 port-less bodies' Agricultural settlements (3+1+3 instances) were the system's
        // ONLY Agriculture source at all, and real play showed exactly 7 Agriculture weak links.
        for (const f of facilities) {
          weakGivers.push({ fromBodyId: bodyId, count: f.count, economies: facilityBaseEconomies(f.building, body) });
        }
      }
      continue;
    }

    const groundPorts = portNames.filter((n) => ALL_BUILDINGS[n].slot === "ground");
    const spacePorts = portNames.filter((n) => ALL_BUILDINGS[n].slot === "space");
    const groundDominant = pickDominant(groundPorts, buildOrderHint);
    const spaceDominant = pickDominant(spacePorts, buildOrderHint);

    const bodyOverride = computeBodyEconomyOverrides(body);

    // Port building name -> economy -> summed contribution fraction (e.g. 0.4 = 40%) from every
    // strong link feeding it so far this body. Populated by addStrongLink below; only ever read
    // back for the SAME body's ground->space forwarding hop (accumulatedEconomies) and the final
    // ports.push loop, both of which run after every addStrongLink call for this body has fired.
    const incomingContribution = new Map<string, Map<EconomyType, number>>();
    // Port building name -> economy -> number of distinct strong-link-giver building instances
    // feeding it (the "Market links" table's "Strong link" column — a plain count, not a percentage;
    // see MarketLinkLine's header comment).
    const incomingStrongCount = new Map<string, Map<EconomyType, number>>();

    function addToMap(map: Map<string, Map<EconomyType, number>>, key: string, economy: EconomyType, amount: number): void {
      if (!map.has(key)) map.set(key, new Map());
      const perEconomy = map.get(key)!;
      perEconomy.set(economy, (perEconomy.get(economy) ?? 0) + amount);
    }

    function addContribution(toPortBuilding: string, economy: EconomyType, amount: number): void {
      addToMap(incomingContribution, toPortBuilding, economy, amount);
    }

    /** What `fromBuilding` has itself accumulated on this body — its own base economies, plus
     * whatever it received via its own incoming strong links — the full set that "provides all of
     * them upward" when it in turn strong-links to something else (only relevant for the
     * ground-dominant -> space-dominant forwarding hop below; every OTHER same-side, non-dominant
     * port never receives anything itself — see the CLAUDE.md dominance rule — so it only ever
     * forwards its own base economies, unchanged). */
    function accumulatedEconomies(fromBuilding: string): EconomyType[] {
      const own = facilityBaseEconomies(fromBuilding, body);
      const received = Array.from(incomingContribution.get(fromBuilding)?.keys() ?? []);
      return Array.from(new Set([...own, ...received]));
    }

    /** `skipWeakGiver` is only ever passed for the ground->space forwarding hop below: unlike every
     * OTHER strong link (a facility feeding a dominant port, or a same-side non-dominant port
     * forwarding to the dominant one on its own side — both of which DO also weak-link system-wide,
     * confirmed against a real in-game system's exact weak-link counts), the ground-dominant port
     * forwarding its already-locally-strong-linked economies onward to the space-dominant port
     * doesn't ALSO separately broadcast them as a weak link — the ground side's contribution is
     * already accounted for via whatever fed the ground-dominant port in the first place (its own
     * body-override economies, or its own local facilities' weak links from the port-less-body case
     * above), and double-counting it here (once via this forwarding hop, once via its own original
     * sources) was confirmed to overcount a real system's Refinery weak-link total by exactly the
     * same-side ports' worth. */
    function addStrongLink(
      fromBuilding: string,
      toPortBuilding: string,
      count: number,
      economies: EconomyType[],
      options?: { skipWeakGiver?: boolean },
    ): void {
      const boostDecrease = computeBoostDecrease(body, bodies, economies);
      strongLinks.push({
        fromBuilding,
        toPortBuilding,
        bodyId,
        count,
        facilityEconomies: economies,
        boostedEconomies: boostDecrease.boosted,
        decreasedEconomies: boostDecrease.decreased,
        reasons: boostDecrease.reasons,
      });
      const tier = getLinkContributionTier(fromBuilding);
      for (const economy of economies) {
        const raw = LINK_TIER_CONTRIBUTION_RATE[tier] + (boostDecrease.deltas[economy] ?? 0);
        addContribution(toPortBuilding, economy, Math.max(LINK_CONTRIBUTION_FLOOR, raw) * count);
        addToMap(incomingStrongCount, toPortBuilding, economy, count);
      }
      if (!options?.skipWeakGiver) {
        weakGivers.push({ fromBodyId: bodyId, count, economies });
      }
    }

    /** Every OTHER port instance among `names` (a same-side port name list) feeds `toPort` — the
     * one true dominant instance — as its own independent strong-link giver, using each name's REAL
     * total instance count (`portCounts`), not a flat "1 per distinct name": a losing (non-
     * dominant) port type with 2 physical instances contributes 2 givers, and the WINNING
     * (dominant) type's own extra instances beyond the one dominant instance itself contribute as
     * self-siblings too — see `portCounts`'s doc comment above for why this matters. Only one
     * physical instance per body can ever actually be dominant/receiving; every other instance,
     * including extra copies of the winning type, must show up as its own giver rather than the
     * whole name collapsing into a single nominal giver. */
    function addNonDominantSamePortLinks(names: string[], dominantName: string, toPort: string): void {
      for (const name of names) {
        const count = portCounts.get(name) ?? 1;
        if (name === dominantName) {
          if (count > 1) addStrongLink(name, toPort, count - 1, facilityBaseEconomies(name, body));
          continue;
        }
        addStrongLink(name, toPort, count, facilityBaseEconomies(name, body));
      }
    }

    if (groundDominant && spaceDominant) {
      // Chain case: ground side feeds into the ground port, which forwards into the space port.
      addNonDominantSamePortLinks(groundPorts, groundDominant, groundDominant);
      for (const f of facilities.filter((p) => ALL_BUILDINGS[p.building].slot === "ground")) {
        addStrongLink(f.building, groundDominant, f.count, facilityBaseEconomies(f.building, body));
      }
      addStrongLink(groundDominant, spaceDominant, 1, accumulatedEconomies(groundDominant), { skipWeakGiver: true });
      addNonDominantSamePortLinks(spacePorts, spaceDominant, spaceDominant);
      for (const f of facilities.filter((p) => ALL_BUILDINGS[p.building].slot === "space")) {
        addStrongLink(f.building, spaceDominant, f.count, facilityBaseEconomies(f.building, body));
      }
      representativePort.set(bodyId, spaceDominant);
    } else {
      const dominant = (groundDominant ?? spaceDominant)!;
      addNonDominantSamePortLinks(portNames, dominant, dominant);
      for (const f of facilities) {
        addStrongLink(f.building, dominant, f.count, facilityBaseEconomies(f.building, body));
      }
      representativePort.set(bodyId, dominant);
    }

    bodyStates.push({
      bodyId,
      body,
      portNames,
      groundDominant,
      spaceDominant,
      bodyOverride,
      incomingStrongContribution: incomingContribution,
      incomingStrongCount,
    });
  }

  // Weak links: one per direction between every pair of different bodies that each have a
  // representative port.
  const weakLinks: WeakLink[] = [];
  const representativeEntries = Array.from(representativePort.entries());
  for (const [bodyIdA, portA] of representativeEntries) {
    for (const [bodyIdB, portB] of representativeEntries) {
      if (bodyIdA === bodyIdB) continue;
      weakLinks.push({ fromBuilding: portA, fromBodyId: bodyIdA, toPortBuilding: portB, toPortBodyId: bodyIdB });
    }
  }

  // Weak-contribution pass: every strong-link giver collected above also contributes, at the flat
  // WEAK_LINK_CONTRIBUTION rate (no tier-scaling, no boost/decrease — weak links are unaffected by
  // that mechanic per CLAUDE.md), to every OTHER body's representative port — a giver's own body is
  // excluded since it already reaches its own body's dominant port(s) via the strong link it just
  // formed. Keyed by `${bodyId}:${building}` (not just `building`) since the same building name can
  // be the representative port on several different bodies in the same system.
  const incomingWeakContribution = new Map<string, Map<EconomyType, number>>();
  // Same idea as `incomingStrongCount` above, but for weak-link givers — the "Market links" table's
  // "Weak link" column.
  const incomingWeakCount = new Map<string, Map<EconomyType, number>>();
  function weakKey(bodyId: number, building: string): string {
    return `${bodyId}:${building}`;
  }
  function addToMap(map: Map<string, Map<EconomyType, number>>, key: string, economy: EconomyType, amount: number): void {
    if (!map.has(key)) map.set(key, new Map());
    const perEconomy = map.get(key)!;
    perEconomy.set(economy, (perEconomy.get(economy) ?? 0) + amount);
  }
  for (const giver of weakGivers) {
    for (const [otherBodyId, otherRepresentative] of representativeEntries) {
      if (otherBodyId === giver.fromBodyId) continue;
      const key = weakKey(otherBodyId, otherRepresentative);
      for (const economy of giver.economies) {
        addToMap(incomingWeakContribution, key, economy, WEAK_LINK_CONTRIBUTION * giver.count);
        addToMap(incomingWeakCount, key, economy, giver.count);
      }
    }
  }

  // Record every port present (dominant or not) so the UI can show what exists on this body — only
  // possible now that every body's strong links (for economyRatios) AND every body's weak-link
  // contributions (for marketLinks, which needs every OTHER body's givers already known) are both
  // complete.
  for (const { bodyId, body, portNames, groundDominant, spaceDominant, bodyOverride, incomingStrongContribution, incomingStrongCount } of bodyStates) {
    for (const name of portNames) {
      const own = facilityBaseEconomies(name, body);
      const ownRatios = computeEconomyRatios(own, body, bodies);
      const strongContribution = incomingStrongContribution.get(name) ?? new Map<EconomyType, number>();
      const weakContribution = incomingWeakContribution.get(weakKey(bodyId, name)) ?? new Map<EconomyType, number>();
      const allEconomies = new Set<EconomyType>([...own, ...strongContribution.keys(), ...weakContribution.keys()]);
      const economyRatios: PortEconomyLine[] = Array.from(allEconomies)
        .map((economy) => {
          const ownPercent = ownRatios.find((r) => r.economy === economy)?.percent ?? 0;
          const strongPercent = Math.round((strongContribution.get(economy) ?? 0) * 100);
          const weakPercent = Math.round((weakContribution.get(economy) ?? 0) * 100);
          return { economy, ownPercent, strongPercent, weakPercent, totalPercent: ownPercent + strongPercent + weakPercent };
        })
        .sort((a, b) => b.totalPercent - a.totalPercent);

      const strongCount = incomingStrongCount.get(name) ?? new Map<EconomyType, number>();
      const weakCount = incomingWeakCount.get(weakKey(bodyId, name)) ?? new Map<EconomyType, number>();
      const marketEconomies = new Set<EconomyType>([...strongCount.keys(), ...weakCount.keys()]);
      const marketLinks: MarketLinkLine[] = Array.from(marketEconomies)
        .map((economy) => ({
          economy,
          strongCount: strongCount.get(economy) ?? 0,
          weakCount: weakCount.get(economy) ?? 0,
        }))
        .sort((a, b) => b.strongCount + b.weakCount - (a.strongCount + a.weakCount));

      ports.push({
        building: name,
        bodyId,
        tier: getPortTier(name),
        economies: Array.from(allEconomies),
        appliedOverrideRules: bodyOverride.appliedRules,
        unevaluatedOverrideRules: bodyOverride.unevaluatedRules,
        isDominantOnBody: name === groundDominant || name === spaceDominant,
        economyRatios,
        marketLinks,
      });
    }
  }

  return { ports, strongLinks, weakLinks, warnings };
}
