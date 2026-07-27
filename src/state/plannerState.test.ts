import { describe, expect, it } from "vitest";
import { INITIAL_FORM_STATE, plannerReducer } from "./plannerState";

describe("plannerReducer", () => {
  it("patch merges top-level fields shallowly", () => {
    const next = plannerReducer(INITIAL_FORM_STATE, { type: "patch", patch: { allowCriminal: false } });
    expect(next.allowCriminal).toBe(false);
    expect(next.slots).toBe(INITIAL_FORM_STATE.slots); // untouched fields keep identity
  });

  it("setMapEntry adds a positive value and removes the key when set to 0 or undefined", () => {
    let state = plannerReducer(INITIAL_FORM_STATE, {
      type: "setMapEntry",
      map: "alreadyPresent",
      name: "Coriolis",
      value: 3,
    });
    expect(state.alreadyPresent).toEqual({ Coriolis: 3 });

    state = plannerReducer(state, { type: "setMapEntry", map: "alreadyPresent", name: "Coriolis", value: 0 });
    expect(state.alreadyPresent).toEqual({});

    state = plannerReducer(state, {
      type: "setMapEntry",
      map: "alreadyPresent",
      name: "Coriolis",
      value: 2,
    });
    state = plannerReducer(state, {
      type: "setMapEntry",
      map: "alreadyPresent",
      name: "Coriolis",
      value: undefined,
    });
    expect(state.alreadyPresent).toEqual({});
  });

  it("setMapEntry keeps an explicit 0 for atMost (a real 'build none' cap, unlike alreadyPresent/atLeast)", () => {
    let state = plannerReducer(INITIAL_FORM_STATE, {
      type: "setMapEntry",
      map: "atMost",
      name: "Dodecahedron",
      value: 0,
    });
    expect(state.atMost).toEqual({ Dodecahedron: 0 });

    state = plannerReducer(state, { type: "setMapEntry", map: "atMost", name: "Dodecahedron", value: undefined });
    expect(state.atMost).toEqual({});
  });

  it("setScoreBound sets/clears a per-score min or max independently", () => {
    let state = plannerReducer(INITIAL_FORM_STATE, {
      type: "setScoreBound",
      bound: "scoreMin",
      score: "security",
      value: 5,
    });
    expect(state.scoreMin).toEqual({ security: 5 });
    expect(state.scoreMax).toEqual({});

    state = plannerReducer(state, {
      type: "setScoreBound",
      bound: "scoreMin",
      score: "security",
      value: undefined,
    });
    expect(state.scoreMin).toEqual({});
  });

  it("reset restores the initial state", () => {
    const changed = plannerReducer(INITIAL_FORM_STATE, { type: "patch", patch: { allowCriminal: false } });
    expect(plannerReducer(changed, { type: "reset" })).toEqual(INITIAL_FORM_STATE);
  });

  it("load replaces the entire state", () => {
    const custom = { ...INITIAL_FORM_STATE, simpleScore: "wealth" as const };
    expect(plannerReducer(INITIAL_FORM_STATE, { type: "load", state: custom })).toEqual(custom);
  });
});
