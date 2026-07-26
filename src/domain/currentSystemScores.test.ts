import { describe, expect, it } from "vitest";
import { ALL_SCORES } from "../data/buildings";
import { computeCurrentSystemScores } from "./currentSystemScores";

describe("computeCurrentSystemScores", () => {
  it("returns all zeros for an empty system with no primary station", () => {
    const scores = computeCurrentSystemScores({}, undefined);
    for (const score of ALL_SCORES) expect(scores[score]).toBe(0);
  });

  it("still applies SUBSEQUENT_FACILITY_REDUCTION even with no primary station picked yet (nothing gets the bonus instead)", () => {
    // Commercial_Outpost: sec -1, w 3, sol 5, tl 0, dl 0, ip 1, mp 1, cost 18988 — matches
    // solve.ts's own behavior of reducing everything not identified as the first station, even
    // when there simply isn't one (mirrors solve.ts's `firstStationContribution` staying empty).
    const scores = computeCurrentSystemScores({ Commercial_Outpost: 1 }, undefined);
    expect(scores.security).toBe(-1); // -1 * (1 - 0.1) = -0.9 -> -1
    expect(scores.wealth).toBe(2); // 3 * (1 - 0.25) = 2.25 -> 2
    expect(scores.standard_of_living).toBe(4); // 5 * (1 - 0.2) = 4 -> 4
    expect(scores.tech_level).toBe(0);
    expect(scores.development_level).toBe(0);
    expect(scores.initial_population_increase).toBe(1); // not reweighted
    expect(scores.max_population_increase).toBe(1);
    expect(scores.construction_cost).toBe(18988); // not reweighted
    expect(scores.system_score_beta).toBe(scores.security + scores.tech_level + scores.wealth + scores.standard_of_living);
    expect(scores.economy_synergy).toBe(0);
  });

  it("boosts the primary station's own share and reduces everyone else's, same split as solve.ts", () => {
    // Coriolis (primary): sec -2, tl 2, w 3, sol 3, dl 3. Plus 2x Commercial_Outpost (sec -1, w 3,
    // sol 5, tl 0, dl 0 each) as ordinary present facilities.
    const scores = computeCurrentSystemScores({ Commercial_Outpost: 2 }, "Coriolis");
    // security: first -2*1.4=-2.8, subsequent (-4 - -2)=-2 * 0.9=-1.8 -> -4.6 -> -5
    expect(scores.security).toBe(-5);
    // tech_level: first 2*1.2=2.4, subsequent 0*0.75=0 -> 2.4 -> 2
    expect(scores.tech_level).toBe(2);
    // wealth: first 3*1.4=4.2, subsequent (9-3)=6*0.75=4.5 -> 8.7 -> 9
    expect(scores.wealth).toBe(9);
    // standard_of_living: first 3*1.4=4.2, subsequent (13-3)=10*0.8=8 -> 12.2 -> 12
    expect(scores.standard_of_living).toBe(12);
    // development_level: first 3*1.4=4.2, subsequent (3-3)=0 -> 4.2 -> 4
    expect(scores.development_level).toBe(4);
    expect(scores.initial_population_increase).toBe(3); // 1 + 2*1, not reweighted
    expect(scores.construction_cost).toBe(53723 + 2 * 18988); // not reweighted
    expect(scores.system_score_beta).toBe(-5 + 2 + 9 + 12);
    expect(scores.economy_synergy).toBe(0);
  });
});
