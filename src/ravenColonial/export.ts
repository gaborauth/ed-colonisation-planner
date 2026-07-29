// Turns a solved plan's newly-proposed builds into a Raven Colonial-importable "Export backup" JSON
// — the opposite direction of adapter.ts's applyRavenColonialOverlay. Takes the per-slot placements
// `domain/solvedPlacement.ts`'s `computeSolvedPlacements` already computes (SolvedSystemPanel.tsx
// calls it once per render and can pass the same result here) rather than recomputing anything from
// a SolverResult itself — this module only needs to know the final per-slot status, not the solve.
//
// Deliberately narrow, mirroring applyRavenColonialOverlay's own scope:
// - Only ADDS new "plan" sites, derived from `"new"`/`"demolished-rebuilt"` slots (both represent a
//   real building the solver wants constructed that doesn't exist yet). Every existing entry in
//   `skeleton.sites` is carried through completely untouched — a solver-proposed DEMOLITION of an
//   already-`"complete"` site has no representation here at all: Raven Colonial's own `status`
//   vocabulary for "to be demolished" isn't confirmed anywhere this project has sourced, so this is
//   a known, documented gap rather than a guess.
// - `skeleton`'s other fields (`v`, `rev`, `id64`, `architect`, `pos`, `bodies`, `reserveLevel`,
//   `deleteIDs`, `updateIDs`, `pop`, `open`, `savedNames`, `idxCalcLimit`) are carried through
//   verbatim, unbumped — in particular `rev` is NOT incremented; whether Raven Colonial expects that
//   on a re-import isn't verified either way.
// - The one exception: `slots` is regenerated from this app's OWN current per-body
//   `slots.space`/`.ground` (the inverse of what applyRavenColonialOverlay already does on import),
//   for every body already present in `skeleton.slots` — so slot-count edits made in-app since the
//   last Raven Colonial import round-trip correctly instead of silently re-exporting stale counts.
//   Bodies not already tracked in `skeleton.slots` are left alone (out of scope — this never adds a
//   body Raven Colonial doesn't already know about).
import { toPrintable } from "../data/buildings";
import type { SolvedBodySlots } from "../domain/solvedPlacement";
import type { JournalBody } from "../journal/parser";
import { reverseRcBuildType } from "./buildTypes";
import type { RcSite, RcSystemSkeleton } from "./types";

export interface RavenColonialExportResult {
  json: RcSystemSkeleton;
  /** User-facing, non-fatal notices — e.g. a solved building with no known Raven Colonial buildType
   * (shouldn't happen in practice, `RC_BUILD_TYPE` covers all 54 buildings, but never thrown; that
   * one site is just skipped instead). */
  warnings: string[];
}

interface PlannedSite {
  bodyId: number;
  building: string;
  order: number;
}

/** Flattens every `"new"`/`"demolished-rebuilt"` slot across all bodies into one list, sorted by
 * build order — so the generated site ids/names come out in the same order the Build order table
 * already shows the user, rather than in arbitrary per-body iteration order. */
function collectPlannedSites(bodies: JournalBody[], byBody: Map<number, SolvedBodySlots>): PlannedSite[] {
  const out: PlannedSite[] = [];
  for (const body of bodies) {
    const slots = byBody.get(body.bodyId);
    if (!slots) continue;
    for (const slot of [...slots.space, ...slots.ground]) {
      if (slot.status === "new" || slot.status === "demolished-rebuilt") {
        out.push({ bodyId: body.bodyId, building: slot.building, order: slot.order });
      }
    }
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Refreshes `skeleton.slots`' `[space, ground]` pairs from this app's own current per-body slot
 * counts, for every body already tracked there — mirrors `adapter.ts`'s `computeAsteroidSlot`
 * asymmetry in reverse: Raven Colonial's own tuple has no asteroid count at all, so that field is
 * dropped here the same way it's re-derived (not read) on import. */
function refreshedSlots(skeleton: RcSystemSkeleton, bodies: JournalBody[]): Record<string, [number, number]> {
  const byBodyId = new Map(bodies.map((b) => [b.bodyId, b]));
  const slots: Record<string, [number, number]> = { ...skeleton.slots };
  for (const numStr of Object.keys(skeleton.slots)) {
    const body = byBodyId.get(Number(numStr));
    if (!body?.slots) continue;
    slots[numStr] = [body.slots.space, body.slots.ground];
  }
  return slots;
}

export function buildRavenColonialExport(
  skeleton: RcSystemSkeleton,
  bodies: JournalBody[],
  byBody: Map<number, SolvedBodySlots>,
): RavenColonialExportResult {
  const warnings: string[] = [];
  const planned = collectPlannedSites(bodies, byBody);

  // Timestamp-based synthetic ids, matching Raven Colonial's own convention for a manually-added
  // plan site (e.g. "x1785299983843") — offset per site so two sites created in the same export
  // never collide.
  const baseTimestamp = Date.now();
  const newSites: RcSite[] = [];
  planned.forEach((site, i) => {
    const buildType = reverseRcBuildType(site.building, undefined);
    if (!buildType) {
      warnings.push(`No known Raven Colonial build type for "${toPrintable(site.building)}" — skipped.`);
      return;
    }
    newSites.push({
      id: `x${baseTimestamp + i}`,
      // Cosmetic placeholder, same treatment `variant`/`customName` already get elsewhere in this
      // app — freely renamable in Raven Colonial afterward, never read back by this app itself.
      name: `${toPrintable(site.building)} (planned)`,
      bodyNum: site.bodyId,
      buildType,
      status: "plan",
    });
  });

  return {
    json: {
      ...skeleton,
      sites: [...skeleton.sites, ...newSites],
      slots: refreshedSlots(skeleton, bodies),
    },
    warnings,
  };
}
