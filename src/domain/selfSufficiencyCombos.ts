// "Self-sufficiency" heuristic (ObjectivePanel.tsx's own foldable sub-section) — user-supplied, not
// sourced from an official table or the community spreadsheets the rest of this codebase's economy
// modeling draws from (see CLAUDE.md's "Explicitly unverified/best-effort constants" section for the
// sibling precedent this follows). The idea: one Civilian Planetary Outpost ("Commodity Hub") and
// one Scientific Planetary Outpost + Refinery Hubs ("Manufacturing Hub"), each placed on a suitable
// untouched body, are claimed to cover most of the commodities a colonization project needs, so
// every cargo run can stay inside the same system instead of jumping out for supplies. This module
// only encodes the BODY-ELIGIBILITY/RECIPE side of that claim — it has no idea whether a body's
// economy actually yields the specific commodities in-game (this app has no commodity-level
// modeling at all, see README's "Known limitations"); it only knows the two ports' EconomyType per
// data/buildings.ts (Civilian_Planetary_Outpost: body-derived Colony, Scientific_Planetary_Outpost:
// fixed HighTech).
//
// Both Refinery Hub counts below (2 for the High Metal Content "commodityHub" case, 4 for either
// body type's "manufacturingHub" case) are the user's own in-game observation ("usually"), not a
// verbatim number — flagged the same way as this file's siblings so they're easy to correct once
// better data shows up.
//
// A checked goal is enforced as a lower-bound MILP constraint (`SolverInput.forcedBodyBuildings`,
// consumed in solve.ts), NOT by injecting a present facility into
// `PlannerFormState.bodies[].presentFacilities`: the combo needs to pay real construction cost/T2/T3
// points and show up in the solved plan's build order as an ordinary planned build, not look
// already-built (which would also wrongly inflate the "Actual facilities" panel's current T2/T3
// totals for something that isn't standing infrastructure yet).

import { isHighMetalContent, isRockyBody, hasOrganics, hasGeologicals, isTerraformable } from "./economyOverrides";
import type { JournalBody } from "../journal/parser";

export type SelfSufficiencyCombo = "commodityHub" | "manufacturingHub";

export const ALL_SELF_SUFFICIENCY_COMBOS: SelfSufficiencyCombo[] = ["commodityHub", "manufacturingHub"];

export const SELF_SUFFICIENCY_COMBO_LABELS: Record<SelfSufficiencyCombo, string> = {
  commodityHub: "Commodity Hub",
  manufacturingHub: "Manufacturing Hub",
};

export const SELF_SUFFICIENCY_COMBO_DESCRIPTIONS: Record<SelfSufficiencyCombo, string> = {
  commodityHub: "Maximizes local production of essential colonization commodities and CMM Composite.",
  manufacturingHub: "Maximizes refinery capacity and high-tech manufacturing for self-sufficiency.",
};

// Shown as a hover tooltip over each combo's checkbox — spells out `comboRecipeForBody`'s actual
// eligibility rule (body type + cleanliness + ground-slot count) in plain terms, since the
// checkbox row itself only ever shows a bare eligible-body count, not why a body does or doesn't
// qualify.
export const SELF_SUFFICIENCY_COMBO_ELIGIBILITY_HINTS: Record<SelfSufficiencyCombo, string> = {
  commodityHub:
    "Needs an untouched body that's either High Metal Content (3 free ground slots) or Rocky with no organics, " +
    "no geologicals, and not terraformable (1 free ground slot).",
  manufacturingHub:
    "Needs an untouched body that's either High Metal Content or Rocky with no organics, no geologicals, and not " +
    "terraformable — 5 free ground slots either way.",
};

export const REFINERY_HUB_BUILDING = "Refinery_Hub";

export interface ComboRecipe {
  outpostBuilding: string;
  refineryHubCount: number;
}

export interface EligibleBody {
  body: JournalBody;
  recipe: ComboRecipe;
  groundSlotsNeeded: number;
}

/** One (building, body, count) MILP lower bound — see `solve.ts`'s `SolverInput.forcedBodyBuildings`
 * for how this gets enforced. */
export interface ForcedBodyBuilding {
  bodyId: number;
  building: string;
  count: number;
}

/** No bio signals, no geo signals (both confirmed absent, not merely unknown), and not
 * terraformable — matches this file's "confidently false, not guessed" precedent elsewhere in
 * economyOverrides.ts: an unscanned body is treated as ineligible rather than optimistically clean. */
function isCleanBody(body: JournalBody): boolean {
  return hasOrganics(body) === false && hasGeologicals(body) === false && !isTerraformable(body);
}

/** Null when `body` doesn't match either eligible body type for `combo` at all (independent of slot
 * capacity — see `eligibleBodiesForCombo` for the capacity check). High Metal Content is eligible
 * unconditionally (per the user's own combo definition); a Rocky body additionally needs
 * `isCleanBody`. */
