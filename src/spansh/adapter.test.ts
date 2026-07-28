// Unit tests against the committed real Spansh dump fixture (spansh-jsons/swoilz-aw-c-d52-dump.json
// — see CLAUDE.md's testing conventions on why real exported data is preferred over synthetic
// fixtures here). Confirms the field-by-field mapping described in CLAUDE.md's gap analysis.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isHighMetalContent, isRockyIce, isTerraformable, starTypeOf, systemResourceLevel } from "../domain/economyOverrides";
import { spanshDumpToJournalSystem } from "./adapter";
import type { SpanshDumpRecord } from "./types";

const record: SpanshDumpRecord = JSON.parse(
  readFileSync(path.join(process.cwd(), "spansh-jsons", "swoilz-aw-c-d52-dump.json"), "utf-8"),
).system;

describe("spanshDumpToJournalSystem", () => {
  const system = spanshDumpToJournalSystem(record);

  it("maps system-level fields, using the system's id64 as systemAddress", () => {
    expect(system.starSystem).toBe("Swoilz AW-C d52");
    expect(system.systemAddress).toBe(1797250861443);
  });

  it("skips Barycentre entries (4 of the dump's 36 raw bodies)", () => {
    expect(record.bodies.length).toBe(36);
    expect(system.bodies.length).toBe(32);
    expect(system.bodies.some((b) => b.bodyName.includes("barycentre"))).toBe(false);
  });

  it("does not synthesize ring bodies here — all 15 rings in this fixture belong to planets, not the star", () => {
    expect(system.bodies.some((b) => b.kind === "ring")).toBe(false);
  });

  it("keeps Spansh's real bodyId verbatim, including the main star at 0", () => {
    const star = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52")!;
    expect(star.bodyId).toBe(0);
    expect(star.kind).toBe("star");
  });

  it("classifies the main star's type for economyOverrides.ts's starTypeOf bucketing", () => {
    const star = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52")!;
    expect(star.starType).toBe("F");
    expect(starTypeOf(star)).toBe("other");
  });

  it("normalizes 'Rocky Ice world' to Journal's exact 'Rocky ice body' wording", () => {
    const body = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 10 b")!;
    expect(body.planetClass).toBe("Rocky ice body");
    expect(isRockyIce(body)).toBe(true);
  });

  it("maps the HMC/terraformable/pristine-reserve body correctly", () => {
    const body = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 3")!;
    expect(isHighMetalContent(body)).toBe(true);
    expect(isTerraformable(body)).toBe(true);
    expect(systemResourceLevel([body])).toBe("pristine");
    // radius: Spansh reports km, Journal/eligibility.ts expect meters.
    expect(body.radius).toBeCloseTo(6719.9195 * 1000, 1);
  });

  it("carries only Volcanism into raw, not the whole Spansh body object", () => {
    const body = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 3")!;
    expect(body.raw).toEqual({ Volcanism: "Minor Silicate Vapour Geysers" });
  });

  it("reads real geological/biological signals using the same $SAA_SignalType_* keys Journal uses", () => {
    const geo = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 1 a")!;
    expect(geo.hasGeologicalSignals).toBe(true);
    expect(geo.hasBiologicalSignals).toBe(false); // signals key present (Geological+Human), Biological confidently absent

    const bio = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 9 b")!;
    expect(bio.hasBiologicalSignals).toBe(true);
    expect(bio.hasGeologicalSignals).toBe(false);
  });

  it("leaves signals genuinely undefined (not false) for a body Spansh has no signals data for at all", () => {
    const unscanned = system.bodies.find((b) => b.bodyName === "Swoilz AW-C d52 6 b")!;
    expect(unscanned.hasBiologicalSignals).toBeUndefined();
    expect(unscanned.hasGeologicalSignals).toBeUndefined();
  });
});

describe("spanshDumpToJournalSystem — a star's own asteroid belts (belts vs rings field mismatch)", () => {
  // Real fixture confirming the bug: this star has a `belts` array (2 belts) and no `rings` key at
  // all, unlike ordinary planets in the same dump which use `rings`.
  const beltsRecord: SpanshDumpRecord = JSON.parse(
    readFileSync(path.join(process.cwd(), "spansh-jsons", "swoilz-cd-e-c1-1-dump.json"), "utf-8"),
  ).system;
  const beltsSystem = spanshDumpToJournalSystem(beltsRecord);

  it("maps a star's `belts` into JournalBody.rings, same as an ordinary body's `rings`", () => {
    const star = beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1")!;
    expect(star.kind).toBe("star");
    expect(star.rings).toEqual([
      { name: "Swoilz CD-E c1-1 A Belt", ringClass: "Rocky", massMT: 52421000000000 },
      { name: "Swoilz CD-E c1-1 B Belt", ringClass: "Metallic", massMT: 1.281e16 },
    ]);
  });

  it("still maps an ordinary ringed planet's `rings` field unaffected by the `belts` fallback, and does NOT synthesize a ring body for it (star belts only)", () => {
    const planet = beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1 1")!;
    expect(planet.rings.length).toBe(1);
    expect(beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1 1 A Ring")).toBeUndefined();
  });

  it("synthesizes a separate kind:'ring' body for each of the star's two belts, parented to the star", () => {
    const star = beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1")!;
    const beltA = beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1 A Belt")!;
    const beltB = beltsSystem.bodies.find((b) => b.bodyName === "Swoilz CD-E c1-1 B Belt")!;
    expect(beltA.kind).toBe("ring");
    expect(beltB.kind).toBe("ring");
    expect(beltA.parents[0]).toEqual({ type: "Star", bodyId: star.bodyId });
    // Self-referencing `rings` so a port built here still gets the "Has rings" Extraction bonus.
    expect(beltA.rings).toEqual([star.rings[0]]);
    expect(beltA.bodyId).not.toBe(beltB.bodyId);
  });
});
