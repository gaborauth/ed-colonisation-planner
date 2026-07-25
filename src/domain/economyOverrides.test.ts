import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import {
  computeBodyEconomyOverrides,
  computeBoostDecrease,
  computeColonyEconomyBreakdown,
  computeEconomyRatios,
  computeStrongLinkBreakdown,
  hasGeologicals,
  hasOrganics,
  hasVolcanism,
  isTidalLockChainToStar,
  systemResourceLevel,
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
    // hasOrganics()/hasGeologicals() are still null for a landable body with no FSSBodySignals data
    // (the common case for a body never FSS-signal-scanned) — this rule can't fire for THIS body,
    // but the mapping itself (organics -> Agriculture + Terraforming, not just Agriculture) must be
    // correct for whenever that data is known. Exercised here via the documented
    // always-unevaluated-when-unknown path instead; see the `hasOrganics`/`hasGeologicals` describe
    // blocks below for the now-confidently-known cases.
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

  it("is true for a planet tidally locked to its star through a binary-pair barycenter (\"Null\" parent)", () => {
    // Real bug found from jsons/Swoilz AW-C d52-20260725-0826.json: bodies 4/5 are two gas giants
    // orbiting each other (a binary pair), that pair then orbiting the system's star — each one's
    // own `parents` runs [{Null, barycenterId}, {Star, starId}], and the barycenter itself was never
    // scanned (no Scan event, no JournalBody record to look up). The old version of this function
    // treated the "Null" immediate parent as an instant chain-break, so a real tidally-locked planet
    // never registered the decrease at all.
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({
      tidalLocked: true,
      parents: [
        { type: "Null", bodyId: 999 },
        { type: "Star", bodyId: star.bodyId },
      ],
    });
    const byId = new Map([star, planet].map((b) => [b.bodyId, b]));
    expect(isTidalLockChainToStar(planet, byId)).toBe(true);
  });

  it("still walks past a barycenter to find and recurse into a real Planet ancestor", () => {
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const planet = makeBody({ tidalLocked: true, parents: [{ type: "Star", bodyId: star.bodyId }] });
    const moon = makeBody({
      tidalLocked: true,
      parents: [
        { type: "Null", bodyId: 999 },
        { type: "Planet", bodyId: planet.bodyId },
      ],
    });
    const byId = new Map([star, planet, moon].map((b) => [b.bodyId, b]));
    expect(isTidalLockChainToStar(moon, byId)).toBe(true);
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

  it("sums two independently-triggered boosts on the same economy into one +0.8 delta, not a capped +0.4", () => {
    // Earth-like world boosts Agriculture via BOTH "orbiting an ELW" and "on/orbiting a body with
    // organics" — two distinct rows in the source table. (A third real row, "on/orbiting a
    // terraformable body", exists in the source tables too, but is deliberately never applied here —
    // see TERRAFORMABLE_AGRICULTURE_BUG_NOTE — so it can't be used for this stacking test.)
    const body = makeBody({ planetClass: "Earthlike body", hasBiologicalSignals: true });
    const result = computeBoostDecrease(body, [body], ["Agriculture"]);
    expect(result.deltas.Agriculture).toBeCloseTo(0.8);
    expect(result.boosted).toEqual(["Agriculture"]); // Set membership unaffected, still just present
  });

  it("never applies Terraformable's Agriculture boost (suspected in-game bug, deliberately excluded)", () => {
    const body = makeBody({ planetClass: "Earthlike body", terraformState: "Terraformable" });
    const result = computeBoostDecrease(body, [body], ["Agriculture"]);
    // Only the ELW boost applies (+0.4) — Terraformable would add a second +0.4 per the source
    // tables, but that's excluded, so the total must stay at a single boost's worth.
    expect(result.deltas.Agriculture).toBeCloseTo(0.4);
  });

  it("gives a single decrease condition a -0.4 delta", () => {
    const body = makeBody({ planetClass: "Icy body" });
    const result = computeBoostDecrease(body, [body], ["Agriculture"]);
    expect(result.deltas.Agriculture).toBeCloseTo(-0.4);
  });

  it("omits an economy from deltas entirely when no condition applies to it", () => {
    const body = makeBody({ planetClass: "Water giant" }); // matches nothing
    const result = computeBoostDecrease(body, [body], ["Tourism"]);
    expect(result.deltas.Tourism).toBeUndefined();
  });
});

describe("hasVolcanism / hasGeologicals / hasOrganics", () => {
  it("is confidently false for an unlandable body's geologicals/organics (DSS/FSS-signal-gated data), regardless of landability", () => {
    const gasGiant = makeBody({ planetClass: "Sudarsky class III gas giant", landable: false });
    expect(hasGeologicals(gasGiant)).toBe(false);
    expect(hasOrganics(gasGiant)).toBe(false);
    // No raw.Volcanism field at all on this fixture -> genuinely unknown, not inferred false.
    expect(hasVolcanism(gasGiant)).toBeNull();
  });

  it("reads Volcanism straight from the real Scan event's raw field, for a landable body", () => {
    const volcanic = makeBody({ planetClass: "Rocky body", raw: { Volcanism: "minor metallic magma volcanism" } });
    expect(hasVolcanism(volcanic)).toBe(true);
    const quiet = makeBody({ planetClass: "Rocky body", raw: { Volcanism: "" } });
    expect(hasVolcanism(quiet)).toBe(false);
    const noField = makeBody({ planetClass: "Rocky body", raw: {} });
    expect(hasVolcanism(noField)).toBeNull();
  });

  it("also reads real Volcanism for an UNLANDABLE body — regression test for a real reported bug", () => {
    // The user's own system: two Landable:false bodies (High Metal Content, Icy) both report real
    // non-empty Volcanism text. An earlier version of hasVolcanism() incorrectly returned `false`
    // for any unlandable body (over-generalizing hasGeologicals's landable-gating, which is about a
    // different, DSS-signal-derived data source), silently hiding real volcanism data like this.
    const hmc = makeBody({ planetClass: "High metal content body", landable: false, raw: { Volcanism: "major rocky magma volcanism" } });
    expect(hasVolcanism(hmc)).toBe(true);
    const icy = makeBody({ planetClass: "Icy body", landable: false, raw: { Volcanism: "water geysers volcanism" } });
    expect(hasVolcanism(icy)).toBe(true);
  });

  it("reads geologicals/organics from the parsed FSSBodySignals flags for a landable body, null when unset", () => {
    const scanned = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: true, hasGeologicalSignals: false });
    expect(hasOrganics(scanned)).toBe(true);
    expect(hasGeologicals(scanned)).toBe(false);

    const neverSignalScanned = makeBody({ planetClass: "Rocky body" });
    expect(hasOrganics(neverSignalScanned)).toBeNull();
    expect(hasGeologicals(neverSignalScanned)).toBeNull();
  });
});

