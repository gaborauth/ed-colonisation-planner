// Remembers the "Objective" panel's own selection (mode + whichever score/expression/direction go
// with it) across sessions — same localStorage-backed "stateless (no backend), not state-free"
// spirit as plans.ts/consent.ts, but auto-persisted on every change instead of behind an explicit
// Save button, since there's no natural "save" action for a form field a user just wants remembered.
// Deliberately its own small store rather than folded into a general "remember all form state"
// feature — the rest of PlannerFormState (system layout, constraints, etc.) is scoped to one
// system/session and SHOULDN'T silently carry over to the next.

import type { Score } from "../data/buildings";
import type { Direction } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";

const STORAGE_KEY = "edcp:objective-preference";

export interface ObjectivePreference {
  objectiveMode: PlannerFormState["objectiveMode"];
  simpleScore: Score;
  customExpression: string;
  customDirection: Direction;
}

export function getObjectivePreference(): ObjectivePreference | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ObjectivePreference;
  } catch {
    return null;
  }
}

export function setObjectivePreference(pref: ObjectivePreference): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
}

/** Lazy `useReducer` initializer (see App.tsx) — a fresh session starts from `INITIAL_FORM_STATE`
 * (still "Complex score"/`DEFAULT_OBJECTIVE_EXPRESSION` the very first time this app is ever
 * opened, nothing stored yet), then overlays whatever objective fields were last saved on top,
 * leaving every other field (system layout, constraints, ...) untouched at its own default. */
export function applyStoredObjectivePreference(initial: PlannerFormState): PlannerFormState {
  const stored = getObjectivePreference();
  return stored ? { ...initial, ...stored } : initial;
}
