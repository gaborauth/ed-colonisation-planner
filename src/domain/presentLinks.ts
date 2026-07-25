// Pre-solve counterpart to links.ts's post-solve computation: what strong/weak links already exist
// *today*, among the facilities the user has actually marked as built in the System facilities
// panel — as opposed to links.ts's usual caller (LinksPanel.tsx), which feeds it a *solved plan's*
// placements instead. Reuses computeSystemLinks() unmodified; this module is just the present-
// facilities adapter, mirroring how presentFacilities.ts's computePresentPortsSeed is the
// present-facilities adapter for solve.ts's T2/T3 cost curve.

import { computeSystemLinks, type SystemLinksResult } from "./links";
import { presentBuildOrderHint, toBuildingPlacements, type PresentFacilitiesBody } from "./presentFacilities";
import type { JournalBody } from "../journal/parser";

export interface FirstStationPlacement {
  building: string;
  bodyId: number;
}

function toPresentFacilitiesBodies(bodies: JournalBody[]): PresentFacilitiesBody[] {
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    space: b.presentFacilities?.space ?? [],
    ground: b.presentFacilities?.ground ?? [],
  }));
}

/** Link topology for what's actually built today. `firstStation` (optional — pass it once it's
 * both picked and assigned to a body) is folded in as its own `count: 1` placement, mirroring
 * solve.ts's `placements.push({ building: firstStation, bodyId: input.firstStationBodyId, count: 1 })`
 * for the solved case — the primary station isn't itself an entry in any body's `presentFacilities`
 * (see journal/parser.ts's `JournalBody.presentFacilities` doc comment), so without this it would
 * silently drop out of the link graph entirely. */
export function computePresentSystemLinks(bodies: JournalBody[], firstStation?: FirstStationPlacement): SystemLinksResult {
  const presentBodies = toPresentFacilitiesBodies(bodies);
  const placements = toBuildingPlacements(presentBodies);
  if (firstStation) placements.push({ building: firstStation.building, bodyId: firstStation.bodyId, count: 1 });
  const buildOrderHint = presentBuildOrderHint(presentBodies);
  return computeSystemLinks(bodies, placements, buildOrderHint);
}

export interface StrongLinkedInstance {
  building: string;
  nickname: string | undefined;
}

/** Resolves a queried port's incoming strong links (from `computePresentSystemLinks`'s result) down
 * to individual nicknamed facility instances, for display (the "Strong market link(s)" hover
 * section) — `links.ts`'s own `StrongLink` only carries an aggregated `{fromBuilding, count}` per
 * building type, not per-instance identity. Safe to pair the aggregated `count` with "the first
 * `count` instances of that building type found on this body": within one body, every instance of a
 * given supporting-facility type link-targets the same dominant port (see links.ts's
 * `addStrongLink(f.building, dominant, f.count, ...)`, which treats a building type uniformly per
 * body — it never strong-links some instances one way and others another), so which particular
 * instances get matched up doesn't affect correctness, only which nickname lands on which output
 * row (irrelevant, since all `count` instances are equally "linked").
 *
 * Known limitation: if the primary/claim station itself is a *non-dominant* port on a body that
 * also has a higher-(or equal-)tier port (rare — the claim station is normally the first thing
 * built in a system, so it usually wins tier/build-order ties per `links.ts`'s dominance rule), its
 * strong link to the dominant port won't resolve to a nickname here, since it's never an entry in
 * any body's `presentFacilities` (tracked separately — see `computePresentSystemLinks`). Not
 * special-cased; same spirit as `links.ts`'s own documented port-placement-fidelity approximations. */
export function strongLinkedInstances(
  linksResult: SystemLinksResult,
  body: JournalBody,
  portBuilding: string,
): StrongLinkedInstance[] {
  const instances: StrongLinkedInstance[] = [];
  for (const link of linksResult.strongLinks) {
    if (link.bodyId !== body.bodyId || link.toPortBuilding !== portBuilding) continue;
    const matches = [...(body.presentFacilities?.space ?? []), ...(body.presentFacilities?.ground ?? [])].filter(
      (slot) => slot?.building === link.fromBuilding,
    );
    for (const slot of matches.slice(0, link.count)) {
      instances.push({ building: link.fromBuilding, nickname: slot?.customName });
    }
  }
  return instances;
}
