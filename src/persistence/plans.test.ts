// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_FORM_STATE } from "../state/plannerState";
import { deletePlan, exportPlanToJSON, importPlanFromJSON, listPlans, savePlan } from "./plans";

beforeEach(() => {
  localStorage.clear();
});

describe("plan persistence", () => {
  it("round-trips a saved plan through localStorage", () => {
    savePlan("HIP 48661", "Balanced", INITIAL_FORM_STATE, null);
    const plans = listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].systemName).toBe("HIP 48661");
    expect(plans[0].planName).toBe("Balanced");
    expect(plans[0].formState).toEqual(INITIAL_FORM_STATE);
  });

  it("overwrites a plan saved again under the same system+plan name", () => {
    savePlan("HIP 48661", "Balanced", INITIAL_FORM_STATE, null);
    savePlan("HIP 48661", "Balanced", { ...INITIAL_FORM_STATE, allowCriminal: false }, null);
    const plans = listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].formState.allowCriminal).toBe(false);
  });

  it("deletePlan removes only the targeted plan", () => {
    savePlan("System A", "Plan 1", INITIAL_FORM_STATE, null);
    savePlan("System A", "Plan 2", INITIAL_FORM_STATE, null);
    deletePlan("System A", "Plan 1");
    const plans = listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].planName).toBe("Plan 2");
  });

  it("exportPlanToJSON / importPlanFromJSON round-trip", () => {
    const plan = savePlan("System A", "Plan 1", INITIAL_FORM_STATE, null);
    const imported = importPlanFromJSON(exportPlanToJSON(plan));
    expect(imported).toEqual(plan);
  });

  it("importPlanFromJSON rejects malformed input", () => {
    expect(() => importPlanFromJSON(JSON.stringify({ foo: "bar" }))).toThrow("Not a valid EDCPS plan file");
  });
});
