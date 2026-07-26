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

  it("builds a later, currently-affordable port before an earlier, not-yet-affordable one instead of throwing", () => {
    // Regression test for the extreme-demolition "Could not finish ordering" bug (see CLAUDE.md's
    // Gotchas + TASKS.md): the old algorithm only ever tried remainingPorts[0], so if the FIRST
    // port in the queue wasn't affordable yet, it gave up instead of checking whether a LATER port
    // in the same queue could be built first. Real building costs from data/buildings.ts:
    // getT2PortCost(0) === 3 (Coriolis's first-of-class cost), getT3PortCost(0) === 6
    // (Orbis_or_Ocellus's first-of-class cost) — and Coriolis carries a flat, non-escalating
    // `t3: 1` alongside its escalating T2 cost, so building it also generates one T3 point as a
    // side effect.
    const state = new SystemState();
    state.T2points = 3; // exactly enough for Coriolis (getT2PortCost(0))
    state.T3points = 5; // one short of Orbis_or_Ocellus's cost (getT3PortCost(0) === 6)

    // Orbis_or_Ocellus is listed FIRST but isn't affordable yet; Coriolis is listed second, is
    // affordable now, and its flat +1 T3 exactly funds Orbis_or_Ocellus afterward.
    const order = computeFeasibleOrder(state, {}, ["Orbis_or_Ocellus", "Coriolis"]);

    expect(order).toEqual(["Coriolis", "Orbis_or_Ocellus"]);
    expect(state.T2points).toBe(0);
    expect(state.T3points).toBe(0);
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
