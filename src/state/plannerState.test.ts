import { describe, expect, it } from "vitest";
import type { JournalBody, PresentFacilitySlot } from "../journal/parser";
import { INITIAL_FORM_STATE, plannerReducer, type PlannerFormState } from "./plannerState";

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
    expect(state.scoreMax).toEqual({ security: 20 }); // INITIAL_FORM_STATE's own default, untouched by this scoreMin-only action

    state = plannerReducer(state, {
      type: "setScoreBound",
      bound: "scoreMin",
      score: "security",
      value: undefined,
    });
    expect(state.scoreMin).toEqual({});
  });

  it("setEconomyPreference sets/clears a per-economy preference independently", () => {
    let state = plannerReducer(INITIAL_FORM_STATE, {
      type: "setEconomyPreference",
      economy: "Military",
      value: "forbid",
    });
    expect(state.economyPreferences).toEqual({ Military: "forbid" });

    state = plannerReducer(state, { type: "setEconomyPreference", economy: "Agriculture", value: 150 });
    expect(state.economyPreferences).toEqual({ Military: "forbid", Agriculture: 150 });

    state = plannerReducer(state, { type: "setEconomyPreference", economy: "Military", value: undefined });
    expect(state.economyPreferences).toEqual({ Agriculture: 150 });
  });

  it("setSlotBlocked sets/clears/pads a body's blocked-slot array", () => {
    const body: JournalBody = {
      bodyName: "Test 1",
      bodyId: 1,
      kind: "planet",
      landable: false,
      parents: [],
      rings: [],
      slots: { space: 2, ground: 0, asteroid: 0 },
      raw: {},
    };
    const withBodies = { ...INITIAL_FORM_STATE, bodies: [body] };

    let state = plannerReducer(withBodies, { type: "setSlotBlocked", bodyId: 1, kind: "space", index: 1, blocked: true });
    expect(state.bodies[0].blockedSlots?.space).toEqual([false, true]);
    // Other kind/body untouched.
    expect(state.bodies[0].blockedSlots?.ground).toEqual([]);

    state = plannerReducer(state, { type: "setSlotBlocked", bodyId: 1, kind: "space", index: 1, blocked: false });
    expect(state.bodies[0].blockedSlots?.space).toEqual([false, false]);
  });

  it("load defaults economyPreferences to {} for a plan saved before it existed", () => {
    // Same shim style as `bodies ?? []`/`systemAddress ?? null` for older SavedPlan shapes — see
    // plannerState.ts's `load` case.
    const { economyPreferences: _drop, ...withoutPreferences } = INITIAL_FORM_STATE;
    const state = plannerReducer(INITIAL_FORM_STATE, {
      type: "load",
      state: withoutPreferences as PlannerFormState,
    });
    expect(state.economyPreferences).toEqual({});
  });

  it("load migrates a plan saved with the old Must/Want/Don't want/Forbid string values onto the new 0-200 scale", () => {
    const legacy = {
      ...INITIAL_FORM_STATE,
      economyPreferences: {
        Military: "forbid",
        Agriculture: "want",
        Industrial: "dont_want",
        Extraction: "must",
        // Already-new-shape values (a plan saved after this migration shipped) pass through untouched.
        Tourism: 175,
      },
    } as unknown as PlannerFormState;
    const state = plannerReducer(INITIAL_FORM_STATE, { type: "load", state: legacy });
    expect(state.economyPreferences).toEqual({
      Military: "forbid",
      Agriculture: 100,
      Industrial: 25,
      Extraction: 175,
      Tourism: 175,
    });
  });

  it("load defaults systemResourceLevel to 'pristine' for a plan saved before it existed", () => {
    const { systemResourceLevel: _drop, ...withoutResourceLevel } = INITIAL_FORM_STATE;
    const state = plannerReducer(INITIAL_FORM_STATE, {
      type: "load",
      state: withoutResourceLevel as PlannerFormState,
    });
    expect(state.systemResourceLevel).toBe("pristine");
  });

  it("load re-detects systemResourceLevel from real per-body reserveLevel data for a plan saved before the field existed", () => {
    const ringedBody: JournalBody = {
      bodyName: "Test 1",
      bodyId: 1,
      kind: "planet",
      landable: false,
      parents: [],
      rings: [{ name: "r", ringClass: "eRingClass_MetalRich", massMT: 1 }],
      reserveLevel: "MajorResources",
      slots: { space: 1, ground: 0, asteroid: 0 },
      raw: {},
    };
    const { systemResourceLevel: _drop, ...withoutResourceLevel } = { ...INITIAL_FORM_STATE, bodies: [ringedBody] };
    const state = plannerReducer(INITIAL_FORM_STATE, {
      type: "load",
      state: withoutResourceLevel as PlannerFormState,
    });
    expect(state.systemResourceLevel).toBe("major");
  });

  it("load migrates the old 'system_score_beta' literal to 'system_score' in simpleScore/scoreMin/scoreMax", () => {
    const oldPlan: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      simpleScore: "system_score_beta" as PlannerFormState["simpleScore"],
      scoreMin: { system_score_beta: 5 } as PlannerFormState["scoreMin"],
      scoreMax: { system_score_beta: 50, security: 20 } as PlannerFormState["scoreMax"],
    };
    const state = plannerReducer(INITIAL_FORM_STATE, { type: "load", state: oldPlan });
    expect(state.simpleScore).toBe("system_score");
    expect(state.scoreMin).toEqual({ system_score: 5 });
    expect(state.scoreMax).toEqual({ system_score: 50, security: 20 });
  });

  it("load leaves an already-current simpleScore/scoreMin/scoreMax untouched", () => {
    const plan: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      simpleScore: "system_score",
      scoreMin: { system_score: 5 },
    };
    const state = plannerReducer(INITIAL_FORM_STATE, { type: "load", state: plan });
    expect(state.simpleScore).toBe("system_score");
    expect(state.scoreMin).toEqual({ system_score: 5 });
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

// A body's Orbital 1 slot can carry a stale, manually-entered facility from before that body was
// ever assigned as the primary station — invisible in the UI (which only stops rendering that
// slot, not clearing it) but still double-counted elsewhere unless reconciled. The primary's own
// `firstStation*` fields stay the actual source of truth; they get copied into a real, flagged
// `presentFacilities` entry (`primary: true`), reconciled after every action (not just the ones
// that touch these fields directly), so the invariant holds regardless of action path.
describe("plannerReducer's primary-slot reconciliation", () => {
  function makeBody(bodyId: number, space: (PresentFacilitySlot | null)[]): JournalBody {
    return {
      bodyName: `Test ${bodyId}`,
      bodyId,
      kind: "planet",
      landable: false,
      parents: [],
      rings: [],
      slots: { space: 2, ground: 0, asteroid: 0 },
      presentFacilities: { space, ground: [] },
      raw: {},
    };
  }

  it("syncs a real presentFacilities entry into the primary's assigned body when firstStationBodyId is patched", () => {
    const withBodies = { ...INITIAL_FORM_STATE, bodies: [makeBody(1, [null, null])] };
    const next = plannerReducer(withBodies, {
      type: "patch",
      patch: { firstStationBuilding: "Coriolis", firstStationBodyId: 1 },
    });
    expect(next.bodies[0].presentFacilities?.space[0]).toEqual({
      building: "Coriolis",
      demolishable: false,
      variant: undefined,
      customName: undefined,
      primary: true,
    });
  });

  it("overwrites a stale manually-entered facility left in Orbital 1 before that body became the primary", () => {
    const withBodies = {
      ...INITIAL_FORM_STATE,
      bodies: [makeBody(1, [{ building: "Commercial_Outpost", demolishable: false }, null])],
    };
    const next = plannerReducer(withBodies, {
      type: "patch",
      patch: { firstStationBuilding: "Coriolis", firstStationBodyId: 1 },
    });
    expect(next.bodies[0].presentFacilities?.space[0]).toEqual({
      building: "Coriolis",
      demolishable: false,
      variant: undefined,
      customName: undefined,
      primary: true,
    });
  });

  it("clears the stale primary:true entry on the OLD body once the primary moves to a different one", () => {
    const withPrimaryOnBody1 = plannerReducer(
      { ...INITIAL_FORM_STATE, bodies: [makeBody(1, [null]), makeBody(2, [null])] },
      { type: "patch", patch: { firstStationBuilding: "Coriolis", firstStationBodyId: 1 } },
    );
    expect(withPrimaryOnBody1.bodies[0].presentFacilities?.space[0]?.primary).toBe(true);

    const movedToBody2 = plannerReducer(withPrimaryOnBody1, { type: "patch", patch: { firstStationBodyId: 2 } });
    expect(movedToBody2.bodies[0].presentFacilities?.space[0]).toBeNull();
    expect(movedToBody2.bodies[1].presentFacilities?.space[0]?.primary).toBe(true);
  });

  it("reconciles an already-saved system loaded via 'load' too, even if it predates this feature", () => {
    // Simulates a real system saved BEFORE this sync existed: firstStationBuilding/BodyId are set,
    // but the body's own presentFacilities never got the synced entry — no separate migration step
    // needed, this reconciles it the moment it's loaded.
    const oldSavedState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      bodies: [makeBody(1, [null, null])],
      firstStationBuilding: "Coriolis",
      firstStationBodyId: 1,
    };
    const next = plannerReducer(INITIAL_FORM_STATE, { type: "load", state: oldSavedState });
    expect(next.bodies[0].presentFacilities?.space[0]).toEqual({
      building: "Coriolis",
      demolishable: false,
      variant: undefined,
      customName: undefined,
      primary: true,
    });
  });

  it("does nothing in aggregate mode (no bodies)", () => {
    const next = plannerReducer(INITIAL_FORM_STATE, {
      type: "patch",
      patch: { firstStationBuilding: "Coriolis" },
    });
    expect(next.bodies).toEqual([]);
  });
});
