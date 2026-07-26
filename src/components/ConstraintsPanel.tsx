import type { Dispatch } from "react";
import { ALL_SCORES, toPrintable } from "../data/buildings";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

interface ConstraintsPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

// Folded by default (per user request, see App.tsx) — this panel and BuildingsTable are
// fine-tuning tools for later in a session, not needed for a first solve.
export function ConstraintsPanel({ formState, dispatch }: ConstraintsPanelProps) {
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(true);
  return (
    <section className="panel">
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">System score constraints</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && (
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {ALL_SCORES.map((score) => (
              <tr key={score}>
                <td>{toPrintable(score)}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
