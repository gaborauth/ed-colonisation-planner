import { describe, expect, it } from "vitest";
import { estimateBodySlots } from "./eligibility";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { parseJournalScans } from "./parser";

describe("estimateBodySlots", () => {
  it("gives one orbital slot per body, ring-presence asteroid eligibility, and formula-based ground slots", () => {
    const [system] = parseJournalScans(FIXTURE);

    const star = system.bodies.find((b) => b.bodyName === "Test System A")!;
    expect(estimateBodySlots(star).slots).toEqual({ space: 1, ground: 0, asteroid: 1 });

    // Landable rocky body (600km -> tier 1) with an atmosphere -> 1 + 2 = 3 ground slots.
    const rocky = system.bodies.find((b) => b.bodyName === "Test System A 2")!;
    expect(estimateBodySlots(rocky).slots).toEqual({ space: 1, ground: 3, asteroid: 0 });

    // Landable HMC body (3200km -> tier 2, no atmosphere) -> 2 + 1 (HMC) = 3 ground slots.
    const hmc = system.bodies.find((b) => b.bodyName === "Test System A 3")!;
    expect(estimateBodySlots(hmc).slots).toEqual({ space: 1, ground: 3, asteroid: 0 });
  });

  it("gives a non-landable body zero ground slots regardless of size", () => {
    const [system] = parseJournalScans(FIXTURE);
    const gasGiant = system.bodies.find((b) => b.bodyName === "Test System A 1")!;
    expect(estimateBodySlots(gasGiant).slots.ground).toBe(0);
    // Still eligible for an asteroid base from its ring.
    expect(estimateBodySlots(gasGiant).slots.asteroid).toBe(1);
  });

  it("caps asteroid eligibility at 1 (yes/no) regardless of ring count", () => {
    const [system] = parseJournalScans(FIXTURE);
    const gasGiant = system.bodies.find((b) => b.bodyName === "Test System A 1")!;
    const withTwoRings = { ...gasGiant, rings: [...gasGiant.rings, gasGiant.rings[0]] };
    expect(estimateBodySlots(withTwoRings).slots.asteroid).toBe(1);
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
    // Top radius tier (4) + atmosphere (+2) + terraformable (+1) + HMC (+1) = 8, capped to 7.
    const maxedOut = {
      ...hmc,
      radius: 7_000_000,
      atmosphere: "thin nitrogen atmosphere",
      terraformState: "Terraformable",
    };
    expect(estimateBodySlots(maxedOut).slots.ground).toBe(7);
  });
});
