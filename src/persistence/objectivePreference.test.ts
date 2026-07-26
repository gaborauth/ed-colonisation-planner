// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_FORM_STATE } from "../state/plannerState";
import { applyStoredObjectivePreference, getObjectivePreference, setObjectivePreference } from "./objectivePreference";

beforeEach(() => {
  localStorage.clear();
});

describe("objective preference persistence", () => {
  it("returns null when nothing has ever been saved", () => {
    expect(getObjectivePreference()).toBeNull();
  });

  it("round-trips a saved preference", () => {
    setObjectivePreference({
      objectiveMode: "simple",
      simpleScore: "wealth",
      customExpression: "sqrt(w)",
      customDirection: "maximize",
    });
    expect(getObjectivePreference()).toEqual({
      objectiveMode: "simple",
      simpleScore: "wealth",
      customExpression: "sqrt(w)",
      customDirection: "maximize",
    });
  });

  it("applyStoredObjectivePreference leaves INITIAL_FORM_STATE untouched when nothing is stored", () => {
    expect(applyStoredObjectivePreference(INITIAL_FORM_STATE)).toEqual(INITIAL_FORM_STATE);
  });

  it("applyStoredObjectivePreference overlays only the objective fields, leaving the rest of the initial state alone", () => {
    setObjectivePreference({
      objectiveMode: "simple",
      simpleScore: "wealth",
      customExpression: "sqrt(w)",
      customDirection: "maximize",
    });
    const result = applyStoredObjectivePreference(INITIAL_FORM_STATE);
    expect(result.objectiveMode).toBe("simple");
    expect(result.simpleScore).toBe("wealth");
    expect(result.starSystem).toBe(INITIAL_FORM_STATE.starSystem);
    expect(result.bodies).toBe(INITIAL_FORM_STATE.bodies);
  });
});
