import { useEffect, type Dispatch } from "react";
import { ALL_ECONOMY_TYPES, ALL_SCORES, ECONOMY_COLORS, toPrintable, type Score } from "../data/buildings";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import { getStoredPanelCollapsed, setStoredPanelCollapsed } from "../persistence/panelCollapse";
import { setObjectivePreference } from "../persistence/objectivePreference";
import type { EconomyPreference } from "../solver/solve";
import { DEFAULT_OBJECTIVE_EXPRESSION, type PlannerAction, type PlannerFormState } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

const SCORE_CONSTRAINTS_PANEL_ID = "objective-score-constraints";
const ECONOMY_PREFERENCES_PANEL_ID = "objective-economy-preferences";

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
// Each preset carries a separate short `name` (the dropdown option text) and a longer `description`
// (shown as a hint below the dropdown for whichever one is currently active) rather than cramming
// both into one long option string, which reads poorly in a native <select>.
//
// `e` (security) and `n` (standard_of_living) are deliberately NOT wrapped in sqrt/pow/ln here,
// unlike the other 5 original stats — see DEFAULT_OBJECTIVE_EXPRESSION's comment in
// state/plannerState.ts for why (some buildings carry a negative sec/sol contribution, and the
// concave-function linearizer silently mis-linearizes below its domain-positive floor instead of
// erroring). `y`/`p` (economy_synergy/economy_preference) are appended the same way for the same
// reason, matching the Default preset — plain linear terms, never inside sqrt/pow/ln.
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
      "Moderate diminishing returns per stat (square root) — each stat matters a bit less the higher it already is, encouraging a well-rounded system over maxing out one thing. Also factors in security, standard of living, the solver's economy-fit estimate, and your economy preference choices.",
    expression: "sqrt(i) + sqrt(m) + e + sqrt(t) + sqrt(w) + n + sqrt(d) + y + p",
  },
  {
    name: "Balance all stats, harder",
    description:
      "Stronger diminishing returns than \"Balance all stats\" — harder to get ahead by dumping everything into one stat, pulling the system toward an even more even spread. Also factors in security, standard of living, the solver's economy-fit estimate, and your economy preference choices.",
    expression: "i^0.2 + m^0.2 + e + t^0.2 + w^0.2 + n + d^0.2 + y + p",
  },
  {
    name: "Balance all stats, hardest",
    description:
      "Logarithmic diminishing returns — the strongest equalizing pull of the three balance presets, most resistant to any single stat dominating. Also factors in security, standard of living, the solver's economy-fit estimate, and your economy preference choices.",
    expression: "ln(i) + ln(m) + e + ln(t) + ln(w) + n + ln(d) + y + p",
  },
  {
    name: "Wealth & tech, 2:1 ratio",
    description:
      "Maximizes wealth and tech level together, while keeping them close to a 2:1 ratio between them. Also factors in the solver's economy-fit estimate and your economy preference choices.",
    expression: "2 * w + t - abs(w - 2 * t) + y + p",
  },
];

// Raw formula-editing textarea, shown alongside the Presets dropdown in "Complex score" mode.
// Kept as a flag (rather than inlined) so it can be hidden again later without touching the
// underlying state/behavior if it turns out to read as too technical/confusing for most users.
const SHOW_EXPRESSION_EDITOR = true;

// Score/EconomyType names are snake_case (`toPrintable` just swaps underscores for spaces, e.g.
// "standard_of_living" -> "standard of living") — sentence-casing just the first letter, not every
// word, since some names carry a real lowercase conjunction ("standard OF living") that a naive
// per-word title-case would wrongly capitalize too (same reasoning applies to building names like
// "Orbis_or_Ocellus" elsewhere, which is why this isn't folded into `toPrintable` itself).
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Short "what does this mean" line shown below the "Maximize a single score" dropdown for whichever
// score is currently picked, same idea as the Presets' descriptions above; also shown per-row in the
// Score constraints table (see below). Every ALL_SCORES entry needs one (including the
// derived/compound ones): missing an entry would silently show a blank hint rather than erroring, so
// this is written as a full Record, not Partial, to make an omission a compile error instead. Capped
// at 8 words each — the longer nuance these used to carry (e.g. "not a real in-game stat" for the
// two derived scores) is conveyed instead by the Score constraints table's own divider (see
// ALL_SCORES.map below) separating real system stats from
// construction_cost/system_score_beta/economy_synergy/economy_preference, rather than by spelling
// it out in every one of those rows' own text.
const SCORE_DESCRIPTIONS: Record<Score, string> = {
  initial_population_increase: "How much starting population increases from this.",
  max_population_increase: "Maximum sustainable population increase for the system.",
  security: "How safe the system is from piracy.",
  tech_level: "Technology level; unlocks higher-tier station services.",
  wealth: "Economic wealth; drives commodity prices and market activity.",
  standard_of_living: "How comfortable life is for the population.",
  development_level: "How developed/industrialized the system is overall.",
  construction_cost: "Total commodities needed.",
  system_score_beta: "Sum of security, tech, wealth, standard of living.",
  economy_synergy: "Solver's estimate of building-to-body economy fit.",
  economy_preference: "Your economy preference choices, turned into a score.",
};

