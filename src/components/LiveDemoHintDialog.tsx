import { useEffect } from "react";

interface LiveDemoHintDialogProps {
  open: boolean;
  onDismiss: () => void;
}

/** One-time orientation nudge shown right after "Live Demo" loads a real example system — a
 * first-time visitor now has a fully-populated system in front of them but no obvious next step,
 * since "Solve for a system" lives in the Objective panel further down the page. Dismissible via
 * the "Got it" button, a backdrop click, or Escape — same interaction pattern as
 * SolverStatusDialog's error state, sharing its generic `.modal-overlay`/`.modal-dialog` shell. */
export function LiveDemoHintDialog({ open, onDismiss }: LiveDemoHintDialogProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onDismiss} role="presentation">
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Live Demo loaded"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-dialog-message">
          This example system is now loaded into "Actual facilities in the system," with its
          primary station and everything already scanned marked as built. Scroll down to the{" "}
          <strong>Objective</strong> panel, pick (or keep) a goal, then hit{" "}
          <strong>Solve for a system</strong> — that works out what to build next, and in what
          order, to get there.
        </p>
        <div className="modal-dialog-actions">
          <button type="button" className="primary" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
