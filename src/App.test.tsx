// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
