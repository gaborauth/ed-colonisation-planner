// Pre-solve counterpart to links.ts's post-solve computation: what strong/weak links already exist
// *today*, among the facilities the user has actually marked as built in the System facilities
// panel — as opposed to solvedLinks.ts's computeSolvedSystemLinks, which feeds computeSystemLinks a
// *solved plan's* placements instead. Reuses computeSystemLinks() unmodified; this module is just
// the present-facilities adapter, mirroring how presentFacilities.ts's computePresentPortsSeed is
// the present-facilities adapter for solve.ts's T2/T3 cost curve.

import { computeSystemLinks, type SystemLinksResult } from "./links";
import { presentBuildOrderHint, toBuildingPlacements, type PresentFacilitiesBody } from "./presentFacilities";
import type { JournalBody } from "../journal/parser";

function toPresentFacilitiesBodies(bodies: JournalBody[]): PresentFacilitiesBody[] {
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    space: b.presentFacilities?.space ?? [],
    ground: b.presentFacilities?.ground ?? [],
  }));
}

/** Link topology for what's actually built today. The primary station folds in via its own real,
 * synced `presentFacilities` entry (`PresentFacilitySlot.primary` — see that field's doc comment),
 * which `toBuildingPlacements` already includes — no separate parameter needed here. */
export function computePresentSystemLinks(bodies: JournalBody[]): SystemLinksResult {
  const presentBodies = toPresentFacilitiesBodies(bodies);
  const placements = toBuildingPlacements(presentBodies);
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
 * The primary/claim station resolves correctly here too, even as a non-dominant port on a body
 * with a higher-tier port: since it's a real, nicknamed `presentFacilities` entry like any other
 * (`PresentFacilitySlot.primary`), this function's existing generic matching handles it with no
 * special-casing needed. */
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
