import { describe, expect, it } from "vitest";
import { estimateBodySlots } from "./eligibility";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { parseJournalScans } from "./parser";

describe("estimateBodySlots", () => {
  it("gives one orbital slot per body, no asteroid eligibility on a STAR's own slot, and formula-based ground slots", () => {
    const [system] = parseJournalScans(FIXTURE);

    // A star's own orbital slot is never asteroid-eligible — its belt is its own separate "ring"
    // body instead (see the dedicated test below).
    const star = system.bodies.find((b) => b.bodyName === "Test System A")!;
    expect(estimateBodySlots(star).slots).toEqual({ space: 1, ground: 0, asteroid: 0 });

    // Landable rocky body (600km -> tier 1) with an atmosphere -> 1 + 2 = 3 ground slots.
    const rocky = system.bodies.find((b) => b.bodyName === "Test System A 2")!;
    expect(estimateBodySlots(rocky).slots).toEqual({ space: 1, ground: 3, asteroid: 0 });

    // Landable HMC body (3200km -> tier 2, no atmosphere) -> 2 + 1 (HMC) = 3 ground slots.
    const hmc = system.bodies.find((b) => b.bodyName === "Test System A 3")!;
    expect(estimateBodySlots(hmc).slots).toEqual({ space: 1, ground: 3, asteroid: 0 });
  });

  it("gives a non-landable body zero ground slots regardless of size, but keeps its OWN ring-presence asteroid eligibility (planet, not star)", () => {
    const [system] = parseJournalScans(FIXTURE);
    const gasGiant = system.bodies.find((b) => b.bodyName === "Test System A 1")!;
    expect(estimateBodySlots(gasGiant).slots.ground).toBe(0);
    // Unlike a star's belt, a ringed PLANET's own slot stays asteroid-eligible directly — this
    // app's original (pre-2026-07-27) behavior, deliberately unchanged (user-clarified scope).
    expect(estimateBodySlots(gasGiant).slots.asteroid).toBe(1);
  });

  it("gives a synthetic star-belt body exactly one asteroid-eligible orbital slot", () => {
    const [system] = parseJournalScans(FIXTURE);
    const ring = system.bodies.find((b) => b.bodyName === "Test System A A Ring")!;
    expect(ring.kind).toBe("ring");
    expect(estimateBodySlots(ring).slots).toEqual({ space: 1, ground: 0, asteroid: 1 });
  });

  it("does NOT synthesize a separate ring body for a planet's own ring", () => {
    const [system] = parseJournalScans(FIXTURE);
    expect(system.bodies.find((b) => b.bodyName === "Test System A 1 A Ring")).toBeUndefined();
  });

  it("gives zero ground slots to a landable body over the temperature or gravity cap", () => {
    const [system] = parseJournalScans(FIXTURE);
    const rocky = system.bodies.find((b) => b.bodyName === "Test System A 2")!;

    const tooHot = { ...rocky, surfaceTemperature: 700 };
    expect(estimateBodySlots(tooHot).slots.ground).toBe(0);

    const tooHeavy = { ...rocky, surfaceGravity: 2.7 };
    expect(estimateBodySlots(tooHeavy).slots.ground).toBe(0);
  });

  it("caps ground slots at 7 even when every bonus applies", () => {
    const [system] = parseJournalScans(FIXTURE);
    const hmc = system.bodies.find((b) => b.bodyName === "Test System A 3")!;
    // Top radius tier (4) + atmosphere (+2) + terraformable (+1) + HMC (+1) + geological signals
    // (+1) = 9, capped to 7.
    const maxedOut = {
      ...hmc,
      radius: 7_000_000,
      atmosphere: "thin nitrogen atmosphere",
      terraformState: "Terraformable",
      hasGeologicalSignals: true,
    };
    expect(estimateBodySlots(maxedOut).slots.ground).toBe(7);
  });

  it("adds 1 ground slot for a body with FSSBodySignals-reported geological signals", () => {
    const [system] = parseJournalScans(FIXTURE);
    const rocky = system.bodies.find((b) => b.bodyName === "Test System A 2")!;
    // Baseline (tier 1 + atmosphere) is 3, per the first test above.
    expect(estimateBodySlots(rocky).slots.ground).toBe(3);
    expect(estimateBodySlots({ ...rocky, hasGeologicalSignals: true }).slots.ground).toBe(4);
    // Explicitly-false (FSS-signal-scanned, confirmed absent) or unset both contribute nothing.
    expect(estimateBodySlots({ ...rocky, hasGeologicalSignals: false }).slots.ground).toBe(3);
  });
});
