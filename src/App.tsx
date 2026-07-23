import { useReducer, useState } from "react";
import { BuildOrderPanel } from "./components/BuildOrderPanel";
import { BuildingsTable } from "./components/BuildingsTable";
import { ConstraintsPanel } from "./components/ConstraintsPanel";
import { JournalImportPanel } from "./components/JournalImportPanel";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { SavedPlansPanel } from "./components/SavedPlansPanel";
import { SystemConfigPanel } from "./components/SystemConfigPanel";
import type { SavedPlan } from "./persistence/plans";
import { solve, type SolverInput } from "./solver/solve";
import {
  INITIAL_FORM_STATE,
  INITIAL_RESULT_STATE,
  plannerReducer,
  type PlannerResultState,
} from "./state/plannerState";

function buildSolverInput(formState: typeof INITIAL_FORM_STATE): SolverInput {
  return {
    slots: formState.slots,
    objective:
      formState.objectiveMode === "simple"
        ? { kind: "simple", score: formState.simpleScore }
        : { kind: "custom", expression: formState.customExpression, direction: formState.customDirection },
    initialT2Points: formState.initialT2Points,
    initialT3Points: formState.initialT3Points,
    chooseFirstStation: formState.chooseFirstStation,
    firstStationBuilding: formState.firstStationBuilding || undefined,
    firstStationOptions: formState.firstStationOptions,
    allowCriminal: formState.allowCriminal,
    alreadyPresent: formState.alreadyPresent,
    constraints: { atLeast: formState.atLeast, atMost: formState.atMost },
    scoreConstraints: { min: formState.scoreMin, max: formState.scoreMax },
  };
}

function App() {
  const [formState, dispatch] = useReducer(plannerReducer, INITIAL_FORM_STATE);
  const [resultState, setResultState] = useState<PlannerResultState>(INITIAL_RESULT_STATE);
  const [systemName, setSystemName] = useState("");
  const [planName, setPlanName] = useState("");

  async function handleSolve(): Promise<void> {
    setResultState({ status: "solving", result: null, message: null });
    try {
      const result = await solve(buildSolverInput(formState));
      if (result.status === "optimal") {
        setResultState({ status: "done", result, message: null });
      } else {
        setResultState({ status: "error", result: null, message: result.message ?? "Unknown error" });
      }
    } catch (e) {
      setResultState({ status: "error", result: null, message: (e as Error).message });
    }
  }

  function handleLoad(plan: SavedPlan): void {
    dispatch({ type: "load", state: plan.formState });
    setSystemName(plan.systemName);
    setPlanName(plan.planName);
    setResultState(plan.result ? { status: "done", result: plan.result, message: null } : INITIAL_RESULT_STATE);
  }

  return (
    <main>
      <h1>Elite Dangerous Colonisation Planner</h1>

      <JournalImportPanel dispatch={dispatch} />
      <SystemConfigPanel formState={formState} dispatch={dispatch} />
      <ObjectivePanel formState={formState} dispatch={dispatch} />
      <ConstraintsPanel formState={formState} dispatch={dispatch} />
      <BuildingsTable formState={formState} dispatch={dispatch} result={resultState.result} />

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="primary" onClick={() => void handleSolve()} disabled={resultState.status === "solving"}>
          {resultState.status === "solving" ? "Solving…" : "Solve for a system"}
        </button>
      </div>

      {resultState.status === "solving" && <div className="status-banner loading">Running the solver…</div>}
      {resultState.status === "error" && <div className="status-banner">{resultState.message}</div>}
      {resultState.status === "done" && resultState.result && (
        <>
          <ResultsPanel result={resultState.result} />
          <BuildOrderPanel formState={formState} result={resultState.result} />
        </>
      )}

      <SavedPlansPanel
        systemName={systemName}
        planName={planName}
        onSystemNameChange={setSystemName}
        onPlanNameChange={setPlanName}
        formState={formState}
        result={resultState.result}
        onLoad={handleLoad}
      />
    </main>
  );
}

export default App;
