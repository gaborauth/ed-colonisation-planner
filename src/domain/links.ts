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
//  - Weak links: between ports on different bodies in the same system. Implemented as one link per
//    direction between each pair of bodies' *representative* (dominant) port — the source's own
//    worked example (a body's facilities/lower-tier port supply a weak link that's created "to the
//    port on Body 2") describes a single link per body pair, not an all-pairs bipartite graph
//    between every individual port/facility across bodies; that's the interpretation used here.
//  - Only strong links get boost/decrease from body characteristics (weak links are unaffected,
//    per the source), evaluated per individual strong link (not once per body) — see the source's
//    own example: "the strong link from the extraction facility to the port will be strengthened
//    while the strong link from the agricultural facility will not," i.e. each source's own
//    economy types are checked independently against the shared body's attributes.

import {
  ALL_BUILDINGS,
  type EconomyType,
  FACILITY_ECONOMY_GUESS,
  getPortTier,
  isPortRole,
} from "../data/buildings";
import { computeBodyEconomyOverrides, computeBoostDecrease } from "./economyOverrides";
import type { JournalBody } from "../journal/parser";

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
 * approximate same-tier tie-break signal (see the header comment on port placement fidelity in
 * the project plan) — it isn't exact per-body build order. */
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

    if (portNames.length === 0) {
      if (facilities.length > 0) {
        warnings.push(
          `${body.bodyName}: has ${facilities.length} facility type(s) but no port — they can't form a strong link here.`,
        );
      }
      continue;
    }

    const groundPorts = portNames.filter((n) => ALL_BUILDINGS[n].slot === "ground");
    const spacePorts = portNames.filter((n) => ALL_BUILDINGS[n].slot === "space");
    const groundDominant = pickDominant(groundPorts, buildOrderHint);
    const spaceDominant = pickDominant(spacePorts, buildOrderHint);

    const bodyOverride = computeBodyEconomyOverrides(body);

    // Record every port present (dominant or not) so the UI can show what exists on this body.
    for (const name of portNames) {
      ports.push({
        building: name,
        bodyId,
        tier: getPortTier(name),
        economies: bodyOverride.economies,
        appliedOverrideRules: bodyOverride.appliedRules,
        unevaluatedOverrideRules: bodyOverride.unevaluatedRules,
        isDominantOnBody: name === groundDominant || name === spaceDominant,
      });
    }

    function addStrongLink(fromBuilding: string, toPortBuilding: string, count: number, economies: EconomyType[]): void {
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
    }

    if (groundDominant && spaceDominant) {
      // Chain case: ground side feeds into the ground port, which forwards into the space port.
      for (const name of groundPorts) {
        if (name === groundDominant) continue;
        addStrongLink(name, groundDominant, 1, bodyOverride.economies);
      }
      for (const f of facilities.filter((p) => ALL_BUILDINGS[p.building].slot === "ground")) {
        addStrongLink(f.building, groundDominant, f.count, FACILITY_ECONOMY_GUESS[f.building] ?? []);
      }
      addStrongLink(groundDominant, spaceDominant, 1, bodyOverride.economies);
      for (const name of spacePorts) {
        if (name === spaceDominant) continue;
        addStrongLink(name, spaceDominant, 1, bodyOverride.economies);
      }
      for (const f of facilities.filter((p) => ALL_BUILDINGS[p.building].slot === "space")) {
        addStrongLink(f.building, spaceDominant, f.count, FACILITY_ECONOMY_GUESS[f.building] ?? []);
      }
      representativePort.set(bodyId, spaceDominant);
    } else {
      const dominant = (groundDominant ?? spaceDominant)!;
      for (const name of portNames) {
        if (name === dominant) continue;
        addStrongLink(name, dominant, 1, bodyOverride.economies);
      }
      for (const f of facilities) {
        addStrongLink(f.building, dominant, f.count, FACILITY_ECONOMY_GUESS[f.building] ?? []);
      }
      representativePort.set(bodyId, dominant);
    }
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

  return { ports, strongLinks, weakLinks, warnings };
}
