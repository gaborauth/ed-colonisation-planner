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

describe("SystemState.canDemolish/removeBuilding", () => {
  it("is safe to demolish a generator exactly down to zero", () => {
    const state = new SystemState();
    state.addBuilding("Small_Military_Settlement", 1); // T2points: 1, generates +1 T2
    expect(state.T2points).toBe(1);
    expect(state.canDemolish("Small_Military_Settlement")).toBe(true);
    state.removeBuilding("Small_Military_Settlement");
    expect(state.T2points).toBe(0);
  });

  it("is blocked when demolishing a generator would take the total negative", () => {
    const state = new SystemState();
    state.addBuilding("Small_Military_Settlement", 1); // T2points: 1 -> T2 = 1
    state.addBuilding("Military", 1); // Military costs 1 T2 (t2: -1) -> T2 = 0
    expect(state.T2points).toBe(0);
    // Demolishing the settlement that funded Military would leave T2 at -1.
    expect(state.canDemolish("Small_Military_Settlement")).toBe(false);
  });
});

describe("SystemState port cost escalation", () => {
  // Corrected 2026-07-24 along with data/buildings.ts's getT2PortCost/getT3PortCost fix — see
  // that function's doc comment. Curve is 3,5,7,... (never repeats its first value).
  it("charges the confirmed 3,5,7 T2 curve for successive Coriolis builds", () => {
    const state = new SystemState();
    state.T2points = 100;
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(97);
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(92);
    state.addBuilding("Coriolis", 1);
    expect(state.T2points).toBe(85);
  });

  // Real bug found 2026-07-26 via a real exported system (jsons/swoilz-aw-c-d52.json, not
  // committed) that already had both a Coriolis (Tier-2-cost) and an Orbis_or_Ocellus
  // (Tier-3-cost) port present: an earlier version of `constructionPoints` used one shared
  // `this.ports.length` counter for BOTH tiers' escalation sequences, so building a Tier-3-cost
  // port after a Tier-2-cost one over-charged it as if it were a LATER Tier-3-cost port than it
  // actually is — inflated enough, compounded over several more ports, to make
  // `computeFeasibleOrder` (ordering.ts) wrongly throw "Could not finish ordering" for a plan
  // solve.ts had already confirmed was T2/T3-feasible. Tier-2-cost and Tier-3-cost ports must
  // escalate independently — same rule `presentFacilities.ts`'s `computePresentPortsSeed` already
  // gets right (real-game-confirmed, see its own doc comment) via separate t2Index/t3Index.
  it("escalates Tier-2-cost and Tier-3-cost ports along independent sequences", () => {
    const state = new SystemState();
    state.T2points = 100;
    state.T3points = 100;
    state.addBuilding("Coriolis", 1); // Tier-2-cost: costs getT2PortCost(0) = 3, grants T3points: 1.
    expect(state.T2points).toBe(97);
    expect(state.T3points).toBe(101);
    // Orbis_or_Ocellus is the FIRST Tier-3-cost port ever built here — Coriolis being present
    // must not push it to getT3PortCost(1) = 12; it should cost getT3PortCost(0) = 6.
    state.addBuilding("Orbis_or_Ocellus", 1);
    expect(state.T3points).toBe(95);
    // A second Tier-2-cost port still only counts prior Tier-2-cost ports (1), unaffected by the
    // Tier-3-cost port built in between: getT2PortCost(1) = 5.
    state.addBuilding("Asteroid_Base", 1);
    expect(state.T2points).toBe(92);
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
