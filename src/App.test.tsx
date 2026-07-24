// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import FIXTURE from "./journal/fixtures/sample.jsonl?raw";

// The System facilities panel's slot fields are read-only (derived from a journal import) now that "Enter
// slots manually" no longer exists — so every end-to-end test unlocks the panel the same way a
// real user would, by uploading a journal and applying its (guessed) body layout.
async function importAndApplyJournal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const file = new File([FIXTURE], "journal.log", { type: "text/plain" });
  await user.upload(screen.getByLabelText("Journal file"), file);
  await user.click(await screen.findByRole("button", { name: "Apply slots and body layout to System facilities" }));
}

describe("App", () => {
  it("solves a minimal system end-to-end with the real solver and renders results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");

    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    const resultHeading = await screen.findByRole("heading", { name: "Result" }, { timeout: 20000 });
    expect(resultHeading).toBeInTheDocument();
    expect(screen.getByText("Build order")).toBeInTheDocument();
    // "First station: Coriolis" stat tile in the results panel — "Coriolis" appears many times
    // elsewhere on the page, so scope the lookup to the results panel specifically.
    const resultsPanel = resultHeading.closest(".hud-panel") as HTMLElement;
    expect(within(resultsPanel).getByText("First station").closest(".stat-tile")).toHaveTextContent(
      "Coriolis",
    );
  }, 25000);

  it("shows an error banner when the solver reports infeasibility", async () => {
    const user = userEvent.setup();
    render(<App />);

    // An unreachable constraint -> infeasible, regardless of how many slots are available.
    await user.type(screen.getByLabelText(/minimum security/i), "1000");
    await importAndApplyJournal(user);
    await user.selectOptions(screen.getByLabelText(/Primary station/), "Coriolis");
    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    expect(await screen.findByText(/no possible system arrangement/i, {}, { timeout: 20000 })).toBeInTheDocument();
  }, 25000);
});