describe("systemResourceLevel", () => {
  it("reads a ringed body's ReserveLevel as the whole system's resource level, even from a different body than the one being checked", () => {
    const ringedBody = makeBody({
      rings: [{ name: "r", ringClass: "eRingClass_MetalRich", massMT: 1 }],
      reserveLevel: "PristineResources",
    });
    const otherBody = makeBody({ planetClass: "Rocky body" });
    expect(systemResourceLevel([otherBody, ringedBody])).toBe("pristine");
  });

  it("matches case-insensitively and by substring, tolerant of either 'Major'/'MajorResources'-style wording", () => {
    const majorWord = makeBody({ reserveLevel: "Major" });
    expect(systemResourceLevel([majorWord])).toBe("major");
    const majorResources = makeBody({ reserveLevel: "MajorResources" });
    expect(systemResourceLevel([majorResources])).toBe("major");
  });

  it("recognizes low and depleted", () => {
    expect(systemResourceLevel([makeBody({ reserveLevel: "Low" })])).toBe("low");
    expect(systemResourceLevel([makeBody({ reserveLevel: "Depleted" })])).toBe("depleted");
  });

  it("treats an unrecognized/'Common' level as null (known, but neither boosts nor decreases)", () => {
    expect(systemResourceLevel([makeBody({ reserveLevel: "Common" })])).toBeNull();
  });

  it("is null when no body in the system has reported a reserve level at all", () => {
    expect(systemResourceLevel([makeBody({ rings: [{ name: "r", ringClass: "x", massMT: 1 }] })])).toBeNull();
    expect(systemResourceLevel([makeBody({ rings: [] })])).toBeNull();
  });
});

