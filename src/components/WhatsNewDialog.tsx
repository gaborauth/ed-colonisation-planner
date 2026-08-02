import { useEffect } from "react";
import type { ChangelogRelease } from "../domain/changelog";

interface WhatsNewDialogProps {
  releases: ChangelogRelease[] | null;
  onDismiss: () => void;
}

/** Shown once per version bump (see hooks/useWhatsNew.ts) — lists every release's Features/Bug
 * Fixes since the version this browser last had loaded. Dismissible via "Got it", a backdrop
 * click, or Escape — same interaction pattern as LiveDemoHintDialog, sharing its generic
 * `.modal-overlay`/`.modal-dialog` shell. */
export function WhatsNewDialog({ releases, onDismiss }: WhatsNewDialogProps) {
  const open = releases !== null && releases.length > 0;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onDismiss]);

  if (!open || !releases) return null;

  return (
    <div className="modal-overlay" onClick={onDismiss} role="presentation">
      <div
        className="modal-dialog whats-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>What's new</h2>
        <div className="whats-new-releases">
          {releases.map((release) => (
            <section className="whats-new-release" key={release.version}>
              <h3>
                v{release.version} <span className="whats-new-date">{release.date}</span>
              </h3>
              {release.sections.map((section) => (
                <div key={section.title}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="modal-dialog-actions">
          <button type="button" className="primary" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
