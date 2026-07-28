// Client-side plan persistence, replacing extract.py's SaveFile (a JSON file on disk) with
// localStorage — "stateless" here means no backend/server state, not no persistence at all.

import type { PlannerFormState } from "../state/plannerState";
import type { SolverResult } from "../solver/solve";

const STORAGE_KEY = "edcp:plans";

export interface SavedPlan {
  systemName: string;
  planName: string;
  savedAt: string;
  formState: PlannerFormState;
  result: SolverResult | null;
}

// system name -> plan name -> plan, mirroring extract.py's `{system: {plan_name: result}}` shape.
type PlanStore = Record<string, Record<string, SavedPlan>>;

function readStore(): PlanStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PlanStore;
  } catch {
    return {};
  }
}

function writeStore(store: PlanStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listPlans(): SavedPlan[] {
  const store = readStore();
  return Object.values(store)
    .flatMap((bySystem) => Object.values(bySystem))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function savePlan(
  systemName: string,
  planName: string,
  formState: PlannerFormState,
  result: SolverResult | null,
): SavedPlan {
  const store = readStore();
  const plan: SavedPlan = { systemName, planName, savedAt: new Date().toISOString(), formState, result };
  store[systemName] ??= {};
  store[systemName][planName] = plan;
  writeStore(store);
  return plan;
}

export function deletePlan(systemName: string, planName: string): void {
  const store = readStore();
  if (!store[systemName]) return;
  delete store[systemName][planName];
  if (Object.keys(store[systemName]).length === 0) delete store[systemName];
  writeStore(store);
}

export function exportPlanToJSON(plan: SavedPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function importPlanFromJSON(json: string): SavedPlan {
  const plan = JSON.parse(json) as SavedPlan;
  if (!plan.systemName || !plan.planName || !plan.formState) {
    throw new Error("Not a valid EDCPS plan file");
  }
  return plan;
}