describe("computeEconomyRatios", () => {
  it("gives a flat 100% with no applicable boost/decrease condition", () => {
    const body = makeBody({ planetClass: "Water giant" });
    expect(computeEconomyRatios(["Colony"], body, [body])).toEqual([{ economy: "Colony", percent: 100 }]);
  });

  it("reproduces the real reported case: Agriculture 140% with organics, 100% without, on an otherwise-identical moon of a gas giant", () => {
    // Mirrors the user's own exported system: two moons of a gas giant, both Rocky/tidally-locked
    // to the *planet* (not the star, so no tidal-lock decrease applies — see
    // isTidalLockChainToStar), differing only in FSSBodySignals-reported biological signals.
    const gasGiant = makeBody({ kind: "planet", planetClass: "Sudarsky class I gas giant", landable: false });
    const withBio = makeBody({
      planetClass: "Rocky body",
      tidalLocked: true,
      parents: [{ type: "Planet", bodyId: gasGiant.bodyId }],
      hasBiologicalSignals: true,
    });
    const withoutBio = makeBody({
      planetClass: "Rocky body",
      tidalLocked: true,
      parents: [{ type: "Planet", bodyId: gasGiant.bodyId }],
      hasBiologicalSignals: false,
    });
    const allBodies = [gasGiant, withBio, withoutBio];
    expect(computeEconomyRatios(["Agriculture"], withBio, allBodies)).toEqual([{ economy: "Agriculture", percent: 140 }]);
    expect(computeEconomyRatios(["Agriculture"], withoutBio, allBodies)).toEqual([{ economy: "Agriculture", percent: 100 }]);
  });

  it("reproduces the real reported case: a ringed gas giant's Extraction/Industrial at 140% (resource-level boost) with HighTech correctly un-boosted at 100%", () => {
    // Mirrors "Froude City" (Coriolis) on a ringed gas giant: base economies from
    // computeBodyEconomyOverrides are HighTech+Industrial (gas giant) plus Extraction (has rings).
    // The system's major/pristine resource level (this body's own ReserveLevel) boosts Extraction
    // AND Industrial (official text: "Industrial and Refinery... boosted by... major or pristine
    // resources") but has no listed boost condition for HighTech at all, so it correctly stays at
    // the 100% base.
    const gasGiant = makeBody({
      planetClass: "Sudarsky class III gas giant",
      landable: false,
      rings: [{ name: "r", ringClass: "eRingClass_Metalic", massMT: 1 }],
      reserveLevel: "Pristine",
    });
    const economies = computeBodyEconomyOverrides(gasGiant).economies;
    expect(new Set(economies)).toEqual(new Set(["HighTech", "Industrial", "Extraction"]));
    const ratios = computeEconomyRatios(economies, gasGiant, [gasGiant]);
    expect(ratios).toEqual(
      expect.arrayContaining([
        { economy: "Extraction", percent: 140 },
        { economy: "Industrial", percent: 140 },
        { economy: "HighTech", percent: 100 },
      ]),
    );
  });

  it("reproduces the real reported case: a rocky-body Colony-type port's Refinery at 140% from the same system-wide resource-level boost", () => {
    // Mirrors "Bianchi Enterprise" (Civilian_Planetary_Outpost, a Colony-type port with no preset
    // economy) on a plain Rocky body: base Refinery 100% from the Colony-override table, boosted to
    // 140% by the SAME system-wide major/pristine resources fact as the gas giant case above — the
    // body reporting the ReserveLevel doesn't even have to be this one.
    const ringedElsewhere = makeBody({ reserveLevel: "Major" });
    const rockyPort = makeBody({ planetClass: "Rocky body" });
    const allBodies = [ringedElsewhere, rockyPort];
    const economies = computeBodyEconomyOverrides(rockyPort).economies;
    expect(economies).toEqual(["Refinery"]);
    expect(computeEconomyRatios(economies, rockyPort, allBodies)).toEqual([{ economy: "Refinery", percent: 140 }]);
  });

  it("stacks two independent decreases below a single one, without going below the floor", () => {
    // Two of Agriculture's decrease conditions triggered at once (icy body, AND tidally locked
    // directly to the star) -> 100% - 40% - 40% = 20%. No current rule set can push any economy's
    // delta past the ECONOMY_RATIO_FLOOR_PERCENT floor (that would need 3+ independent -0.4
    // conditions on one economy, which doesn't exist in the source tables today) — this just
    // confirms the floor's `Math.max` doesn't accidentally clip a legitimately-computable 20%.
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const body = makeBody({
      planetClass: "Icy body",
      tidalLocked: true,
      parents: [{ type: "Star", bodyId: star.bodyId }],
    });
    expect(computeEconomyRatios(["Agriculture"], body, [star, body])).toEqual([{ economy: "Agriculture", percent: 20 }]);
  });

  it("sorts descending by percent", () => {
    const body = makeBody({ planetClass: "Earthlike body" }); // boosts Agriculture, HighTech, Tourism; Military un-boosted
    const ratios = computeEconomyRatios(["Military", "Agriculture", "HighTech", "Tourism"], body, [body]);
    expect(ratios.map((r) => r.percent)).toEqual([...ratios.map((r) => r.percent)].sort((a, b) => b - a));
    expect(ratios[ratios.length - 1]).toEqual({ economy: "Military", percent: 100 });
  });
});

