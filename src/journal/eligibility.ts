// Best-effort per-body slot guess, used only to pre-fill JournalImportPanel's manual slot inputs.
// UNVERIFIED — the Journal doesn't report real slot counts at all, so this is a starting point for
// the user to compare against their in-game System Map and correct, never a value to trust as-is.
//
// Current guesses, and what they're based on:
//  - Orbital slots: one per star/planet in the system. Community reports describe slot counts as
//    scaling with body count ("a larger number of celestial bodies provide more slots overall"),
//    but no per-body formula was found. The vast majority of bodies apparently have 0-3 space
//    slots (4 if the first station is built on that body), so "1" is a floor, not a ceiling — the
//    user is expected to raise it per body from their System Map.
//  - Ground slots: sourced from community research (CMDR Nyatto, Flynnvali, and others; see also
//    the Raven Colonial tool for the most up-to-date version of this algorithm). A body gets ground
//    slots only if its surface temperature is under 700K and its gravity is under 2.7g. The base
//    count comes from radius (<1500km = 1, <3750km = 2, <6000km = 3, >=6000km = 4), then atmosphere
//    adds 2, terraformability adds 1, and being a High Metal Content body adds 1, capped at 7
//    overall. Geological signals also add 1 (up to that same cap of 7), from the Journal's
//    `FSSBodySignals` event (an ordinary FSS/"honk" scan, no DSS needed — see
//    `journal/parser.ts`'s `hasGeologicalSignals`); still undercounts by 1 versus the in-game
//    System Map if that body was never FSS-signal-scanned (the flag stays `undefined`, not `false`,
//    in that case — see JournalImportPanel's "Geo signals" checkbox to correct it manually).
//  - Asteroid eligibility: an Asteroid_Base is built on an ordinary orbital slot (see
//    `buildings.ts`'s `Asteroid_Base` row — its `slot` is "space"), not a separate slot pool — EXCEPT
//    for a STAR's own belt, which (user-confirmed in-game via a real screenshot, 2026-07-27) is its
//    own separate, dedicated constructible location, far from the star itself, modeled as its own
//    synthetic `JournalBody` with `kind: "ring"` (see `journal/parser.ts`'s `withRingBodies`, applied
//    by both the Journal and Spansh import paths) — a star's OWN slot(s) are never themselves
//    asteroid-eligible. A planet's or moon's own ring is different (still unconfirmed whether all
//    ring classes support this, and whether multiple rings unlock more than one Asteroid_Base) — it
//    keeps making that PLANET's/moon's own orbital slot(s) asteroid-eligible directly, same as this
//    app's original (pre-2026-07-27) behavior, since a planet's ring sits at the planet rather than
//    being its own separate far-away location. (Community reports also describe a
//    since-believed-patched bug where ringed/belted bodies could gain 10+ extra "free" orbital
//    slots — still observable in systems built before the fix, but too unreliable to bake into the
//    default guess.)

import type { SlotKind } from "../data/buildings";
import type { JournalBody } from "./parser";

const GROUND_SLOT_RADIUS_THRESHOLDS = [
  { maxRadiusMeters: 1_500_000, slots: 1 },
  { maxRadiusMeters: 3_750_000, slots: 2 },
  { maxRadiusMeters: 6_000_000, slots: 3 },
  { maxRadiusMeters: Infinity, slots: 4 },
];

const GROUND_SLOT_MAX = 7;
const GROUND_SLOT_MAX_TEMPERATURE_K = 700;
const GROUND_SLOT_MAX_GRAVITY_G = 2.7;

export interface BodySlotEstimate {
  slots: Record<SlotKind, number>;
  reason: string;
}

function isHighMetalContent(body: JournalBody): boolean {
  return body.planetClass?.toLowerCase().includes("high metal content") ?? false;
}

function groundSlotsForBody(body: JournalBody): number {
  if (!body.landable) return 0;
  const temperature = body.surfaceTemperature ?? 0;
  const gravity = body.surfaceGravity ?? 0;
  if (temperature >= GROUND_SLOT_MAX_TEMPERATURE_K || gravity >= GROUND_SLOT_MAX_GRAVITY_G) return 0;

  const radius = body.radius ?? 0;
  const tier = GROUND_SLOT_RADIUS_THRESHOLDS.find((t) => radius < t.maxRadiusMeters);
  let slots = tier?.slots ?? 1;

  if (body.atmosphere) slots += 2;
  if (body.terraformState) slots += 1;
  if (isHighMetalContent(body)) slots += 1;
  if (body.hasGeologicalSignals) slots += 1;

  return Math.min(slots, GROUND_SLOT_MAX);
}

export function estimateBodySlots(body: JournalBody): BodySlotEstimate {
  // A synthetic star-belt body (see this file's header comment + `journal/parser.ts`'s
  // `withRingBodies`) is its own dedicated, always-asteroid-eligible orbital slot — no ground slots,
  // no further formula.
  if (body.kind === "ring") {
    return { slots: { space: 1, ground: 0, asteroid: 1 }, reason: "+1 orbital (ring/belt), asteroid base eligible" };
  }

  const space = 1; // one orbital slot per star/planet
  const ground = groundSlotsForBody(body);
  // A star's own slot is never itself asteroid-eligible (its belts are separate "ring" bodies
  // instead — see above); a planet's/moon's own ring keeps making ITS OWN slot eligible directly.
  const asteroid = body.kind === "planet" && body.rings.length > 0 ? 1 : 0;

  const reasons: string[] = [`+${space} orbital (${body.kind})`];
  if (ground > 0) reasons.push(`+${ground} ground (landable, under temp/gravity caps)`);
  else if (body.landable) reasons.push("+0 ground (too hot or too much gravity)");
  if (asteroid > 0) reasons.push(`asteroid base eligible (${body.rings.length} ring(s))`);

  return { slots: { space, ground, asteroid }, reason: reasons.join(", ") };
}
