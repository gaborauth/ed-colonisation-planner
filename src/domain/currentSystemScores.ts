// The CURRENT (not-yet-solved) system's score totals — "what does this system actually add up to
// right now," for the "Actual facilities in the system" panel's summary (moved there from the
// standalone Result panel, 2026-07-26, at the user's request: "I want to see the actual sum of
// values of the system"). Mirrors solve.ts's own systemScores computation (same
// FIRST_STATION_BONUS/SUBSEQUENT_FACILITY_REDUCTION reweighting — a real, always-applicable Dodec
// Update game rule, not something specific to the solver's own optimization), but as a plain-number
// sum over already-present facilities instead of an LP expression over decision variables — there's
// nothing to optimize for a fixed, already-built system, so no MILP is needed here at all.
//
// Deliberately excludes `economy_synergy`: that score only exists as a *placement-preference*
// signal solve.ts computes for candidate NEW construction (see solve.ts's header comment) — it was
// never meant to describe a static, already-built layout, and reproducing its port-aware logic here
// would just be re-deriving a chunk of solve.ts for a number with no real in-game meaning outside a
// solve. Always exactly 0 here, same "not meaningful without a solve" spirit as `SolvedSystemPanel`
// only ever getting a real value from an actual `SolverResult`.

import {
  ALL_BUILDINGS,
  ALL_SCORES,
  BASE_SCORES,
  computeCompoundScore,
  FIRST_STATION_BONUS,
  SUBSEQUENT_FACILITY_REDUCTION,
  type BaseScore,
  type Score,
} from "../data/buildings";

/** `presentCounts`: building name -> count, EXCLUDING the primary/claim station (its own
 * contribution is computed separately below, since it needs its bonus split out from everyone
 * else's reduction — see `FIRST_STATION_BONUS`/`SUBSEQUENT_FACILITY_REDUCTION`'s doc comment).
 * Matches `BuildingsTable.tsx`/`presentFacilities.ts`'s existing `derivePresentCounts` output
 * shape. `firstStationBuilding` is optional/empty-string-tolerant (not yet picked). */
export function computeCurrentSystemScores(
  presentCounts: Record<string, number>,
  firstStationBuilding: string | undefined,
): Record<Score, number> {
  const raw: Record<BaseScore, number> = Object.fromEntries(BASE_SCORES.map((s) => [s, 0])) as Record<BaseScore, number>;
  const firstStationRaw: Partial<Record<Score, number>> = {};

  for (const [name, count] of Object.entries(presentCounts)) {
    if (count === 0) continue;
    const building = ALL_BUILDINGS[name];
    if (!building) continue;
    for (const score of BASE_SCORES) raw[score] += building[score] * count;
  }

  const firstStation = firstStationBuilding ? ALL_BUILDINGS[firstStationBuilding] : undefined;
  if (firstStation) {
    for (const score of BASE_SCORES) {
      raw[score] += firstStation[score];
      if (score in FIRST_STATION_BONUS || score in SUBSEQUENT_FACILITY_REDUCTION) {
        firstStationRaw[score] = firstStation[score];
      }
    }
  }

  const scores = {} as Record<Score, number>;
  for (const score of BASE_SCORES) {
    const bonus = FIRST_STATION_BONUS[score];
    const reduction = SUBSEQUENT_FACILITY_REDUCTION[score];
    if (bonus === undefined && reduction === undefined) {
      scores[score] = raw[score];
      continue;
    }
    const firstPart = firstStationRaw[score] ?? 0;
    const subsequentPart = raw[score] - firstPart;
    scores[score] = Math.round(firstPart * (1 + (bonus ?? 0)) + subsequentPart * (1 - (reduction ?? 0)));
  }
  scores.system_score_beta = computeCompoundScore("system_score_beta", scores);
  scores.economy_synergy = 0;

  for (const score of ALL_SCORES) if (!(score in scores)) scores[score] = 0;
  return scores;
}
