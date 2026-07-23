// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("solves a minimal system end-to-end with the real solver and renders results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Orbital slots"), "5");
    await user.type(screen.getByLabelText("Ground slots"), "5");
    await user.type(screen.getByLabelText("Asteroid slots"), "1");
    await user.click(screen.getByLabelText("Let the solver choose my first station"));
    await user.selectOptions(screen.getByLabelText("First station"), "Coriolis");

    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    const resultHeading = await screen.findByRole("heading", { name: "Result" }, { timeout: 20000 });
    expect(resultHeading).toBeInTheDocument();
    expect(screen.getByText("Build order")).toBeInTheDocument();
    // "First station: Coriolis" stat tile in the results panel, scoped to that panel — "First
    // station" is also a field label elsewhere on the page, and "Coriolis" appears many times.
    const resultsPanel = resultHeading.closest(".hud-panel") as HTMLElement;
    expect(within(resultsPanel).getByText("First station").closest(".stat-tile")).toHaveTextContent(
      "Coriolis",
    );
  }, 25000);

  it("shows an error banner when the solver reports infeasibility", async () => {
    const user = userEvent.setup();
    render(<App />);

    // No slots at all, plus an unreachable constraint -> infeasible.
    await user.type(screen.getByLabelText(/minimum security/i), "1000");
    await user.click(screen.getByLabelText("Let the solver choose my first station"));
    await user.selectOptions(screen.getByLabelText("First station"), "Coriolis");
    await user.click(screen.getByRole("button", { name: /solve for a system/i }));

    expect(await screen.findByText(/no possible system arrangement/i, {}, { timeout: 20000 })).toBeInTheDocument();
  }, 25000);
});
