import { describe, expect, it } from "vitest";
import { SystemState } from "./systemState";

describe("SystemState.canBuild", () => {
  it("is blocked by an unmet dependency even with ample construction points", () => {
    const state = new SystemState();
    state.T2points = 5;
    state.T3points = 5;
    expect(state.canBuild("Military")).toBe(false);
    state.addBuilding("Small_Military_Settlement", 1);
    expect(state.canBuild("Military")).toBe(true);
  });

  it("is blocked by insufficient construction points regardless of dependencies", () => {
    const state = new SystemState();
    // Military costs 1 T2 point (T2points: -1) and has no points banked yet.
    expect(state.canBuild("Military")).toBe(false);
  });

  it("tier-1 buildings (which grant points) are always affordable", () => {
    const state = new SystemState();
    expect(state.canBuild("Small_Military_Settlement")).toBe(true);
  });
});

describe("SystemState port cost escalation", () => {
  it("charges the FDEV-confirmed 3,3,5 T2 curve for successive Coriolis builds", () => {
    const state = new SystemState();
    state.T2points = 100;
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(97);
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(94);
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(89);
  });
});

describe("SystemState.addFirstStation", () => {
  it("does not add the first station to facilities/ports, only its score/point effects", () => {
    const state = new SystemState();
    state.addFirstStation("Coriolis");
    expect(state.ports).toEqual([]);
    expect(state.facilities.size).toBe(0);
    expect(state.firstStation).toBe("Coriolis");
    // Coriolis: T2points === "port" (skipped), T3points === 1 (granted).
    expect(state.T2points).toBe(0);
    expect(state.T3points).toBe(1);
  });

  it("throws if a first station is set twice", () => {
    const state = new SystemState();
    state.addFirstStation("Coriolis");
    expect(() => state.addFirstStation("Orbis_or_Ocellus")).toThrow();
  });
});

describe("SystemState slot tracking", () => {
  it("counts an Asteroid_Base against both the space and asteroid slot pools", () => {
    const state = new SystemState();
    state.T2points = 100;
    state.addBuilding("Asteroid_Base", 1);
    expect(state.slotsUsed.space).toBe(1);
    expect(state.slotsUsed.asteroid).toBe(1);
  });
});

describe("SystemState score accumulation", () => {
  it("sums base scores linearly and recomputes the compound score", () => {
    const state = new SystemState();
    state.addBuilding("Commercial_Outpost", 2); // wealth 3, sol 5, sec -1 each
    expect(state.scores.wealth).toBe(6);
    expect(state.scores.standard_of_living).toBe(10);
    expect(state.scores.security).toBe(-2);
    expect(state.scores.system_score_beta).toBe(
      state.scores.security + state.scores.tech_level + state.scores.wealth + state.scores.standard_of_living,
    );
  });
});
