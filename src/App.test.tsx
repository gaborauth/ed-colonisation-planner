// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import App, { buildSolverInput } from "./App";
import FIXTURE from "./journal/fixtures/sample.jsonl?raw";
import type { JournalBody } from "./journal/parser";
import { INITIAL_FORM_STATE } from "./state/plannerState";

// The "Actual facilities in the system" panel's slot fields are read-only (derived from a journal
// import) now that "Enter slots manually" no longer exists — so every end-to-end test unlocks the
// panel the same way a real user would, by uploading a journal and applying its (guessed) body
// layout.
async function importAndApplyJournal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // Spansh is the default active tab now — switch to Journal file first.
  await user.click(screen.getByRole("tab", { name: "Journal file" }));
  const file = new File([FIXTURE], "journal.log", { type: "text/plain" });
  await user.upload(screen.getByLabelText("Journal file"), file);
  // The Journal tab now mirrors the Spansh tab's pick-then-Load pattern (2026-07-27) — uploading
  // alone no longer touches the shared body/slot table, "Load" does. The fixture parses to exactly
  // one system, so it's already the picker's default selection; just click Load.
  await user.click(await screen.findByRole("button", { name: "Load" }));
  await user.click(
    await screen.findByRole("button", { name: "Apply slots and body layout to Actual facilities in the system" }),
  );
}

