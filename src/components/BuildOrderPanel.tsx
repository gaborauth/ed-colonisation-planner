import { useMemo } from "react";
import { toPrintable } from "../data/buildings";
import { getMixedOrderingFromResult } from "../domain/ordering";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";

interface BuildOrderPanelProps {
  formState: PlannerFormState;
  result: SolverResult;
}

export function BuildOrderPanel({ formState, result }: BuildOrderPanelProps) {
  const { order, error } = useMemo(() => {
    try {
      return { order: getMixedOrderingFromResult(toPlanResult(formState, result)), error: null };
    } catch (e) {
      return { order: null, error: (e as Error).message };
    }
  }, [formState, result]);

  return (
    <section className="panel">
      <h2>Build order</h2>
      {error && <div className="status-banner">Could not compute a build order: {error}</div>}
      {order && order.length === 0 && <p>Nothing new to build.</p>}
      {order && order.length > 0 && (
        <ol>
          {order.map((name, i) => (
            <li key={`${name}-${i}`}>{toPrintable(name)}</li>
          ))}
        </ol>
      )}
      {result.demolished.length > 0 && (
        <>
          <h3>Facilities to demolish</h3>
          <ul>
            {result.demolished.map((d, i) => (
              <li key={i}>
                {toPrintable(d.building)} ({d.slotKind} slot {d.index + 1} on body {d.bodyId})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