export function comboRecipeForBody(combo: SelfSufficiencyCombo, body: JournalBody): ComboRecipe | null {
  const hmc = isHighMetalContent(body);
  const rockyClean = isRockyBody(body) && isCleanBody(body);
  if (!hmc && !rockyClean) return null;
  if (combo === "commodityHub") {
    return { outpostBuilding: "Civilian_Planetary_Outpost", refineryHubCount: hmc ? 2 : 0 };
  }
  return { outpostBuilding: "Scientific_Planetary_Outpost", refineryHubCount: 4 };
}

/** No facility (built or primary-station-reserved) anywhere on this body's orbital or ground
 * slots — a combo only ever targets a genuinely untouched body. */
export function isBodyUntouched(body: JournalBody): boolean {
  const space = body.presentFacilities?.space ?? [];
  const ground = body.presentFacilities?.ground ?? [];
  return space.every((s) => s == null) && ground.every((s) => s == null);
}

/** Every body eligible for `combo`: untouched, body-type-matched, and with enough ground slots to
 * fit the outpost plus its Refinery Hubs. */
export function eligibleBodiesForCombo(combo: SelfSufficiencyCombo, bodies: JournalBody[]): EligibleBody[] {
  const out: EligibleBody[] = [];
  for (const body of bodies) {
    if (!isBodyUntouched(body)) continue;
    const recipe = comboRecipeForBody(combo, body);
    if (!recipe) continue;
    const groundSlotsNeeded = 1 + recipe.refineryHubCount;
    if ((body.slots?.ground ?? 0) < groundSlotsNeeded) continue;
    out.push({ body, recipe, groundSlotsNeeded });
  }
  return out;
}

/** Best-fit bin-packing pick among `eligibleBodiesForCombo`'s results: the body with the fewest
 * ground slots that still fits the combo, so a larger body is left free for other use. Ties keep
 * `bodies`' own array order. Null when no body currently qualifies. */
export function pickBestFitBody(combo: SelfSufficiencyCombo, bodies: JournalBody[]): EligibleBody | null {
  const eligible = eligibleBodiesForCombo(combo, bodies);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, cur) => ((cur.body.slots?.ground ?? 0) < (best.body.slots?.ground ?? 0) ? cur : best));
}

/** Translates a checked "I want a Commodity/Manufacturing Hub" goal into MILP lower-bound entries
 * for `SolverInput.forcedBodyBuildings`: picks the current best-fit eligible body (recomputed fresh
 * against `bodies` every call, not a body chosen once and stored — a standing goal, not a one-time
 * placement) and forces its outpost plus any Refinery Hubs. Empty when no body currently qualifies
 * (the goal is silently a no-op rather than erroring — same degrade-gracefully precedent as this
 * app's other optional solver inputs). */
export function forcedBuildingsForCombo(combo: SelfSufficiencyCombo, bodies: JournalBody[]): ForcedBodyBuilding[] {
  const best = pickBestFitBody(combo, bodies);
  if (!best) return [];
  const { body, recipe } = best;
  const forced: ForcedBodyBuilding[] = [{ bodyId: body.bodyId, building: recipe.outpostBuilding, count: 1 }];
  if (recipe.refineryHubCount > 0) {
    forced.push({ bodyId: body.bodyId, building: REFINERY_HUB_BUILDING, count: recipe.refineryHubCount });
  }
  return forced;
}

/** Every `ForcedBodyBuilding` entry for every currently-checked goal — feeds
 * `SolverInput.forcedBodyBuildings` directly. */
export function checkedForcedBuildings(
  goals: Partial<Record<SelfSufficiencyCombo, boolean>>,
  bodies: JournalBody[],
): ForcedBodyBuilding[] {
  return ALL_SELF_SUFFICIENCY_COMBOS.filter((combo) => goals[combo]).flatMap((combo) =>
    forcedBuildingsForCombo(combo, bodies),
  );
}

/** Which building names and which body IDs are involved in any currently-checked goal — feeds
 * `domain/ordering.ts`'s `computeFeasibleOrder`/`getOrderingFromResult` (`priorityBuildings`) and
 * `domain/solvedPlacement.ts`'s `computeSolvedPlacements` (`priorityBodyIds`) so a forced combo's
 * build-order NUMBERS land as early as possible, not wherever the generic tier/alphabetical-body
 * ordering would otherwise put them (the player wants these supporting the system from the very
 * start, e.g. CMM Composite/metals for everything else being built). Building-name priority alone
 * isn't enough on its own: `computeFeasibleOrder` has no body concept (it only orders building
 * NAMES, e.g. "Refinery_Hub" as one pooled count across every body that gets one), so without also
 * prioritizing the target body's own traversal order in `computeSolvedPlacements`, an
 * earlier-alphabetically body with its own unrelated Refinery_Hub build could claim the
 * early-numbered slots instead of the actual forced one. */
export function computeForcedBuildingPriority(
  goals: Partial<Record<SelfSufficiencyCombo, boolean>>,
  bodies: JournalBody[],
): { buildingNames: Set<string>; bodyIds: Set<number> } {
  const forced = checkedForcedBuildings(goals, bodies);
  return {
    buildingNames: new Set(forced.map((f) => f.building)),
    bodyIds: new Set(forced.map((f) => f.bodyId)),
  };
}
