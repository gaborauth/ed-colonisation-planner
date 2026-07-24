import { describe, expect, it } from "vitest";
import { estimateIllustrativePopulationCurve } from "./populationEstimate";

describe("estimateIllustrativePopulationCurve", () => {
  it("is monotonically non-decreasing", () => {
    const curve = estimateIllustrativePopulationCurve(2, 20, 12);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].estimatedPopulation).toBeGreaterThanOrEqual(curve[i - 1].estimatedPopulation);
    }
  });

  it("starts at the initial score and approaches (but never quite reaches) the max score", () => {
    const curve = estimateIllustrativePopulationCurve(2, 20, 12);
    expect(curve[0].estimatedPopulation).toBe(2);
    expect(curve[curve.length - 1].estimatedPopulation).toBeLessThan(20);
    expect(curve[curve.length - 1].estimatedPopulation).toBeGreaterThan(15);
  });

  it("grows faster in the first weeks than in later weeks (shape check only, not a value check)", () => {
    const curve = estimateIllustrativePopulationCurve(0, 100, 12);
    const earlyGrowth = curve[1].estimatedPopulation - curve[0].estimatedPopulation;
    const lateGrowth = curve[12].estimatedPopulation - curve[11].estimatedPopulation;
    expect(earlyGrowth).toBeGreaterThan(lateGrowth);
  });

  it("handles a zero gap (max already equals initial) without producing NaN", () => {
    const curve = estimateIllustrativePopulationCurve(5, 5, 4);
    expect(curve.every((c) => c.estimatedPopulation === 5)).toBe(true);
  });

  it("clamps a max score below the initial score up to initial (never decreasing)", () => {
    const curve = estimateIllustrativePopulationCurve(10, 3, 4);
    expect(curve.every((c) => c.estimatedPopulation === 10)).toBe(true);
  });
});