// Ordered from most to least favorable (Must / Want / Dunno / Don't want / Forbid), matching how
// strongly each option biases the solver toward or away from an economy.
const ECONOMY_PREFERENCE_OPTIONS: { value: EconomyPreference | ""; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "want", label: "Want" },
  { value: "", label: "Dunno" },
  { value: "dont_want", label: "Don't want" },
  { value: "forbid", label: "Forbid" },
];

export function ObjectivePanel({ formState, dispatch, onSolve, solving }: ObjectivePanelProps) {
  // Which preset (if any) matches the CURRENT customExpression — drives the select's `value` for
  // real (not a hardcoded "always blank" trick, which would make the dropdown visibly snap back to
  // "Default preset" on every selection, since its value would never actually reflect what was
  // picked). Falls back to a synthetic "custom" entry when nothing matches (e.g. a hand-edited
  // expression that doesn't match any preset) so the select always has a valid, non-crashing value
  // to show.
  const selectedPreset = PRESETS.find((p) => p.expression === formState.customExpression);

  // Score constraints / Economy preferences are individually foldable. Score constraints defaults
  // to EXPANDED (`?? false`, same as AboutHelpPanel), not collapsed: a constraint sitting folded
  // away too easily hides the default "at least 1 security" constraint from view. Economy
  // preferences defaults to COLLAPSED instead (`?? true`) — it's a fine-tuning control most solves
  // don't need to touch, unlike Score constraints' own always-relevant default bound. Each panel's
  // own choice is then remembered across sessions via persistence/panelCollapse.ts either way, same
  // as AboutHelpPanel.
  const scoreConstraints = useScrollAnchoredCollapse<HTMLButtonElement>(
    getStoredPanelCollapsed(SCORE_CONSTRAINTS_PANEL_ID) ?? false,
  );
  useEffect(() => {
    setStoredPanelCollapsed(SCORE_CONSTRAINTS_PANEL_ID, scoreConstraints.collapsed);
  }, [scoreConstraints.collapsed]);
  const economyPreferencesCollapse = useScrollAnchoredCollapse<HTMLButtonElement>(
    getStoredPanelCollapsed(ECONOMY_PREFERENCES_PANEL_ID) ?? true,
  );
  useEffect(() => {
    setStoredPanelCollapsed(ECONOMY_PREFERENCES_PANEL_ID, economyPreferencesCollapse.collapsed);
  }, [economyPreferencesCollapse.collapsed]);

  // Remembers the objective selection across sessions — App.tsx's `useReducer` lazy initializer
  // (`applyStoredObjectivePreference`) restores it on the NEXT load; this effect is the write side,
  // firing whenever any of the four fields actually change.
  useEffect(() => {
    setObjectivePreference({
      objectiveMode: formState.objectiveMode,
      simpleScore: formState.simpleScore,
      customExpression: formState.customExpression,
      customDirection: formState.customDirection,
    });
  }, [formState.objectiveMode, formState.simpleScore, formState.customExpression, formState.customDirection]);

  // Once a per-body layout is applied, the primary station also needs a body assignment — required
  // for real placement/link display, so it's a hard prerequisite here too, same as
  // `firstStationBuilding` itself. Aggregate mode (no bodies) has no body to assign, so it's not
  // gated on this at all.
  const missingPrimaryBody = formState.bodies.length > 0 && formState.firstStationBodyId === undefined;
  const canSolve = !!formState.firstStationBuilding && !missingPrimaryBody;
  const blockedReason = !formState.firstStationBuilding
    ? 'Pick a primary station in "Actual facilities in the system" first'
    : missingPrimaryBody
      ? 'Pick the primary station\'s body in "Actual facilities in the system" first'
      : undefined;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Objective</h2>
        <button type="button" className="primary" onClick={onSolve} disabled={solving || !canSolve} title={blockedReason}>
          {solving ? "Solving…" : "Solve for a system"}
        </button>
      </div>
      {!canSolve && <p className="panel-hint panel-hint-accent">{blockedReason} before you can solve.</p>}
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
                Expression — variables: i m e t w n d c y p (initial/max pop, security, tech,
                wealth, standard of living, development, cost, economy-fit estimate, economy
                preference); functions: sqrt ln log exp abs, and ^ for a constant fractional power.
                Security, standard of living, economy-fit, and economy preference can go negative —
                avoid wrapping e, n, y, or p in sqrt/ln/^ (add them as plain terms instead).
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
            Allow criminal constructions
          </label>
        </div>
      </div>

      {/* Individually foldable, defaulting to EXPANDED (not folded) so the "at least 1 security"
       * default constraint stays discoverable — see the collapse-hook setup above. Score
       * constraints ARE part of the objective (they bound what the solver's free to pick, same as
       * the objective expression shapes what it prefers), so this still lives directly in this
       * panel, not a separate one. */}
      <div style={{ marginTop: 14 }}>
        <button
          ref={scoreConstraints.buttonRef}
          type="button"
          className="panel-toggle panel-toggle-nested"
          aria-expanded={!scoreConstraints.collapsed}
          onClick={() => scoreConstraints.setCollapsed((c) => !c)}
        >
          <span className="panel-toggle-title">Score constraints</span>
          <span className="chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {!scoreConstraints.collapsed && (
          <table className="score-constraints-table">
            <thead>
              <tr>
                <th>Score</th>
                <th>Min</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {ALL_SCORES.flatMap((score) => {
                const row = (
                  <tr key={score}>
                    <td>
                      <div>{capitalize(toPrintable(score))}</div>
                      <div className="panel-hint">{SCORE_DESCRIPTIONS[score]}</div>
                    </td>
                    <td>
                      <NumberInput
                        allowNegative
                        ariaLabel={`Minimum ${toPrintable(score)}`}
                        value={formState.scoreMin[score]}
                        onChange={(value) => dispatch({ type: "setScoreBound", bound: "scoreMin", score, value })}
                      />
                    </td>
                    <td>
                      <NumberInput
                        allowNegative
                        ariaLabel={`Maximum ${toPrintable(score)}`}
                        value={formState.scoreMax[score]}
                        onChange={(value) => dispatch({ type: "setScoreBound", bound: "scoreMax", score, value })}
                      />
                    </td>
                  </tr>
                );
                // Separates the real, persistent system stats above from construction_cost onward
                // below — construction_cost is a genuine in-game number but a transient, inverted
                // one (minimized, not maximized, and never itself shown in the system's own stats
                // panel), and system_score_beta/economy_synergy/economy_preference are this app's
                // own compound/solver-side numbers, not real per-building stats. The divider goes
                // after development_level, not before construction_cost, since construction_cost
                // itself belongs with the "not a real system stat" group below, not the real stats
                // above it.
                return score === "development_level"
                  ? [row, <tr key={`${score}-divider`} aria-hidden="true"><td colSpan={3}><hr className="score-constraints-divider" /></td></tr>]
                  : [row];
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Per-EconomyType Must/Want/Dunno/Don't want/Forbid steering — lets the user steer WHICH
       * economies the solver favors or avoids, on top of the aggregate score-based objective above.
       * Same foldable placement as Score constraints above, right after it, since it's conceptually
       * the same kind of control (bounding/steering what the solver picks). Requires a per-body
       * layout: `facilityBaseEconomies` needs a real body's attributes to resolve a generic port's
       * economy set (see solve.ts's SolverInput.economyPreferences doc comment) — aggregate-mode-only
       * users get a disabled section with an explanation instead of a silently-inert control (still
       * foldable either way, so the explanation itself can be tucked away once read). Preference
       * picked via a radio-button grid (one column per option), not a per-row dropdown, since that
       * reads better across this panel's full width than a narrow select per row. */}
      <div style={{ marginTop: 14 }}>
        <button
          ref={economyPreferencesCollapse.buttonRef}
          type="button"
          className="panel-toggle panel-toggle-nested"
          aria-expanded={!economyPreferencesCollapse.collapsed}
          onClick={() => economyPreferencesCollapse.setCollapsed((c) => !c)}
        >
          <span className="panel-toggle-title">Economy preferences</span>
          <span className="chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {!economyPreferencesCollapse.collapsed &&
          (formState.bodies.length === 0 ? (
            <p className="panel-hint">
              Requires a per-body system layout — apply one via the Import system panel first. A generic port's
              economy depends on the body it's built on, which plain aggregate slot counts don't carry.
            </p>
          ) : (
            <>
              <p className="panel-hint">
                Steers which economies the solver favors or avoids. Forbid/Must are hard requirements. A port's
                body-derived economies stack (e.g. every port on an Earth-like world carries Agriculture, High
                Tech, Military, and Tourism together, non-selectably) — Forbidding one can rule out every generic
                port option on that body, not just that one economy; intended, not a bug. Want/Don't want are
                soft nudges (the "economy preference" score) — like economy synergy, they only actually bias the
                solve when the active objective includes it (the default expression does).
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Economy</th>
                    {ECONOMY_PREFERENCE_OPTIONS.map((opt) => (
                      <th key={opt.label} style={{ textAlign: "center" }}>
                        {opt.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_ECONOMY_TYPES.map((economy) => {
                    const current = formState.economyPreferences[economy] ?? "";
                    return (
                      <tr key={economy}>
                        <td>
                          <span className="economy-swatch" style={{ background: ECONOMY_COLORS[economy] }} /> {economy}
                        </td>
                        {ECONOMY_PREFERENCE_OPTIONS.map((opt) => (
                          <td key={opt.label} style={{ textAlign: "center" }}>
                            <input
                              type="radio"
                              name={`economy-preference-${economy}`}
                              title={opt.label}
                              aria-label={`${economy}: ${opt.label}`}
                              checked={current === opt.value}
                              onChange={() =>
                                dispatch({
                                  type: "setEconomyPreference",
                                  economy,
                                  value: (opt.value || undefined) as EconomyPreference | undefined,
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ))}
      </div>
    </section>
  );
}
