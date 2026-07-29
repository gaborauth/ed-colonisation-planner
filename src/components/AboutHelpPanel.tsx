import { useEffect, useRef } from "react";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import { getStoredPanelCollapsed, setStoredPanelCollapsed } from "../persistence/panelCollapse";

const PANEL_ID = "about-help";

interface AboutHelpPanelProps {
  /** Bumped by App.tsx's "Live Demo" button to force this panel closed — a first-time visitor who
   * clicks Live Demo already has a live system in front of them and doesn't need the intro text
   * still taking up space above it. Same "signal" pattern as JournalImportPanel's own
   * `refreshToken`: only acts on a change AFTER mount, never on the initial value. */
  collapseSignal?: number;
}

// Unfolded by default (unlike BuildingsTable/SavedPlansPanel) — this is a
// first-time explainer meant to actually be seen on first load, not fine-tuning tools tucked away
// for later. Uses the normal `panel-toggle` chevron styling (not `panel-toggle-flat`) since this
// one really is meant to invite folding away once read. Collapsed state is remembered across
// sessions via persistence/panelCollapse.ts — once a user folds it, it stays folded next time
// instead of re-explaining itself every session.
export function AboutHelpPanel({ collapseSignal }: AboutHelpPanelProps) {
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(
    getStoredPanelCollapsed(PANEL_ID) ?? false,
  );

  useEffect(() => {
    setStoredPanelCollapsed(PANEL_ID, collapsed);
  }, [collapsed]);

  // Compares against the LAST SEEN value rather than a plain "is this the first run" boolean flag
  // — the latter breaks under React 18 StrictMode's dev-only double-invoke-on-mount (the ref flips
  // to "seen" on the first of the two mount invocations, so the second one wrongly treats itself as
  // a real change and folds the panel immediately on page load, before "Live Demo" was ever
  // clicked). This form is safe under a double-invoke: both calls compare against the same
  // untouched snapshot and agree nothing changed.
  const lastCollapseSignal = useRef(collapseSignal);
  useEffect(() => {
    if (collapseSignal === lastCollapseSignal.current) return;
    lastCollapseSignal.current = collapseSignal;
    setCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only on collapseSignal changing, setCollapsed identity is stable
  }, [collapseSignal]);

  return (
    <section className="panel">
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">About &amp; help</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && (
        <div style={{ fontSize: "0.8667rem", lineHeight: 1.5 }}>
          <p>
            This is a planner for colonising a system in Elite Dangerous: tell it what you can build
            (or upload a Journal file and let it estimate that from your scans), pick a goal, and it
            works out which facilities to build — and in what order — to get there, taking
            construction points, dependencies, and the escalating cost of building multiple ports
            into account.
          </p>

          <p>
            <strong>Your system data mostly stays on your device.</strong> The solver, your saved
            plans, and your saved journal-imported systems all run and stay entirely in your
            browser — no account, and nothing of yours sent to a server we run. The one exception:
            the "Spansh" import tab queries Spansh's own public system database (through a small
            proxy) when you search for and load a system that way — that's the one path here where a
            system lookup leaves your browser. Journal-file import and everything else never sends
            anything anywhere, so you can freely explore and plan a system here <em>before</em>{" "}
            deciding whether to hand its data over to a journal-uploading tool like EDDN or Inara.
          </p>

          <p>
            <strong>Nothing else currently does this.</strong> Turning "what should I build here" into
            an actual ordered build plan — not just a stats reference — isn't something any other
            live tool for Elite Dangerous colonisation currently does. The closest thing was
            EDColonizationPlanner, a Python desktop tool built back at colonisation's original March
            2025 launch and abandoned a month later; this project started as a modernisation of that
            same idea and has since been completely rewritten from scratch (new engine, new UI, new
            rules) to keep up with everything the game has changed since — most recently Update 3's
            economy/link rework and the Trailblazers Update.
          </p>

          <p>
            <strong>Quick start:</strong> in-game, the automatic Discovery Scan ("honk") alone isn't
            enough — open the Full Spectrum Scanner (throttle down to 0% in supercruise) and
            individually FSS-scan every body in the system first; the more bodies scanned this way,
            the better the slot-count guess below will be. Then upload your Journal file below (or
            search for the system by name on the "Spansh" tab instead, or click "Live Demo" in the
            toolbar above to try a real example system with no upload at all). Journal files live in
            your Saved Games folder, named by date/time, e.g.{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {"C:\\Users\\<you>\\Saved Games\\Frontier Developments\\Elite Dangerous\\Journal.2026-07-26T081047.01.log"}
            </code>{" "}
            — pick the most recent one from your current play session. From there, mark what's
            already built in the "Actual facilities in the system" panel, choose an objective, then
            hit "Solve for a system." The "Solved system" panel shows what to build, and the "Build
            order" panel below it lays the whole plan out as one numbered, step-by-step table.
          </p>

          <p style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 0 }}>
            <span>
              This is a free, open-source project — the full source is on{" "}
              <a href="https://github.com/gaborauth/ed-colonisation-planner" target="_blank" rel="noreferrer">
                GitHub
              </a>
              . Found a bug, have a feature idea, or just want to say what does or doesn't work for
              you? Feedback is very welcome — open an issue on the GitHub repo above. And if this
              tool saved you some time or Credits, you can{" "}
              <a href="https://buymeacoffee.com/gabor.auth" target="_blank" rel="noreferrer">
                buy me a coffee
              </a>{" "}
              — entirely optional, appreciated either way.
            </span>
            <a
              href="https://buymeacoffee.com/gabor.auth"
              target="_blank"
              rel="noreferrer"
              style={{ flexShrink: 0 }}
            >
              <img
                src={`${import.meta.env.BASE_URL}images/bmc_qr.png`}
                alt="Buy me a coffee QR code"
                width={96}
                height={96}
                style={{ display: "block" }}
              />
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
