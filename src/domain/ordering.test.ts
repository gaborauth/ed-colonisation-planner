import { describe, expect, it } from "vitest";
import { SystemState } from "./systemState";
import { computeFeasibleOrder, getMixedOrderingFromResult } from "./ordering";

describe("computeFeasibleOrder", () => {
  it("builds the dependency-unlocking settlement before the building that needs it", () => {
    const state = new SystemState();
    const order = computeFeasibleOrder(state, { Small_Military_Settlement: 1, Military: 1 }, []);
    expect(order).toEqual(["Small_Military_Settlement", "Military"]);
  });

  it("throws when a dependency can never be satisfied from the given facility bag", () => {
    const state = new SystemState();
    expect(() => computeFeasibleOrder(state, { Military: 1 }, [])).toThrow(
      "Could not finish ordering",
    );
  });

  it("does not mutate the caller's ports array", () => {
    const state = new SystemState();
    state.T2points = 100;
    const ports = ["Coriolis"];
    computeFeasibleOrder(state, {}, ports);
    expect(ports).toEqual(["Coriolis"]);
  });

  it("places a first station first and does not re-list it among built facilities", () => {
    const state = new SystemState();
    const order = computeFeasibleOrder(state, {}, [], "Coriolis");
    expect(order).toEqual(["Coriolis"]);
    expect(state.firstStation).toBe("Coriolis");
  });
});

describe("getMixedOrderingFromResult", () => {
  it("interleaves already-present and solution facilities into one feasible order", () => {
    const order = getMixedOrderingFromResult({
      first_station: "Coriolis",
      already_present: { Small_Military_Settlement: 1 },
      solution: { to_build: { Military: 1 } },
    });
    expect(order[0]).toBe("Coriolis");
    expect(order.indexOf("Small_Military_Settlement")).toBeLessThan(order.indexOf("Military"));
  });
});
