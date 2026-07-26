// Solved counterpart to presentLinks.ts's present-only computation: link topology for what a
// solved plan actually leaves standing. `SolverResult.placements` (solve.ts) is built purely from
// NEW-build decision variables (`bodyVars`) — every already-present facility is folded into the
// MILP as a plain constant instead, so it never gets its own `bodyVars` entry and never appears in
// `placements` at all (see solve.ts's `placements` construction and its `SolverResult.placements`
// doc comment). Feeding `computeSystemLinks` `result.placements` alone therefore silently drops
// every already-present facility's contribution to the solved system's link topology/economy
// display — a real bug both the standalone Links panel (since removed, 2026-07-26 — its "Links &
// economy" table was judged redundant with the "i" info icons already shown throughout the app) and
// SolvedSystemPanel.tsx had (2026-07-26 user report:
// "already built facilities are not provid[ing] strong nor weak links in the solved system"). This
// module merges `result.placements` with the same present-facilities-to-placements conversion
// `presentLinks.ts` already uses for the present-only case, excluding whatever the solver actually
// demolished (`result.demolished`) — those slots are no longer "present" once a fresh solve says so.

import { toBuildingPlacements, type PresentFacilitiesBody } from "./presentFacilities";
import { computeSystemLinks, type BuildingPlacement, type SystemLinksResult } from "./links";
import type { JournalBody } from "../journal/parser";
import type { SolverResult } from "../solver/solve";

function demolishedKey(bodyId: number, slotKind: "space" | "ground", index: number): string {
  return `${bodyId}:${slotKind}:${index}`;
}

/** `result.placements` (new-build only) plus every already-present facility NOT demolished by this
 * solve, merged into one flat list — `computeSystemLinks` aggregates per (bodyId, building) itself
 * (its per-body strong-link loop sums every matching placement entry it's given, duplicates
 * included), so this doesn't need to dedupe/combine matching entries before returning them. */
export function toSolvedBuildingPlacements(bodies: JournalBody[], result: SolverResult): BuildingPlacement[] {
  const demolished = new Set(result.demolished.map((d) => demolishedKey(d.bodyId, d.slotKind, d.index)));
  const presentBodies: PresentFacilitiesBody[] = bodies.map((b) => ({
    bodyId: b.bodyId,
    space: (b.presentFacilities?.space ?? []).map((slot, index) =>
      demolished.has(demolishedKey(b.bodyId, "space", index)) ? null : slot,
    ),
    ground: (b.presentFacilities?.ground ?? []).map((slot, index) =>
      demolished.has(demolishedKey(b.bodyId, "ground", index)) ? null : slot,
    ),
  }));
  return [...toBuildingPlacements(presentBodies), ...result.placements];
}

/** Link topology for a solved plan's FULL standing layout (already-present, minus demolished, plus
 * newly solved for) — any caller of a solved plan's link topology (currently just
 * SolvedSystemPanel.tsx) should use this instead of calling `computeSystemLinks` with
 * `result.placements` directly. */
export function computeSolvedSystemLinks(bodies: JournalBody[], result: SolverResult): SystemLinksResult {
  return computeSystemLinks(bodies, toSolvedBuildingPlacements(bodies, result), result.portOrder);
}
