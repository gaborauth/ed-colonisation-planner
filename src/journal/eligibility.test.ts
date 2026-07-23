import { describe, expect, it } from "vitest";
import { estimateSlots } from "./eligibility";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { parseJournalScans } from "./parser";

describe("estimateSlots", () => {
  it("sums one orbital slot per body, ring-count asteroid slots, and radius-scaled ground slots", () => {
    const [system] = parseJournalScans(FIXTURE);
    const estimate = estimateSlots(system);

    // 4 bodies (1 star + 3 planets) -> 4 orbital slots.
    expect(estimate.space).toBe(4);
    // 2 rings (one on the star, one on the gas giant) -> 2 asteroid slots.
    expect(estimate.asteroid).toBe(2);
    // Landable rocky body (600km, mid tier) -> 2; landable HMC body (3200km, top tier) -> 3.
    expect(estimate.ground).toBe(5);
    expect(estimate.breakdown).toHaveLength(4);
  });

  it("gives a non-landable body zero ground slots regardless of size", () => {
    const [system] = parseJournalScans(FIXTURE);
    const estimate = estimateSlots(system);
    const gasGiantEntry = estimate.breakdown.find((b) => b.bodyName === "Test System A 1")!;
    expect(gasGiantEntry.ground).toBe(0);
  });
});