describe("App", () => {
  // The "clears the previous system's solved result..." test below is the first test in this file
  // to actually write to the saved-systems localStorage store (via "Live Demo") — without this,
  // that write leaks into the NEXT test's fresh `render(<App />)`: `JournalImportPanel`'s mount-time
  // auto-reapply-last-used-system effect would find it and silently apply a system before the next
  // test's own `importAndApplyJournal` call, leaving two "Journal file" inputs in a confused state
  // (real bug this reproduced, not a flake: `getByLabelText("Journal file")` started throwing
  // "found multiple elements").
  beforeEach(() => {
    localStorage.clear();
  });

  it("solves a minimal system end-to-end with the real solver and renders results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");

    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    // Result content now lives inside "Solved system" (SystemScoresSummary) rather than a
    // standalone Result panel — "First station" only renders there once a solve completes.
    const firstStationLabel = await screen.findByText("First station", {}, { timeout: 20000 });
    expect(screen.getByText("Build order")).toBeInTheDocument();
    // "Coriolis" appears many times elsewhere on the page, so scope the lookup to the field itself.
    const solvedPanel = firstStationLabel.closest(".panel") as HTMLElement;
    expect(within(solvedPanel).getByText("First station").closest(".field")).toHaveTextContent("Coriolis");
  }, 25000);

  it("clears the previous system's solved result when a different system is applied", async () => {
    // Regression test for the "stale solved result" bug fixed in PR #21 (2026-07-26 user report):
    // solving for one system, then switching to a DIFFERENT one (via "Import from journal" or the
    // sticky toolbar's "Import system"/"Live Demo"), used to leave the old system's "Solved
    // system"/"Build order" panels showing through against the newly-applied system's own layout,
    // since `App.tsx`'s `resultState` (outside the reducer) was never reset on a system switch.
    // Fixed via `onSystemChanged`, wired from both JournalImportPanel's `applySystem` and
    // SystemPortabilityBar's `loadParsedSystem` into App.tsx's `handleSystemChanged`.
    const user = userEvent.setup();
    render(<App />);

    // System A: the journal fixture ("Test System A").
    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");
    await user.click(screen.getByRole("button", { name: /solve for a system/i }));
    await screen.findByText("First station", {}, { timeout: 20000 });
    expect(screen.getByText("Build order")).toBeInTheDocument();

    // Switch to System B via "Live Demo" (jsons/swoilz-aw-c-d52.json — a real, distinct system that
    // already carries its own primary station, so no further setup is needed before the assertion).
    await user.click(screen.getByRole("button", { name: /live demo/i }));

    // Confirm System B actually applied (not just that System A's stale content vanished for some
    // unrelated reason).
    await screen.findByText("Swoilz AW-C d52");

    // The previous solve's result must be gone: "Build order" no longer renders at all, and
    // "Solved system" falls back to its own "not yet solved" hint instead of showing stale content.
    expect(screen.queryByText("Build order")).not.toBeInTheDocument();
    expect(screen.getByText(/solve the system to see the proposed layout/i)).toBeInTheDocument();
  }, 25000);

  it("only folds About & Help / Import system, and only shows the orientation hint, once Live Demo is actually clicked", async () => {
    // Regression test: a naive "skip the first effect run" ref guard for
    // AboutHelpPanel/JournalImportPanel's `collapseSignal` prop breaks under React 18 StrictMode's
    // dev-only double-invoke-on-mount, folding both panels immediately on page load rather than
    // only after a real "Live Demo" click. Fixed by comparing against the last-seen value instead
    // of a plain boolean flag (see each panel's own `collapseSignal` effect). Rendered inside a
    // real StrictMode boundary (unlike this file's other tests) specifically to reproduce that
    // double-invoke — the app's own real entry point (main.tsx) always renders under StrictMode,
    // so this is the accurate reproduction, not an artificial one.
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // "Import system" also names the sticky toolbar's plain file-picker trigger, which carries no
    // `aria-expanded` at all — `expanded` here scopes the query to the actual panel-toggle button.
    expect(screen.getByRole("button", { name: /about & help/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /import system/i, expanded: true })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /live demo loaded/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /live demo/i }));
    // Unlike this file's other Live-Demo tests, nothing was imported/applied first here, so
    // "Swoilz AW-C d52" isn't guaranteed to be unique on the page once applied (e.g. it can also
    // show up as a body-picker option) — findAllByText just confirms it landed at all.
    await screen.findAllByText("Swoilz AW-C d52");

    // The fold itself is driven by a `useEffect` reacting to the `collapseSignal` prop change, a
    // separate commit AFTER the one `findAllByText` above resolved on (the dispatch-driven system
    // apply) — waitFor gives React room to flush that second commit instead of asserting too early.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /about & help/i })).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.getByRole("button", { name: /import system/i, expanded: false })).toBeInTheDocument();
    const hintDialog = screen.getByRole("dialog", { name: /live demo loaded/i });
    expect(hintDialog).toHaveTextContent(/objective/i);
    expect(hintDialog).toHaveTextContent(/solve for a system/i);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog", { name: /live demo loaded/i })).not.toBeInTheDocument();
  }, 25000);

  it("re-syncs the Journal file tab's shared body table when switching systems via the toolbar dropdown", async () => {
    // Regression test (2026-07-27 user report): "Import system"'s body/slot table didn't change
    // when switching systems via the sticky toolbar's own System dropdown. Root cause:
    // SystemPortabilityBar's `switchToSavedSystem` dispatches straight to `formState`, bypassing
    // JournalImportPanel's own `selectedAddress`/`systems` state (which its body table actually
    // renders from) entirely — unlike Live Demo/file import, which go through `loadParsedSystem`
    // and bump `refreshToken`, that state never got a chance to notice the switch. Fixed via a new
    // `activeSystemAddress` prop (== `formState.systemAddress`) JournalImportPanel now watches.
    //
    // Asserts against the shared body/slot table's own content rather than the Journal tab's own
    // "System" picker (unlike an earlier version of this test): that picker no longer reflects the
    // active system at all post-redesign (2026-07-27) — it only ever shows candidates from the
    // MOST RECENT upload, cleared once Applied. "Switch to an already-known system" is exclusively
    // the toolbar switcher's job now; the shared table re-syncing to match is what this regression
    // test actually cares about.
    const user = userEvent.setup();
    render(<App />);

    // System A: the journal fixture ("Test System A"), saved by applying it.
    await importAndApplyJournal(user);

    // System B: Live Demo (jsons/swoilz-aw-c-d52.json, "Swoilz AW-C d52") — also saves to the store.
    await user.click(screen.getByRole("button", { name: /live demo/i }));
    await screen.findAllByText("Swoilz AW-C d52");

    // Re-open "Import system" (the panel toggle, not the sticky toolbar's identically-named
    // "Import system" file-picker button — disambiguated by its own aria-expanded, since only
    // the panel toggle carries one) and confirm its shared body table now shows System B's own
    // body, not System A's. Scoped to the panel itself with `within` — these body names also show
    // up in the main "Actual facilities in the system" tree elsewhere on the page at the same time,
    // so an unscoped query would (correctly) find more than one match.
    await user.click(screen.getByRole("button", { name: /import system/i, expanded: false }));
    const importPanel = screen.getByRole("button", { name: /import system/i, expanded: true }).closest(".panel") as HTMLElement;
    await within(importPanel).findByText("Swoilz AW-C d52 9");
    expect(within(importPanel).queryByText("Test System A 2")).not.toBeInTheDocument();

    // Now switch BACK to System A via the sticky toolbar's own dropdown, not Live Demo/Apply.
    await user.selectOptions(screen.getByLabelText("Switch system"), "Test System A");

    // The shared table must now agree — this is the table that stayed stuck on System B before the
    // fix.
    await within(importPanel).findByText("Test System A 2");
    expect(within(importPanel).queryByText("Swoilz AW-C d52 9")).not.toBeInTheDocument();
  }, 25000);

  it("shows an error banner when the solver reports infeasibility", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Score constraints now live inline in the Objective panel (always visible, no fold to open).
    // An unreachable constraint -> infeasible, regardless of how many slots are available.
    await user.type(screen.getByLabelText(/minimum security/i), "1000");
    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");
    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    expect(await screen.findByText(/no possible system arrangement/i, {}, { timeout: 20000 })).toBeInTheDocument();
  }, 25000);
});

describe("buildSolverInput", () => {
  function bodyOfKind(kind: JournalBody["kind"], bodyId: number): JournalBody {
    return { bodyName: `Test ${kind} ${bodyId}`, bodyId, kind, landable: false, parents: [], rings: [], raw: {} };
  }

  // 2026-07-28 user report, direct in-game testing: a star belt's own dedicated synthetic body
  // (`kind: "ring"`) is asteroid-exclusive; a ringed PLANET's own slot is not (see solve.ts's
  // `SolverBody.asteroidExclusive` and CLAUDE.md's "Star belts vs. planet rings").
  it("marks only a kind: \"ring\" body as asteroidExclusive, not a planet or star", () => {
    const formState = { ...INITIAL_FORM_STATE, bodies: [bodyOfKind("ring", 1), bodyOfKind("planet", 2), bodyOfKind("star", 3)] };
    const input = buildSolverInput(formState);
    const byId = new Map(input.bodies!.map((b) => [b.bodyId, b]));
    expect(byId.get(1)!.asteroidExclusive).toBe(true);
    expect(byId.get(2)!.asteroidExclusive).toBe(false);
    expect(byId.get(3)!.asteroidExclusive).toBe(false);
  });
});
