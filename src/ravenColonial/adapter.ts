// Overlays a Raven Colonial export's slots + built facilities onto an ALREADY-loaded JournalSystem
// (from a Journal file or Spansh import — this never re-derives body physical data itself).
//
// Fed from a user-uploaded copy of Raven Colonial's own "Export backup" file (JournalImportPanel.tsx),
// not a live call to Raven Colonial's API. Raven Colonial's API endpoint isn't a stable, published
// address to depend on long-term, and — unlike the Spansh import path, where this app's author has
// an arrangement with the CORS proxy operator it depends on — there's no such arrangement with
// Raven Colonial, so this app doesn't make automated calls against that service on a user's behalf.
// The backup export is the same shape as the live API response (see types.ts), so nothing is lost
// by reading it from a file instead.
//
// Deliberately narrow scope: only `slots` and `sites` (built facilities + the primary station) are
// read from the Raven Colonial response — `RcSystem.bodies`' own physical/orbital data (subType,
// gravity, radius, etc.) is never used here, since the system this overlays onto already has that
// from its own import source. A full "import a system directly from Raven Colonial with no prior
// Spansh/Journal step" path would need that data too and isn't implemented.
import type { JournalBody, JournalSystem, PresentFacilitySlot } from "../journal/parser";
import { RC_BUILD_TYPE } from "./buildTypes";
import type { RcSite, RcSystem } from "./types";

export interface RavenColonialOverlayResult {
  system: JournalSystem;
  /** User-facing, non-fatal notices — an unrecognized buildType, a site/slot referencing a body not
   * present in the currently loaded system, etc. Never thrown; the overlay always applies whatever
   * it safely can and reports the rest here instead. */
  warnings: string[];
}

function computeAsteroidSlot(body: JournalBody): number {
  return body.rings.length > 0 ? 1 : 0;
}

/** Raven Colonial's own site list has no separate "is this the primary/claim station" flag — the
 * first `"complete"` entry in `sites[]` is treated as this system's real primary station (skipping
 * over any leading non-complete entry, same status filter every other site gets below — the
 * primary station can't be a not-yet-built plan). Best-effort/unverified beyond the one real system
 * this was checked against — flag this in the UI/warnings if it turns out wrong for a different
 * real export. */
function pickPrimarySite(sites: RcSite[]): RcSite | undefined {
  return sites.find((s) => s.status === "complete");
}

