import { useEffect, type Dispatch } from "react";
import { ALL_SCORES, toPrintable, type Score } from "../data/buildings";
import { setObjectivePreference } from "../persistence/objectivePreference";
import { DEFAULT_OBJECTIVE_EXPRESSION, type PlannerAction, type PlannerFormState } from "../state/plannerState";

interface ObjectivePanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
  onSolve: () => void;
  solving: boolean;
}

interface ObjectivePreset {
  name: string;
  description: string;
  expression: string;
}

// Ported from colonisationplanner.py's preset_advanced_objectives, minus "maximize security ^
// standard of living" (ln(n) + ln(ln(e))): nested function calls aren't supported by objective.ts's
// LP linearizer (a function's argument must itself be a linear expression of score letters).
// Each preset now carries a separate short `name` (the dropdown option text) and a longer
// `description` (shown as a hint below the dropdown for whichever one is currently active) —
// 2026-07-26, user request — rather than cramming both into one long option string, which reads
// poorly in a native <select>.
const PRESETS: ObjectivePreset[] = [
  {
    name: "Default preset",
    description:
      "This app's own starting point: blends all three \"balance evenly\" presets below with the wealth/tech 2:1 ratio preset, plus how well the solver's picks fit each body's own economy. A reasonable one-size-fits-most choice — pick a more specific preset below only if you want to lean harder into one particular goal.",
    expression: DEFAULT_OBJECTIVE_EXPRESSION,
  },
  {
    name: "Balance all stats",
    description:
      "Moderate diminishing returns per stat (square root) — each stat matters a bit less the higher it already is, encouraging a well-rounded system over maxing out one thing.",
    expression: "sqrt(i) + sqrt(m) + sqrt(e) + sqrt(t) + sqrt(w) + sqrt(n) + sqrt(d)",
  },
  {
    name: "Balance all stats, harder",
    description:
      "Stronger diminishing returns than \"Balance all stats\" — harder to get ahead by dumping everything into one stat, pulling the system toward an even more even spread.",
    expression: "i^0.2 + m^0.2 + e^0.2 + t^0.2 + w^0.2 + n^0.2 + d^0.2",
  },
  {
    name: "Balance all stats, hardest",
    description:
      "Logarithmic diminishing returns — the strongest equalizing pull of the three balance presets, most resistant to any single stat dominating.",
    expression: "ln(i) + ln(m) + ln(e) + ln(t) + ln(w) + ln(n) + ln(d)",
  },
  {
    name: "Wealth & tech, 2:1 ratio",
    description: "Maximizes wealth and tech level together, while keeping them close to a 2:1 ratio between them.",
    expression: "2 * w + t - abs(w - 2 * t)",
  },
];

// Hidden for now (2026-07-26, user request: "hide the expression, we will put back later") — the
// raw formula-editing textarea reads as too technical/confusing for most users; the Presets
// dropdown above it is the only way to change `customExpression` while this is off. The underlying
// state/behavior is completely untouched — flip this back to `true` to restore the editor, nothing
// else needs to change.
const SHOW_EXPRESSION_EDITOR = false;

// Short "what does this mean" line shown below the "Maximize a single score" dropdown for whichever
// score is currently picked — 2026-07-26, user request, same idea as the Presets' descriptions
// above. Every ALL_SCORES entry needs one (including the derived/compound ones): missing an entry
// would silently show a blank hint rather than erroring, so this is written as a full Record, not
// Partial, to make an omission a compile error instead.
const SCORE_DESCRIPTIONS: Record<Score, string> = {
  initial_population_increase: "How much the system's starting population increases from what's built here.",
  max_population_increase: "How much the system's maximum sustainable population increases.",
  security: "How safe the system is from crime and piracy — go negative and NPCs start interdicting you during hauling.",
  tech_level: "The system's technology level — gates access to higher-tier station services like Shipyard/Outfitting.",
  wealth: "The system's economic wealth — drives commodity prices and general market activity.",
  standard_of_living: "How comfortable life is for the system's population.",
  development_level: "How developed/industrialized the system is overall.",
  construction_cost:
    "Total commodities required to build everything selected — this one is automatically minimized instead of maximized, unlike every other score here.",
  system_score_beta: "A compound score: security + tech level + wealth + standard of living, added together.",
  economy_synergy:
    "How well the solver's picks fit each body's own economy — a solver-side signal, not a real in-game stat; only ever nonzero once you've actually solved with a per-body layout.",
};

export function ObjectivePanel({ formState, dispatch, onSolve, solving }: ObjectivePanelProps) {
  // Which preset (if any) matches the CURRENT customExpression — drives the select's `value` for
  // real (not a hardcoded "always blank" trick, which was the bug: the dropdown visibly snapped
  // back to "Default preset" on every selection because its value never actually reflected what was
  // picked). Falls back to a synthetic "custom" entry when nothing matches (e.g. an old saved plan
  // written while the now-hidden expression editor was in use) so the select always has a valid,
  // non-crashing value to show.
  const selectedPreset = PRESETS.find((p) => p.expression === formState.customExpression);

  // Remembers the objective selection across sessions (2026-07-26 user request) — App.tsx's
  // `useReducer` lazy initializer (`applyStoredObjectivePreference`) restores it on the NEXT load;
  // this effect is the write side, firing whenever any of the four fields actually change.
  useEffect(() => {
    setObjectivePreference({
      objectiveMode: formState.objectiveMode,
      simpleScore: formState.simpleScore,
      customExpression: formState.customExpression,
      customDirection: formState.customDirection,
    });
  }, [formState.objectiveMode, formState.simpleScore, formState.customExpression, formState.customDirection]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Objective</h2>
        <button
          type="button"
          className="primary"
          onClick={onSolve}
          disabled={solving || !formState.firstStationBuilding}
          title={!formState.firstStationBuilding ? "Pick a primary station in Actual facilities in the system first" : undefined}
        >
          {solving ? "Solving…" : "Solve for a system"}
        </button>
      </div>
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
          Complex score
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
          <p className="panel-hint">{SCORE_DESCRIPTIONS[formState.simpleScore]}</p>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="row-grid">
            <div className="field">
              <label htmlFor="objective-preset">Presets</label>
              <select
                id="objective-preset"
                value={selectedPreset ? selectedPreset.name : ""}
                onChange={(e) => {
                  const preset = PRESETS.find((p) => p.name === e.target.value);
                  if (preset) dispatch({ type: "patch", patch: { customExpression: preset.expression } });
                }}
              >
                {!selectedPreset && <option value="">— custom (edited outside these presets) —</option>}
                {PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              {selectedPreset && <p className="panel-hint">{selectedPreset.description}</p>}
            </div>
          </div>
          {SHOW_EXPRESSION_EDITOR && (
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
          )}
        </div>
      )}

      <div className="row-grid" style={{ marginTop: 14 }}>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={formState.allowCriminal}
              onChange={(e) => dispatch({ type: "patch", patch: { allowCriminal: e.target.checked } })}
            />{" "}
            Allow criminal buildings
          </label>
        </div>
      </div>
    </section>
  );
}
