import { ALL_SCORES, type Score } from "../data/buildings";
import type { Direction, FirstStationOptions, SlotAvailability, SolverResult } from "../solver/solve";

export interface PlannerFormState {
  slots: SlotAvailability;
  initialT2Points: number;
  initialT3Points: number;
  chooseFirstStation: boolean;
  firstStationBuilding: string;
  firstStationOptions: FirstStationOptions;
  allowCriminal: boolean;
  alreadyPresent: Record<string, number>;
  atLeast: Record<string, number>;
  atMost: Record<string, number>;
  objectiveMode: "simple" | "custom";
  simpleScore: Score;
  customExpression: string;
  customDirection: Direction;
  scoreMin: Partial<Record<Score, number>>;
  scoreMax: Partial<Record<Score, number>>;
}

export const INITIAL_FORM_STATE: PlannerFormState = {
  slots: { space: 0, ground: 0, asteroid: 0 },
  initialT2Points: 0,
  initialT3Points: 0,
  chooseFirstStation: true,
  firstStationBuilding: "",
  firstStationOptions: {
    allowCoriolis: true,
    allowAsteroidBase: true,
    allowOrbisOrOcellus: true,
    allowDodecahedron: true,
  },
  allowCriminal: true,
  alreadyPresent: {},
  atLeast: {},
  atMost: {},
  objectiveMode: "simple",
  simpleScore: "development_level",
  customExpression: "",
  customDirection: "maximize",
  scoreMin: {},
  scoreMax: {},
};

export type PlannerAction =
  | { type: "patch"; patch: Partial<PlannerFormState> }
  | { type: "setMapEntry"; map: "alreadyPresent" | "atLeast" | "atMost"; name: string; value: number | undefined }
  | { type: "setScoreBound"; bound: "scoreMin" | "scoreMax"; score: Score; value: number | undefined }
  | { type: "load"; state: PlannerFormState }
  | { type: "reset" };

function withMapEntry(
  map: Record<string, number>,
  name: string,
  value: number | undefined,
): Record<string, number> {
  const next = { ...map };
  if (value === undefined || value === 0) {
    delete next[name];
  } else {
    next[name] = value;
  }
  return next;
}

export function plannerReducer(state: PlannerFormState, action: PlannerAction): PlannerFormState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "setMapEntry":
      return { ...state, [action.map]: withMapEntry(state[action.map], action.name, action.value) };
    case "setScoreBound": {
      const next = { ...state[action.bound] };
      if (action.value === undefined) {
        delete next[action.score];
      } else {
        next[action.score] = action.value;
      }
      return { ...state, [action.bound]: next };
    }
    case "load":
      return action.state;
    case "reset":
      return INITIAL_FORM_STATE;
  }
}

export const ALL_SCORES_LIST: Score[] = ALL_SCORES;

export interface PlannerResultState {
  status: "idle" | "solving" | "done" | "error";
  result: SolverResult | null;
  message: string | null;
}

export const INITIAL_RESULT_STATE: PlannerResultState = {
  status: "idle",
  result: null,
  message: null,
};