describe("computeColonyEconomyBreakdown", () => {
  it("labels an ordinary main-sequence star with its real star type, not a generic 'brown dwarf' claim", () => {
    // The official rule ("Brown Dwarves and all other star types -> Military") buckets an F-type
    // star together with real brown dwarfs — the label must still say "F", not imply this star
    // itself is a brown dwarf.
    const fStar = makeBody({ kind: "star", starType: "F", parents: [] });
    const breakdown = computeColonyEconomyBreakdown(fStar, [fStar]);
    expect(breakdown.find((b) => b.economy === "Military")!.lines[0]).toEqual({ amount: 1, label: "Star type: F" });

    // A real brown dwarf ("L") lands in the same bucket, correctly showing its own real code too.
    const brownDwarf = makeBody({ kind: "star", starType: "L", parents: [] });
    const bdBreakdown = computeColonyEconomyBreakdown(brownDwarf, [brownDwarf]);
    expect(bdBreakdown.find((b) => b.economy === "Military")!.lines[0]).toEqual({ amount: 1, label: "Star type: L" });
  });

  it("gives the compact-remnant bucket a real name per star type, not a combined label", () => {
    const blackHole = makeBody({ kind: "star", starType: "H", parents: [] });
    expect(computeColonyEconomyBreakdown(blackHole, [blackHole]).find((b) => b.economy === "HighTech")!.lines[0]).toEqual({
      amount: 1,
      label: "Star type: BLACK HOLE",
    });

    const neutronStar = makeBody({ kind: "star", starType: "N", parents: [] });
    expect(computeColonyEconomyBreakdown(neutronStar, [neutronStar]).find((b) => b.economy === "HighTech")!.lines[0]).toEqual({
      amount: 1,
      label: "Star type: NEUTRON STAR",
    });

    const whiteDwarf = makeBody({ kind: "star", starType: "DA", parents: [] });
    expect(computeColonyEconomyBreakdown(whiteDwarf, [whiteDwarf]).find((b) => b.economy === "HighTech")!.lines[0]).toEqual({
      amount: 1,
      label: "Star type: WHITE DWARF",
    });
  });

  it("reproduces the user's three worked examples verbatim, in Extraction/Industrial/Refinery order", () => {
    // A Rocky body (-> Refinery base), with geological signals (-> Extraction+Industrial base) and
    // real volcanism (-> Extraction buff only, per the official table), in a system with a
    // major/pristine-resource body elsewhere (-> Extraction+Industrial+Refinery buff).
    const ringedElsewhere = makeBody({ reserveLevel: "Pristine" });
    const body = makeBody({
      planetClass: "Rocky body",
      hasGeologicalSignals: true,
      raw: { Volcanism: "minor metallic magma volcanism" },
    });
    const allBodies = [ringedElsewhere, body];
    const breakdown = computeColonyEconomyBreakdown(body, allBodies);

    expect(breakdown.map((b) => b.economy)).toEqual(["Extraction", "Industrial", "Refinery"]);

    const extraction = breakdown.find((b) => b.economy === "Extraction")!;
    expect(extraction.lines).toEqual([
      { amount: 1, label: "Body has: GEO" },
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
      { amount: 0.4, label: "Buff: body has VOLCANISM" },
    ]);
    expect(extraction.lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(1.8);

    const industrial = breakdown.find((b) => b.economy === "Industrial")!;
    expect(industrial.lines).toEqual([
      { amount: 1, label: "Body has: GEO" },
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(industrial.lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(1.4);

    const refinery = breakdown.find((b) => b.economy === "Refinery")!;
    expect(refinery.lines).toEqual([
      { amount: 1, label: "Body type: ROCKY" },
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(refinery.lines.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(1.4);
  });

  it("never stacks two base rules on the same economy — only the first-matching one contributes the +1 line", () => {
    // A High Metal Content body (-> Extraction base) that ALSO has geological signals
    // (-> Extraction + Industrial base) — both rules independently grant Extraction, but per
    // EconomicEffects.ods R30 that must still only show a single +1 line (the first-checked rule,
    // HMC), not two stacked +1 lines summing to +2. Industrial still gets its own single base line
    // from geologicals, since nothing else already claimed it.
    const body = makeBody({ planetClass: "High metal content body", hasGeologicalSignals: true });
    const breakdown = computeColonyEconomyBreakdown(body, [body]);
    const extraction = breakdown.find((b) => b.economy === "Extraction")!;
    expect(extraction.lines.filter((l) => l.amount === 1)).toHaveLength(1);
    expect(extraction.lines[0]).toEqual({ amount: 1, label: "Body type: HMC/METAL RICH" });
    const industrial = breakdown.find((b) => b.economy === "Industrial")!;
    expect(industrial.lines[0]).toEqual({ amount: 1, label: "Body has: GEO" });
  });

  it("includes a decrease line with a negative amount", () => {
    // Icy -> Industrial base only (not Agriculture) — icy also decreases Agriculture per the
    // boost/decrease table, but that decrease can never show without an Agriculture base grant to
    // attach to, same gating computeBoostDecrease already applies.
    const icy = makeBody({ planetClass: "Icy body" });
    expect(computeColonyEconomyBreakdown(icy, [icy]).map((b) => b.economy)).toEqual(["Industrial"]);

    // An Earth-like world tidally locked directly to its star: Agriculture gets a real base grant
    // (from being an ELW) AND a real decrease (tidal-lock-to-star).
    const star = makeBody({ kind: "star", starType: "G", parents: [] });
    const elw = makeBody({ planetClass: "Earthlike body", tidalLocked: true, parents: [{ type: "Star", bodyId: star.bodyId }] });
    const agriculture = computeColonyEconomyBreakdown(elw, [star, elw]).find((b) => b.economy === "Agriculture")!;
    expect(agriculture.lines).toContainEqual({ amount: -0.4, label: "Debuff: TIDALLY LOCKED to star" });
  });

  it("returns an empty array for a body with no Colony-override economy at all", () => {
    const body = makeBody({ planetClass: "Water giant" });
    expect(computeColonyEconomyBreakdown(body, [body])).toEqual([]);
  });
});

describe("computeStrongLinkBreakdown", () => {
  it("shows HighTech/Tourism GEO buffs that the gated Default-economies table omits", () => {
    // Same body shape as the "reproduces the user's three worked examples" test above (Rocky body,
    // geological signals, real volcanism, system-wide Pristine resources) — but unlike
    // computeColonyEconomyBreakdown, this isn't gated on the body granting that economy as a Colony
    // base in the first place: a strong link to a HighTech/Tourism facility elsewhere still gets the
    // GEO buff at this body, even though this body's own Colony-port would never carry HighTech or
    // Tourism itself (see CLAUDE.md's verbatim strong-link boost/decrease table).
    const ringedElsewhere = makeBody({ reserveLevel: "Pristine" });
    const body = makeBody({
      planetClass: "Rocky body",
      hasGeologicalSignals: true,
      raw: { Volcanism: "minor metallic magma volcanism" },
    });
    const allBodies = [ringedElsewhere, body];
    const breakdown = computeStrongLinkBreakdown(body, allBodies);

    expect(breakdown.map((b) => b.economy)).toEqual(["Extraction", "HighTech", "Industrial", "Refinery", "Tourism"]);

    expect(breakdown.find((b) => b.economy === "Extraction")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
      { amount: 0.4, label: "Buff: body has VOLCANISM" },
    ]);
    expect(breakdown.find((b) => b.economy === "HighTech")!.lines).toEqual([{ amount: 0.4, label: "Buff: body has GEO" }]);
    expect(breakdown.find((b) => b.economy === "Industrial")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(breakdown.find((b) => b.economy === "Refinery")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(breakdown.find((b) => b.economy === "Tourism")!.lines).toEqual([{ amount: 0.4, label: "Buff: body has GEO" }]);
  });

  it("matches the real 'Swoilz AW-C d52 1 a' journal body's expected strong-link boosts", () => {
    // Real data from jsons/Swoilz AW-C d52-20260725-0826.json: a tidally-locked (to a non-tidally-
    // locked parent planet, so no Agriculture debuff) Rocky body with real Volcanism text and
    // FSSBodySignals-confirmed geologicals, in a system where another ringed body reports
    // PristineResources. Expected result (user-verified): Extraction/Industrial/Refinery boosted by
    // the system's Pristine resource level, Extraction additionally boosted by this body's own
    // volcanism, and HighTech/Tourism boosted by this body's geologicals — Agriculture untouched.
    const parentPlanet = makeBody({ kind: "planet", tidalLocked: false, parents: [{ type: "Star", bodyId: 0 }] });
    const ringedElsewhere = makeBody({ reserveLevel: "PristineResources", rings: [{ name: "r", ringClass: "eRingClass_Rocky", massMT: 1 }] });
    const body = makeBody({
      bodyName: "Swoilz AW-C d52 1 a",
      planetClass: "Rocky body",
      landable: true,
      tidalLocked: true,
      hasBiologicalSignals: false,
      hasGeologicalSignals: true,
      parents: [{ type: "Planet", bodyId: parentPlanet.bodyId }],
      raw: { Volcanism: "minor metallic magma volcanism" },
    });
    const allBodies = [parentPlanet, ringedElsewhere, body];
    const breakdown = computeStrongLinkBreakdown(body, allBodies);

    expect(breakdown.map((b) => b.economy)).toEqual(["Extraction", "HighTech", "Industrial", "Refinery", "Tourism"]);
    expect(breakdown.find((b) => b.economy === "Extraction")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
      { amount: 0.4, label: "Buff: body has VOLCANISM" },
    ]);
    expect(breakdown.find((b) => b.economy === "HighTech")!.lines).toEqual([{ amount: 0.4, label: "Buff: body has GEO" }]);
    expect(breakdown.find((b) => b.economy === "Industrial")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(breakdown.find((b) => b.economy === "Refinery")!.lines).toEqual([
      { amount: 0.4, label: "Buff: reserveLevel MAJOR or PRISTINE" },
    ]);
    expect(breakdown.find((b) => b.economy === "Tourism")!.lines).toEqual([{ amount: 0.4, label: "Buff: body has GEO" }]);
  });

  it("returns an empty array when no strong-link modifier condition applies at all", () => {
    const body = makeBody({ planetClass: "Water giant" });
    expect(computeStrongLinkBreakdown(body, [body])).toEqual([]);
  });

  it("matches the real 'Swoilz AW-C d52 4' journal body: Agriculture debuffed through a binary-pair barycenter", () => {
    // Real data from jsons/Swoilz AW-C d52-20260725-0826.json: a gas giant tidally locked to its
    // binary-pair partner, that pair orbiting the star via an unscanned barycenter ("Null" parent) —
    // see the isTidalLockChainToStar barycenter tests above for why this used to be missed entirely.
    const star = makeBody({ kind: "star", parents: [] });
    const body = makeBody({
      bodyName: "Swoilz AW-C d52 4",
      planetClass: "Sudarsky class III gas giant",
      landable: false,
      tidalLocked: true,
      parents: [
        { type: "Null", bodyId: 18 },
        { type: "Star", bodyId: star.bodyId },
      ],
    });
    const breakdown = computeStrongLinkBreakdown(body, [star, body]);
    expect(breakdown.map((b) => b.economy)).toEqual(["Agriculture"]);
    expect(breakdown[0].lines).toEqual([{ amount: -0.4, label: "Debuff: TIDALLY LOCKED to star" }]);
  });
});
