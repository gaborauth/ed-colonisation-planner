import { useEffect } from "react";
import type { PlannerResultState } from "../state/plannerState";

/** A real blocking modal for the solve's "in progress"/"error" states, in place of an inline
 * `.status-banner` sitting in normal page flow between ObjectivePanel and SolvedSystemPanel — that
 * would be easy to scroll past and wouldn't stop the user from poking at the rest of the form
 * mid-solve. Renders `null` for "idle"/"done" — those have nothing to block on. The "solving" state
 * has no dismiss control at all (there's nothing to cancel back to — `solveInWorker`/`solveIteratively`
 * run to completion, with no cancel path even for a multi-pass run — a real gap once one click can
 * trigger up to 5 sequential WASM solves, flagged as a known follow-up rather than fixed here); the
 * "error" state can be dismissed via the Close button, a backdrop click, or Escape, which resets
 * `resultState` back to idle in App.tsx. */
export function SolverStatusDialog({
  status,
  message,
  progress,
  onDismiss,
}: {
  status: PlannerResultState["status"];
  message: string | null;
  /** Current/total pass number from `solver/iterativeSolve.ts`'s `onProgress` callback — `null`/
   * `total <= 1` (today's default, single-pass) renders the plain "Running the solver…" text
   * unchanged. */
  progress?: { pass: number; total: number } | null;
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
      className="modal-overlay"
      onClick={isError ? onDismiss : undefined}
      role="presentation"
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isError ? "Solver error" : "Solving"}
        onClick={(e) => e.stopPropagation()}
      >
        {isError ? (
          <>
            <p className="modal-dialog-message status-banner">{message}</p>
            <div className="modal-dialog-actions">
              <button type="button" className="primary" onClick={onDismiss}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-dialog-message status-banner loading">
              {progress && progress.total > 1
                ? `Running the solver… (pass ${progress.pass} of ${progress.total})`
                : "Running the solver…"}
            </p>
            <div className="solver-progress-bar" aria-hidden="true">
              <div className="solver-progress-bar-fill" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
