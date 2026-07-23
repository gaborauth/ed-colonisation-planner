import { describe, expect, it } from "vitest";
import loadHighs from "highs";

describe("highs wasm smoke test", () => {
  it("solves a trivial integer LP via the LP-format text API", async () => {
    const highs = await loadHighs();
    const lp = `Maximize
 obj: 30 chairs + 50 tables
Subject To
 carpentry: chairs + 2 tables <= 40
 finishing: 2 chairs + tables <= 50
Bounds
 chairs >= 0
 tables >= 0
Generals
 chairs tables
End`;
    const result = highs.solve(lp, { output_flag: false });
    expect(result.Status).toBe("Optimal");
    // c=20, t=10 -> 30*20 + 50*10 = 1100
    expect(result.ObjectiveValue).toBeCloseTo(1100, 3);
  });
});
