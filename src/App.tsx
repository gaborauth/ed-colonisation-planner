import { useReducer, useState } from "react";
import { AboutHelpPanel } from "./components/AboutHelpPanel";
import { BuildOrderPanel } from "./components/BuildOrderPanel";
import { BuildingsTable } from "./components/BuildingsTable";
import { ConstraintsPanel } from "./components/ConstraintsPanel";
import { CookieConsentBanner } from "./components/CookieConsentBanner";
import { JournalImportPanel } from "./components/JournalImportPanel";
import { ObjectivePanel } from "./components/ObjectivePanel";
import { SavedPlansPanel } from "./components/SavedPlansPanel";
import { SolvedSystemPanel } from "./components/SolvedSystemPanel";
import { SystemConfigPanel } from "./components/SystemConfigPanel";
import { SystemPortabilityBar } from "./components/SystemPortabilityBar";
import { normalizeFacilitySlots } from "./domain/presentFacilities";
import { applyStoredObjectivePreference } from "./persistence/objectivePreference";
import type { SavedPlan } from "./persistence/plans";
import type { SolverBody, SolverInput } from "./solver/solve";
import { solveInWorker } from "./solver/solveInWorker";
import {
  INITIAL_FORM_STATE,
  INITIAL_RESULT_STATE,
  plannerReducer,
  type PlannerFormState,
  type PlannerResultState,
} from "./state/plannerState";

// Exported (not just an internal App.tsx helper) so `src/realSystems.test.ts` can build the exact
// same SolverInput a real "Solve for a system" click would, against real exported systems — see
// CLAUDE.md's "Testing conventions" note on jsons/*.json for why that matters (fidelity to the
// actual app pipeline, not a hand-rolled/potentially-drifted reconstruction of it).
export function buildSolverInput(formState: PlannerFormState): SolverInput {
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
          // Feeds solve.ts's economy_synergy term — see SolverBody.economy's doc comment.
          economy: b,
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
  const [formState, dispatch] = useReducer(plannerReducer, INITIAL_FORM_STATE, applyStoredObjectivePreference);
  const [resultState, setResultState] = useState<PlannerResultState>(INITIAL_RESULT_STATE);
  const [systemName, setSystemName] = useState("");
  const [planName, setPlanName] = useState("");
  // Bumped by SystemPortabilityBar after a successful import — JournalImportPanel keeps its own
  // copy of the saved-systems list in local state (loaded once at mount), so writing a fresh
  // system into localStorage from a sibling component wouldn't otherwise be noticed there.
  const [journalStoreVersion, setJournalStoreVersion] = useState(0);

  async function handleSolve(): Promise<void> {
    setResultState({ status: "solving", result: null, message: null });
    try {
      const result = await solveInWorker(buildSolverInput(formState));
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

  // A previously-solved result is keyed by the OLD system's bodies/bodyIds — applying a different
  // system (JournalImportPanel's "Apply", or SystemPortabilityBar's "Import system"/"Live Demo")
  // replaces `formState.bodies` wholesale, but a stale `resultState` doesn't clear itself, so the
  // "Solved system"/"Build order" panels (and BuildingsTable's per-building result column) kept
  // showing the PREVIOUS system's solved placements/scores overlaid on the newly-applied one — since
  // body ids are small per-system sequential numbers, a coincidental id match could make the stale
  // solve look like it belongs to the new system entirely (2026-07-26 user report: "the previous
  // solved facilities are not cleared and interfere with the new system"). Passed to both
  // components below so every system-loading path clears it, not just one.
  function handleSystemChanged(): void {
    setResultState(INITIAL_RESULT_STATE);
  }

  return (
    <>
      <CookieConsentBanner />
      <main>
        <h1>Elite Dangerous Colonisation Planner</h1>

        <SystemPortabilityBar
          formState={formState}
          dispatch={dispatch}
          onImported={() => setJournalStoreVersion((v) => v + 1)}
          onSystemChanged={handleSystemChanged}
        />

        <AboutHelpPanel />
        <JournalImportPanel dispatch={dispatch} refreshToken={journalStoreVersion} onSystemChanged={handleSystemChanged} />
        <SystemConfigPanel formState={formState} dispatch={dispatch} justSolved={resultState.result} />
        <ObjectivePanel
          formState={formState}
          dispatch={dispatch}
          onSolve={() => void handleSolve()}
          solving={resultState.status === "solving"}
        />

        {resultState.status === "solving" && <div className="status-banner loading">Running the solver…</div>}
        {resultState.status === "error" && <div className="status-banner">{resultState.message}</div>}

        <SolvedSystemPanel formState={formState} result={resultState.result} />
        <ConstraintsPanel formState={formState} dispatch={dispatch} />
        <BuildingsTable formState={formState} dispatch={dispatch} result={resultState.result} />

        {resultState.status === "done" && resultState.result && (
          <BuildOrderPanel formState={formState} result={resultState.result} />
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
    </>
  );
}

export default App;
