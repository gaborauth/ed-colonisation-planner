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
//    overall. Geological signals (which also add 1, up to that same cap of 7) aren't modeled here:
//    that data comes from the SAASignalsFound/FSSBodySignals events, which requires the body to
//    have been DSS/FSS-scanned and which this parser doesn't currently ingest (only Scan events) —
//    so a geo-active body's guess may undercount by 1 versus the in-game System Map.
//  - Asteroid eligibility: an Asteroid_Base is built on an ordinary orbital slot (see
//    `buildings.ts`'s `Asteroid_Base` row — its `slot` is "space"), not a separate slot pool. The
//    "asteroid" value here is a per-body yes/no: does this body have a ring (or, unconfirmed, does
//    its star have an asteroid belt) that unlocks building one there at all. It's unconfirmed
//    whether all ring classes actually support an asteroid base, and whether multiple rings on one
//    body unlock more than one. (Community reports also describe a since-believed-patched bug where
//    ringed/belted bodies could gain 10+ extra "free" orbital slots — still observable in systems
//    built before the fix, but too unreliable to bake into the default guess.)

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

  return Math.min(slots, GROUND_SLOT_MAX);
}

export function estimateBodySlots(body: JournalBody): BodySlotEstimate {
  const space = 1; // one orbital slot per star/planet
  const ground = groundSlotsForBody(body);
  const asteroid = body.rings.length > 0 ? 1 : 0; // eligible (1) if this body has a ring, else 0

  const reasons: string[] = [`+${space} orbital (${body.kind})`];
  if (ground > 0) reasons.push(`+${ground} ground (landable, under temp/gravity caps)`);
  else if (body.landable) reasons.push("+0 ground (too hot or too much gravity)");
  if (asteroid > 0) reasons.push(`asteroid base eligible (${body.rings.length} ring(s))`);

  return { slots: { space, ground, asteroid }, reason: reasons.join(", ") };
}
