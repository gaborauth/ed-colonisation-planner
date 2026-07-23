import type { Dispatch } from "react";
import { ALL_SCORES, toPrintable } from "../data/buildings";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";

interface ObjectivePanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

// Ported from colonisationplanner.py's preset_advanced_objectives, minus "maximize security ^
// standard of living" (ln(n) + ln(ln(e))): nested function calls aren't supported by objective.ts's
// LP linearizer (a function's argument must itself be a linear expression of score letters).
const PRESETS: Record<string, string> = {
  "Balance all stats": "sqrt(i) + sqrt(m) + sqrt(e) + sqrt(t) + sqrt(w) + sqrt(n) + sqrt(d)",
  "Balance harder": "i^0.2 + m^0.2 + e^0.2 + t^0.2 + w^0.2 + n^0.2 + d^0.2",
  "Balance hardest": "ln(i) + ln(m) + ln(e) + ln(t) + ln(w) + ln(n) + ln(d)",
  "Maximize wealth and tech, close to 2:1": "2 * w + t - abs(w - 2 * t)",
};

export function ObjectivePanel({ formState, dispatch }: ObjectivePanelProps) {
  return (
    <section className="panel">
      <h2>Objective</h2>
      <div className="row-grid">
        <label>
          <input
            type="radio"
            name="objective-mode"
            checked={formState.objectiveMode === "simple"}
            onChange={() => dispatch({ type: "patch", patch: { objectiveMode: "simple" } })}
          />{" "}
          Maximize a single score
        </label>
        <label>
          <input
            type="radio"
            name="objective-mode"
            checked={formState.objectiveMode === "custom"}
            onChange={() => dispatch({ type: "patch", patch: { objectiveMode: "custom" } })}
          />{" "}
          Custom expression
        </label>
      </div>

      {formState.objectiveMode === "simple" ? (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="simple-score">Score (construction cost is minimized, others maximized)</label>
          <select
            id="simple-score"
            value={formState.simpleScore}
            onChange={(e) => dispatch({ type: "patch", patch: { simpleScore: e.target.value as never } })}
          >
            {ALL_SCORES.map((score) => (
              <option key={score} value={score}>
                {toPrintable(score)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="row-grid">
            <div className="field">
              <label htmlFor="objective-preset">Presets</label>
              <select
                id="objective-preset"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    dispatch({ type: "patch", patch: { customExpression: PRESETS[e.target.value] } });
                  }
                }}
              >
                <option value="">— pick a preset —</option>
                {Object.keys(PRESETS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <label>
              <input
                type="radio"
                name="objective-direction"
                checked={formState.customDirection === "maximize"}
                onChange={() => dispatch({ type: "patch", patch: { customDirection: "maximize" } })}
              />{" "}
              Maximize
            </label>
            <label>
              <input
                type="radio"
                name="objective-direction"
                checked={formState.customDirection === "minimize"}
                onChange={() => dispatch({ type: "patch", patch: { customDirection: "minimize" } })}
              />{" "}
              Minimize
            </label>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="objective-expression">
              Expression — variables: i m e t w n d c (initial/max pop, security, tech, wealth,
              standard of living, development, cost); functions: sqrt ln log exp abs, and ^ for a
              constant fractional power
            </label>
            <textarea
              id="objective-expression"
              rows={2}
              style={{ width: "100%", resize: "vertical" }}
              value={formState.customExpression}
              onChange={(e) => dispatch({ type: "patch", patch: { customExpression: e.target.value } })}
              placeholder="e.g. sqrt(i) + sqrt(w) + sqrt(n)"
            />
          </div>
        </div>
      )}
    </section>
  );
}
