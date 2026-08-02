import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import {
  comboRecipeForBody,
  eligibleBodiesForCombo,
  forcedBuildingsForCombo,
  isBodyUntouched,
  pickBestFitBody,
} from "./selfSufficiencyCombos";

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

describe("comboRecipeForBody", () => {
  it("returns null for a body that's neither a clean Rocky body nor High Metal Content", () => {
    const body = makeBody({ planetClass: "Icy body" });
    expect(comboRecipeForBody("commodityHub", body)).toBeNull();
    expect(comboRecipeForBody("manufacturingHub", body)).toBeNull();
  });

  it("rejects a Rocky body with unconfirmed-clean (unscanned) bio/geo signals", () => {
    const body = makeBody({ planetClass: "Rocky body" });
    expect(comboRecipeForBody("commodityHub", body)).toBeNull();
  });

  it("rejects a Rocky body with confirmed organics/geologicals/terraforming", () => {
    const withBio = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: true, hasGeologicalSignals: false });
    const withGeo = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: true });
    const terraformable = makeBody({
      planetClass: "Rocky body",
      hasBiologicalSignals: false,
      hasGeologicalSignals: false,
      terraformState: "Candidate for terraforming",
    });
    expect(comboRecipeForBody("commodityHub", withBio)).toBeNull();
    expect(comboRecipeForBody("commodityHub", withGeo)).toBeNull();
    expect(comboRecipeForBody("commodityHub", terraformable)).toBeNull();
  });

  it("a clean Rocky body needs a Civilian Planetary Outpost with no Refinery Hub for the commodityHub combo", () => {
    const body = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false });
    expect(comboRecipeForBody("commodityHub", body)).toEqual({ outpostBuilding: "Civilian_Planetary_Outpost", refineryHubCount: 0 });
  });

  it("a High Metal Content body needs a Civilian Planetary Outpost + 2 Refinery Hubs for the commodityHub combo, regardless of bio/geo", () => {
    const body = makeBody({ planetClass: "High metal content body", hasBiologicalSignals: true });
    expect(comboRecipeForBody("commodityHub", body)).toEqual({ outpostBuilding: "Civilian_Planetary_Outpost", refineryHubCount: 2 });
  });

  it("either eligible body type needs a Scientific Planetary Outpost + 4 Refinery Hubs for the manufacturingHub combo", () => {
    const rocky = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false });
    const hmc = makeBody({ planetClass: "Metal rich body" });
    expect(comboRecipeForBody("manufacturingHub", rocky)).toEqual({ outpostBuilding: "Scientific_Planetary_Outpost", refineryHubCount: 4 });
    expect(comboRecipeForBody("manufacturingHub", hmc)).toEqual({ outpostBuilding: "Scientific_Planetary_Outpost", refineryHubCount: 4 });
  });
});

describe("isBodyUntouched", () => {
  it("true when presentFacilities is absent or every slot is null", () => {
    expect(isBodyUntouched(makeBody())).toBe(true);
    expect(isBodyUntouched(makeBody({ presentFacilities: { space: [null], ground: [null, null] } }))).toBe(true);
  });

  it("false when any orbital or ground slot has a facility", () => {
    expect(
      isBodyUntouched(makeBody({ presentFacilities: { space: [{ building: "Government", demolishable: false }], ground: [] } })),
    ).toBe(false);
    expect(
      isBodyUntouched(makeBody({ presentFacilities: { space: [], ground: [null, { building: "Refinery_Hub", demolishable: false }] } })),
    ).toBe(false);
  });
});

describe("eligibleBodiesForCombo", () => {
  it("excludes an otherwise-matching body without enough ground slots", () => {
    const tooSmall = makeBody({
      planetClass: "Metal rich body",
      slots: { space: 1, ground: 2, asteroid: 0 },
    });
    expect(eligibleBodiesForCombo("commodityHub", [tooSmall])).toEqual([]);
  });

  it("excludes an otherwise-matching body that already has a facility", () => {
    const touched = makeBody({
      planetClass: "Rocky body",
      hasBiologicalSignals: false,
      hasGeologicalSignals: false,
      slots: { space: 1, ground: 3, asteroid: 0 },
      presentFacilities: { space: [{ building: "Government", demolishable: false }], ground: [] },
    });
    expect(eligibleBodiesForCombo("commodityHub", [touched])).toEqual([]);
  });

  it("includes a matching, untouched, big-enough body", () => {
    const body = makeBody({
      planetClass: "Rocky body",
      hasBiologicalSignals: false,
      hasGeologicalSignals: false,
      slots: { space: 1, ground: 3, asteroid: 0 },
    });
    const result = eligibleBodiesForCombo("commodityHub", [body]);
    expect(result).toHaveLength(1);
    expect(result[0].groundSlotsNeeded).toBe(1);
  });
});

describe("pickBestFitBody", () => {
  it("returns null when nothing qualifies", () => {
    expect(pickBestFitBody("commodityHub", [])).toBeNull();
  });

  it("picks the eligible body with the fewest ground slots (least wasted capacity)", () => {
    const roomy = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false, slots: { space: 1, ground: 6, asteroid: 0 } });
    const tight = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false, slots: { space: 1, ground: 1, asteroid: 0 } });
    const best = pickBestFitBody("commodityHub", [roomy, tight]);
    expect(best?.body.bodyId).toBe(tight.bodyId);
  });

  it("prefers a smaller-but-sufficient HMC body over a larger Rocky body for the manufacturingHub combo", () => {
    const rocky = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false, slots: { space: 1, ground: 10, asteroid: 0 } });
    const hmc = makeBody({ planetClass: "High metal content body", slots: { space: 1, ground: 5, asteroid: 0 } });
    const best = pickBestFitBody("manufacturingHub", [rocky, hmc]);
    expect(best?.body.bodyId).toBe(hmc.bodyId);
  });
});

describe("forcedBuildingsForCombo", () => {
  it("returns [] when no body currently qualifies", () => {
    expect(forcedBuildingsForCombo("commodityHub", [])).toEqual([]);
  });

  it("forces just the outpost (no Refinery Hub entry) for a clean Rocky body's commodityHub combo", () => {
    const body = makeBody({ planetClass: "Rocky body", hasBiologicalSignals: false, hasGeologicalSignals: false, slots: { space: 1, ground: 1, asteroid: 0 } });
    expect(forcedBuildingsForCombo("commodityHub", [body])).toEqual([
      { bodyId: body.bodyId, building: "Civilian_Planetary_Outpost", count: 1 },
    ]);
  });

  it("forces the outpost plus 4 Refinery Hubs for the manufacturingHub combo", () => {
    const body = makeBody({ planetClass: "High metal content body", slots: { space: 1, ground: 5, asteroid: 0 } });
    expect(forcedBuildingsForCombo("manufacturingHub", [body])).toEqual([
      { bodyId: body.bodyId, building: "Scientific_Planetary_Outpost", count: 1 },
      { bodyId: body.bodyId, building: "Refinery_Hub", count: 4 },
    ]);
  });
});
