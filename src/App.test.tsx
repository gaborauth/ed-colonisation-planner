// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import FIXTURE from "./journal/fixtures/sample.jsonl?raw";

// The "Actual facilities in the system" panel's slot fields are read-only (derived from a journal
// import) now that "Enter slots manually" no longer exists — so every end-to-end test unlocks the
// panel the same way a real user would, by uploading a journal and applying its (guessed) body
// layout.
async function importAndApplyJournal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const file = new File([FIXTURE], "journal.log", { type: "text/plain" });
  await user.upload(screen.getByLabelText("Journal file"), file);
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

  it("shows an error banner when the solver reports infeasibility", async () => {
    const user = userEvent.setup();
    render(<App />);

    // System score constraints is folded by default — expand it to reach the field.
    await user.click(screen.getByRole("button", { name: /system score constraints/i }));
    // An unreachable constraint -> infeasible, regardless of how many slots are available.
    await user.type(screen.getByLabelText(/minimum security/i), "1000");
    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");
    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    expect(await screen.findByText(/no possible system arrangement/i, {}, { timeout: 20000 })).toBeInTheDocument();
  }, 25000);
});
