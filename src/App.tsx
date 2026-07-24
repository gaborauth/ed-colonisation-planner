import { useReducer, useState } from "react";
import { BuildOrderPanel } from "./components/BuildOrderPanel";
import { BuildingsTable } from "./components/BuildingsTable";
import { ConstraintsPanel } from "./components/ConstraintsPanel";
import { JournalImportPanel } from "./components/JournalImportPanel";
import { LinksPanel } from "./components/LinksPanel";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { PopulationEstimatePanel } from "./components/PopulationEstimatePanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { SavedPlansPanel } from "./components/SavedPlansPanel";
import { SystemConfigPanel } from "./components/SystemConfigPanel";
import { normalizeFacilitySlots } from "./domain/presentFacilities";
import type { SavedPlan } from "./persistence/plans";
import { solve, type SolverBody, type SolverInput } from "./solver/solve";
import {
  INITIAL_FORM_STATE,
  INITIAL_RESULT_STATE,
  plannerReducer,
  type PlannerResultState,
} from "./state/plannerState";

function buildSolverInput(formState: typeof INITIAL_FORM_STATE): SolverInput {
  // `formState.bodies` is only non-empty once the user has applied a journal-imported body
  // layout — omitting `bodies` entirely (not passing `[]`) keeps aggregate mode's exact behavior
  // for anyone who's only ever used the System facilities panel's plain slot-count fields.
  const hasBodies = formState.bodies.length > 0;
  const bodies: SolverBody[] | undefined = hasBodies
    ? formState.bodies.map((b) => {
        const slots = b.slots ?? { space: 0, ground: 0, asteroid: 0 };
        return {
          bodyId: b.bodyId,
          slots,
          presentFacilities: {
            space: normalizeFacilitySlots(b.presentFacilities?.space, slots.space),
            ground: normalizeFacilitySlots(b.presentFacilities?.ground, slots.ground),
          },
        };
      })
    : undefined;
  return {
    slots: formState.slots,
    bodies,
    objective:
      formState.objectiveMode === "simple"
        ? { kind: "simple", score: formState.simpleScore }
        : { kind: "custom", expression: formState.customExpression, direction: formState.customDirection },
    firstStationBuilding: formState.firstStationBuilding,
    firstStationBodyId: formState.firstStationBodyId,
    allowCriminal: formState.allowCriminal,
    // When bodies are used, already-present accounting flows entirely through each body's
    // `presentFacilities` instead (see SolverInput.alreadyPresent's doc comment) — passing the
    // flat map too would double-count.
    alreadyPresent: hasBodies ? {} : formState.alreadyPresent,
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
        <button
          type="button"
          className="primary"
          onClick={() => void handleSolve()}
          disabled={resultState.status === "solving" || !formState.firstStationBuilding}
          title={!formState.firstStationBuilding ? "Pick a primary station in System facilities first" : undefined}
        >
          {resultState.status === "solving" ? "Solving…" : "Solve for a system"}
        </button>
      </div>

      {resultState.status === "solving" && <div className="status-banner loading">Running the solver…</div>}
      {resultState.status === "error" && <div className="status-banner">{resultState.message}</div>}
      {resultState.status === "done" && resultState.result && (
        <>
          <ResultsPanel result={resultState.result} />
          <BuildOrderPanel formState={formState} result={resultState.result} />
          <LinksPanel formState={formState} result={resultState.result} />
          <PopulationEstimatePanel result={resultState.result} />
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