export function applyRavenColonialOverlay(system: JournalSystem, rc: RcSystem): RavenColonialOverlayResult {
  const warnings: string[] = [];
  const bodies = system.bodies.map((b) => ({ ...b })); // shallow per-body copy, overlay writes into these
  const byId = new Map<number, JournalBody>(bodies.map((b) => [b.bodyId, b]));

  // 1. Slots — RC's ground-truth-ish [space, ground] pair (`-1` meaning "not applicable" -> 0), plus
  // asteroid eligibility re-derived from ring presence the same way Journal/Spansh already do it
  // (RC's own tuple has no asteroid count at all). A pre-fill suggestion, not infallible — RC's
  // numbers are manually entered by whoever tracks the project, same as this app's own editable
  // slot fields, and can contain the same kind of human error.
  for (const [numStr, pair] of Object.entries(rc.slots)) {
    const bodyId = Number(numStr);
    const body = byId.get(bodyId);
    if (!body) {
      warnings.push(`Raven Colonial references body #${bodyId}, which isn't in the currently loaded system — skipped.`);
      continue;
    }
    const [space, ground] = pair;
    body.slots = { space: Math.max(space, 0), ground: Math.max(ground, 0), asteroid: computeAsteroidSlot(body) };
  }

  // 2. Primary station — set from pickPrimarySite's result before grouping the rest, so it's never
  // ALSO seated as an ordinary presentFacilities slot. Excludes the found primary specifically
  // (not just the first array entry) — a leading non-complete site is skipped over when picking
  // the primary, and would otherwise still need filtering out of the ordinary-facility pass below.
  let firstStationBuilding = system.firstStationBuilding;
  let firstStationBodyId = system.firstStationBodyId;
  let firstStationVariant = system.firstStationVariant;
  let firstStationCustomName = system.firstStationCustomName;
  const primarySite = pickPrimarySite(rc.sites);
  const remainingSites = primarySite ? rc.sites.filter((s) => s !== primarySite) : rc.sites;
  if (primarySite) {
    const def = RC_BUILD_TYPE[primarySite.buildType];
    if (!def) {
      warnings.push(`Unrecognized Raven Colonial build type "${primarySite.buildType}" for the primary station "${primarySite.name}" — primary station left unchanged.`);
    } else {
      firstStationBuilding = def.building;
      firstStationBodyId = primarySite.bodyNum;
      firstStationCustomName = primarySite.name;
      // Best-effort — see buildTypes.ts's header comment on why RC's buildType doesn't always
      // match the true in-game layout. The old variant (if any) belonged to whatever building was
      // previously the primary, so it's replaced either way, not just cleared.
      firstStationVariant = def.variant;
    }
  }

  // 3. Every other built facility, grouped per (body, slotKind) so each group can be seated into a
  // single padded array below.
  const grouped = new Map<string, RcSite[]>();
  for (const site of remainingSites) {
    if (site.status !== "complete") continue; // no "planned"/in-progress concept in this app
    const def = RC_BUILD_TYPE[site.buildType];
    if (!def) {
      warnings.push(`Unrecognized Raven Colonial build type "${site.buildType}" for "${site.name}" — skipped.`);
      continue;
    }
    const body = byId.get(site.bodyNum);
    if (!body) {
      warnings.push(`"${site.name}" is on body #${site.bodyNum}, which isn't in the currently loaded system — skipped.`);
      continue;
    }
    const key = `${site.bodyNum}:${def.slot}`;
    const list = grouped.get(key) ?? [];
    list.push(site);
    grouped.set(key, list);
  }

  const buildFacilityArray = (sites: RcSite[], capacity: number): (PresentFacilitySlot | null)[] => {
    // A slotKind with no real sites here stays `[]`, even when its own slot count is > 0 (a body
    // with one empty orbital slot alongside several built ground facilities has
    // `presentFacilities.space: []`, not `[null]`); only a slotKind with >= 1 real site gets
    // null-padded up to its full capacity.
    if (sites.length === 0) return [];
    const arr: (PresentFacilitySlot | null)[] = new Array(Math.max(capacity, sites.length)).fill(null);
    sites.forEach((site, i) => {
      const def = RC_BUILD_TYPE[site.buildType]!;
      arr[i] = { building: def.building, demolishable: false, variant: def.variant, customName: site.name };
    });
    return arr;
  };

  for (const body of bodies) {
    const slots = body.slots;
    if (!slots) continue;
    const spaceSites = grouped.get(`${body.bodyId}:space`) ?? [];
    const groundSites = grouped.get(`${body.bodyId}:ground`) ?? [];
    if (spaceSites.length === 0 && groundSites.length === 0) continue;
    body.presentFacilities = {
      // A ringed body's asteroid-eligible capacity is an ADDITIONAL space-array position, not a
      // substitute for its ordinary space slot(s) — a body with slots {space:1, asteroid:1} gets a
      // presentFacilities.space array of length 2, not 1.
      space: buildFacilityArray(spaceSites, slots.space + slots.asteroid),
      ground: buildFacilityArray(groundSites, slots.ground),
    };
  }

  return {
    system: {
      ...system,
      bodies,
      firstStationBuilding,
      firstStationBodyId,
      firstStationVariant,
      firstStationCustomName,
      // Stored verbatim (whatever extra fields the real upload had beyond what `RcSystem` itself
      // types — `v`/`rev`/`architect`/`pos`/etc.) so `ravenColonial/export.ts` can round-trip them
      // back out later. `rc`'s static type only declares `RcSystem`'s narrower field set, but the
      // actual parsed object always carries everything the uploaded file had.
      ravenColonialSkeleton: rc as unknown as Record<string, unknown>,
    },
    warnings,
  };
}
