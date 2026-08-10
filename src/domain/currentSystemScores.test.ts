import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_SCORES } from "../data/buildings";
import type { JournalSystem } from "../journal/parser";
import { computeCurrentSystemScores } from "./currentSystemScores";
import { derivePresentCounts, toSlotUsageBodies } from "./presentFacilities";

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
    expect(scores.system_score).toBe(3); // Commercial_Outpost's own real per-building score, not reweighted
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
    // Flat, unweighted sum of real per-building scores (Coriolis=8, Commercial_Outpost=3 each) — no
    // FIRST_STATION_BONUS/SUBSEQUENT_FACILITY_REDUCTION applies to system_score (real-game-verified).
    expect(scores.system_score).toBe(8 + 2 * 3);
    expect(scores.economy_synergy).toBe(0);
  });
});

// Real-game-verified regression (2026-08-10): the user supplied real, verified weekly Architect
// Dividend payout messages (in-game "points" readings) for these 4 real committed systems. Summing
// this app's real per-building `system_score` (see data/buildings.ts's doc comment) across each
// system's present facilities + primary station reproduces the real in-game points EXACTLY — see
// CLAUDE.md's "Explicitly unverified/best-effort constants" section for the full derivation. This
// is one of the strongest regression tests in this project — pin it.
describe("computeCurrentSystemScores.system_score matches real in-game points, exactly", () => {
  const JSONS_DIR = path.join(process.cwd(), "jsons");
  const REAL_SYSTEM_SCORES: Record<string, number> = {
    "swoilz-aw-c-d52.json": 125,
    "swoilz-cd-e-c1-1.json": 45,
    "swoilz-eg-i-b2-3.json": 75,
    "wregoe-yl-w-b56-4.json": 3,
  };

  it.each(Object.entries(REAL_SYSTEM_SCORES))("%s -> system_score %i", (file, expected) => {
    const system: JournalSystem = JSON.parse(readFileSync(path.join(JSONS_DIR, file), "utf-8"));
    const presentCounts = derivePresentCounts(toSlotUsageBodies(system.bodies), { excludePrimary: true });
    const scores = computeCurrentSystemScores(presentCounts, system.firstStationBuilding);
    expect(scores.system_score).toBe(expected);
  });

  it("covers every real fixture currently committed to jsons/ (fails loudly if a new one is added without updating this table)", () => {
    const files = readdirSync(JSONS_DIR).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(Object.keys(REAL_SYSTEM_SCORES).sort());
  });
});
