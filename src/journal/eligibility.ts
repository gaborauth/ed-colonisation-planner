// Best-effort estimate of buildable slots from scanned system data. UNVERIFIED — no official
// formula was locatable (the in-game System Map is the ground truth; official docs/forums block
// automated fetching). This is a starting point to compare against a real system's System Map and
// correct, not a trusted source of truth. Every threshold below is a guess and lives in one place
// (the *_THRESHOLDS constants) so it's cheap to retune once real data comes in — don't scatter
// magic numbers through the estimation logic itself.
//
// Current guesses, and what they're based on:
//  - Orbital slots: one per star/planet in the system. Community reports describe slot counts as
//    scaling with body count ("a larger number of celestial bodies provide more slots overall"),
//    but no per-body formula was found.
//  - Ground slots: one per landable body, scaled up for larger bodies ("larger planets can
//    typically accommodate more surface structures" — again, no exact formula found).
//  - Asteroid slots: one per ring, regardless of ring class. It's unconfirmed whether all ring
//    classes actually support an asteroid base.

import type { JournalBody, JournalSystem } from "./parser";

const GROUND_SLOT_RADIUS_THRESHOLDS = [
  { maxRadiusMeters: 500_000, slots: 1 },
  { maxRadiusMeters: 2_500_000, slots: 2 },
  { maxRadiusMeters: Infinity, slots: 3 },
];

export interface SlotBreakdownEntry {
  bodyName: string;
  space: number;
  ground: number;
  asteroid: number;
  reason: string;
}

export interface SlotEstimate {
  space: number;
  ground: number;
  asteroid: number;
  breakdown: SlotBreakdownEntry[];
}

function groundSlotsForBody(body: JournalBody): number {
  if (!body.landable) return 0;
  const radius = body.radius ?? 0;
  const tier = GROUND_SLOT_RADIUS_THRESHOLDS.find((t) => radius <= t.maxRadiusMeters);
  return tier?.slots ?? 1;
}

export function estimateSlots(system: JournalSystem): SlotEstimate {
  const breakdown: SlotBreakdownEntry[] = [];
  let space = 0;
  let ground = 0;
  let asteroid = 0;

  for (const body of system.bodies) {
    const bodySpace = 1; // one orbital slot per star/planet
    const bodyGround = groundSlotsForBody(body);
    const bodyAsteroid = body.rings.length; // one asteroid slot per ring

    space += bodySpace;
    ground += bodyGround;
    asteroid += bodyAsteroid;

    const reasons: string[] = [`+${bodySpace} orbital (${body.kind})`];
    if (bodyGround > 0) reasons.push(`+${bodyGround} ground (landable)`);
    if (bodyAsteroid > 0) reasons.push(`+${bodyAsteroid} asteroid (${bodyAsteroid} ring(s))`);
    breakdown.push({ bodyName: body.bodyName, space: bodySpace, ground: bodyGround, asteroid: bodyAsteroid, reason: reasons.join(", ") });
  }

  return { space, ground, asteroid, breakdown };
}
