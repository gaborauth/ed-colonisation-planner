import { useEffect } from "react";
import type { PlannerResultState } from "../state/plannerState";

/** A real blocking modal for the solve's "in progress"/"error" states, replacing the old inline
 * `.status-banner` that used to sit in normal page flow between BuildingsTable and SolvedSystemPanel
 * — easy to scroll past and didn't stop the user from poking at the rest of the form mid-solve
 * (2026-07-28 user request: "give a better UX about the process and the errors"). Renders `null` for
 * "idle"/"done" — those have nothing to block on. The "solving" state has no dismiss control at all
 * (there's nothing to cancel back to — `solveInWorker` runs to completion); the "error" state can be
 * dismissed via the Close button, a backdrop click, or Escape, which resets `resultState` back to
 * idle in App.tsx. */
export function SolverStatusDialog({
  status,
  message,
  onDismiss,
}: {
  status: PlannerResultState["status"];
  message: string | null;
  onDismiss: () => void;
}) {
  const isError = status === "error";

  useEffect(() => {
    if (!isError) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isError, onDismiss]);

  if (status !== "solving" && status !== "error") return null;

  return (
    <div
      className="solver-status-overlay"
      onClick={isError ? onDismiss : undefined}
      role="presentation"
    >
      <div
        className="solver-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isError ? "Solver error" : "Solving"}
        onClick={(e) => e.stopPropagation()}
      >
        {isError ? (
          <>
            <p className="solver-status-dialog-message status-banner">{message}</p>
            <div className="solver-status-dialog-actions">
              <button type="button" className="primary" onClick={onDismiss}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="solver-status-dialog-message status-banner loading">Running the solver…</p>
            <div className="solver-progress-bar" aria-hidden="true">
              <div className="solver-progress-bar-fill" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
