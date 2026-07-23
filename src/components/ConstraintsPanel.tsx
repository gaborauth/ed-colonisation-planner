import type { Dispatch } from "react";
import { ALL_SCORES, toPrintable } from "../data/buildings";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

interface ConstraintsPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

export function ConstraintsPanel({ formState, dispatch }: ConstraintsPanelProps) {
  return (
    <section className="panel">
      <h2>System score constraints</h2>
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
    </section>
  );
}
