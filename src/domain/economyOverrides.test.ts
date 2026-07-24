import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import {
  computeBodyEconomyOverrides,
  computeBoostDecrease,
  isTidalLockChainToStar,
} from "./economyOverrides";

let nextBodyId = 1;

function makeBody(overrides: Partial<JournalBody> = {}): JournalBody {
  return {
    bodyName: `Body ${nextBodyId}`,
    bodyId: nextBodyId++,
    kind: "planet",
    landable: true,
    parents: [{ type: "Star", bodyId: 0 }],
    rings: [],
    raw: {},
    ...overrides,
  };
}

describe("computeBodyEconomyOverrides", () => {
  it("stacks all four Earth-like world overrides", () => {
    const body = makeBody({ planetClass: "Earthlike body" });
    const result = computeBodyEconomyOverrides(body);
    expect(new Set(result.economies)).toEqual(new Set(["Agriculture", "HighTech", "Military", "Tourism"]));
  });

  it("stacks organics -> Agriculture, Terraforming as one rule when known", () => {
    // hasOrganics() always returns null today (no DSS/FSS event parsing), so this rule can never
    // fire in practice yet — but the mapping itself (organics -> Agriculture + Terraforming, not
    // just Agriculture) must be correct for whenever that data becomes available. Exercised here
    // indirectly via the documented always-unevaluated path instead.
    const body = makeBody({ planetClass: "Rocky body" });
    const result = computeBodyEconomyOverrides(body);
    expect(result.unevaluatedRules.some((r) => r.includes("Agriculture, Terraforming"))).toBe(true);
    expect(result.unevaluatedRules.some((r) => r.includes("Extraction, Industrial"))).toBe(true);
  });

  it("gives a high metal content world only Extraction (no other stacking)", () => {
    const body = makeBody({ planetClass: "High metal content body" });
    expect(computeBodyEconomyOverrides(body).economies).toEqual(["Extraction"]);
  });

  it("stacks rings on top of a planet's own class override", () => {
    const body = makeBody({
      planetClass: "Icy body",
      rings: [{ name: "r", ringClass: "eRingClass_Icy", massMT: 1 }],
    });
    expect(new Set(computeBodyEconomyOverrides(body).economies)).toEqual(new Set(["Industrial", "Extraction"]));
  });

  it("applies the star-type override for a black hole/neutron star/white dwarf", () => {
    const blackHole = makeBody({ kind: "star", starType: "H", parents: [] });
    expect(new Set(computeBodyEconomyOverrides(blackHole).economies)).toEqual(new Set(["HighTech", "Tourism"]));

    const whiteDwarf = makeBody({ kind: "star", starType: "DA", parents: [] });
    expect(new Set(computeBodyEconomyOverrides(whiteDwarf).economies)).toEqual(new Set(["HighTech", "Tourism"]));
  });

  it("applies the Military override for a brown dwarf or ordinary star", () => {
    const g = makeBody({ kind: "star", starType: "G", parents: [] });
    expect(computeBodyEconomyOverrides(g).economies).toEqual(["Military"]);

    const brownDwarf = makeBody({ kind: "star", starType: "L", parents: [] });
    expect(computeBodyEconomyOverrides(brownDwarf).economies).toEqual(["Military"]);
  });

  it("gives a body with no matching attributes zero overrides (stays default Colony economy)", () => {
    // "Water giant" doesn't match any override rule (not "gas giant", not "water world" exactly,
    // no rings, no matching star type since it's a planet) — a genuine no-override case.
    const body = makeBody({ planetClass: "Water giant" });
    expect(computeBodyEconomyOverrides(body).economies).toEqual([]);
  });
});

describe("isTidalLockChainToStar", () => {
  it("is true for a planet directly tidally locked to its star", () => {
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({ tidalLocked: true, parents: [{ type: "Star", bodyId: star.bodyId }] });
    const byId = new Map([star, planet].map((b) => [b.bodyId, b]));
    expect(isTidalLockChainToStar(planet, byId)).toBe(true);
  });

  it("is false when the body itself isn't tidally locked", () => {
    const planet = makeBody({ tidalLocked: false, parents: [{ type: "Star", bodyId: 0 }] });
    expect(isTidalLockChainToStar(planet, new Map())).toBe(false);
  });

  it("is true for a moon tidally locked to a planet that's itself locked to the star", () => {
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({ tidalLocked: true, parents: [{ type: "Star", bodyId: star.bodyId }] });
    const moon = makeBody({ tidalLocked: true, parents: [{ type: "Planet", bodyId: planet.bodyId }] });
    const byId = new Map([star, planet, moon].map((b) => [b.bodyId, b]));
    expect(isTidalLockChainToStar(moon, byId)).toBe(true);
  });

  it("is false for a locked moon whose parent planet is not itself locked to the star", () => {
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({ tidalLocked: false, parents: [{ type: "Star", bodyId: star.bodyId }] });
    const moon = makeBody({ tidalLocked: true, parents: [{ type: "Planet", bodyId: planet.bodyId }] });
    const byId = new Map([star, planet, moon].map((b) => [b.bodyId, b]));
    expect(isTidalLockChainToStar(moon, byId)).toBe(false);
  });

  it("safely returns false (not a guessed decrease) when a parent link is missing scan data", () => {
    const moon = makeBody({ tidalLocked: true, parents: [{ type: "Planet", bodyId: 9999 }] });
    expect(isTidalLockChainToStar(moon, new Map())).toBe(false);
  });
});

describe("computeBoostDecrease", () => {
  it("boosts Agriculture for an Earth-like world but not an unrequested economy", () => {
    const body = makeBody({ planetClass: "Earthlike body" });
    const result = computeBoostDecrease(body, [body], ["Agriculture"]);
    expect(result.boosted).toEqual(["Agriculture"]);
    expect(result.decreased).toEqual([]);
  });

  it("decreases (not boosts) Agriculture on an icy body", () => {
    const body = makeBody({ planetClass: "Icy body" });
    const result = computeBoostDecrease(body, [body], ["Agriculture"]);
    expect(result.boosted).toEqual([]);
    expect(result.decreased).toEqual(["Agriculture"]);
  });

  it("decreases Agriculture for a planet tidally locked to its star", () => {
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({
      planetClass: "Rocky body",
      tidalLocked: true,
      parents: [{ type: "Star", bodyId: star.bodyId }],
    });
    const result = computeBoostDecrease(planet, [star, planet], ["Agriculture"]);
    expect(result.decreased).toContain("Agriculture");
  });

  it("boosts Tourism from a system-wide black hole even though the body itself isn't one", () => {
    const blackHole = makeBody({ kind: "star", starType: "H", parents: [] });
    const port = makeBody({ planetClass: "Rocky body" });
    const result = computeBoostDecrease(port, [blackHole, port], ["Tourism"]);
    expect(result.boosted).toEqual(["Tourism"]);
  });

  it("surfaces organics/geologicals/resource-level as unknown rather than silently absent", () => {
    const body = makeBody({ planetClass: "Rocky body" });
    const result = computeBoostDecrease(body, [body], ["Agriculture", "Extraction", "HighTech"]);
    expect(result.reasons.some((r) => r.includes("organics presence unknown"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("system resource level unknown"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("geologicals presence unknown"))).toBe(true);
  });

  it("has no decrease conditions for HighTech or Tourism (Nil, per the source table)", () => {
    const body = makeBody({ planetClass: "Icy body" }); // would decrease Agriculture, but not these
    const result = computeBoostDecrease(body, [body], ["HighTech", "Tourism"]);
    expect(result.decreased).toEqual([]);
  });
});
