// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalBody } from "../journal/parser";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { ObjectivePanel } from "./ObjectivePanel";

function star(bodyId: number): JournalBody {
  return { bodyName: `Star ${bodyId}`, bodyId, kind: "star", landable: false, parents: [], rings: [], raw: {} };
}

function renderPanel(formState: PlannerFormState, dispatch = vi.fn()) {
  render(<ObjectivePanel formState={formState} dispatch={dispatch} onSolve={vi.fn()} solving={false} />);
  return dispatch;
}

describe("ObjectivePanel's Economy preferences section", () => {
  beforeEach(() => {
    // Fold state is persisted via persistence/panelCollapse.ts — clear so each test starts from
    // this component's own default (expanded), not whatever a previous test left behind.
    localStorage.clear();
  });

  it("is disabled (with an explanatory hint, no per-economy controls) when no per-body layout is applied", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByText(/Requires a per-body system layout/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Military: Forbid" })).not.toBeInTheDocument();
  });

  it("renders one row per EconomyType, defaulting to Dunno, once a per-body layout is applied", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("radio", { name: "Military: Dunno" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Military: Forbid" })).not.toBeChecked();
    // Spot-check a couple more of the 9 EconomyType rows are present too.
    expect(screen.getByRole("radio", { name: "Agriculture: Dunno" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Colony: Dunno" })).toBeChecked();
  });

  it("reflects an already-set preference as the checked radio", () => {
    renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: "forbid" },
    });
    expect(screen.getByRole("radio", { name: "Military: Forbid" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Military: Dunno" })).not.toBeChecked();
  });

  it("dispatches setEconomyPreference with the picked value on click", async () => {
    const user = userEvent.setup();
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("radio", { name: "Military: Forbid" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: "forbid" });
  });

  it("dispatches value: undefined when clicking back to Dunno", async () => {
    const user = userEvent.setup();
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: "want" },
    });
    await user.click(screen.getByRole("radio", { name: "Military: Dunno" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: undefined });
  });
});

describe("ObjectivePanel's primary station reminder", () => {
  it("shows an accent-colored hint next to the disabled Solve button when no primary station is set", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByRole("button", { name: "Solve for a system" })).toBeDisabled();
    expect(screen.getByText(/Pick a primary station in "Actual facilities in the system"/)).toHaveClass(
      "panel-hint-accent",
    );
  });

  it("hides the reminder once a primary station is picked", () => {
    renderPanel({ ...INITIAL_FORM_STATE, firstStationBuilding: "Coriolis" });
    expect(screen.getByRole("button", { name: "Solve for a system" })).toBeEnabled();
    expect(screen.queryByText(/Pick a primary station in "Actual facilities in the system"/)).not.toBeInTheDocument();
  });
});

describe("ObjectivePanel's foldable sub-sections", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("Score constraints and Economy preferences use the nested (smaller/yellow) toggle style, not a top-level one", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveClass("panel-toggle-nested");
    expect(screen.getByRole("button", { name: /Economy preferences/ })).toHaveClass("panel-toggle-nested");
  });

  it("Score constraints and Economy preferences both default to expanded", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Economy preferences/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Minimum security" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Military: Dunno" })).toBeInTheDocument();
  });

  it("folding Score constraints hides its table without affecting Economy preferences", async () => {
    const user = userEvent.setup();
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("button", { name: /Score constraints/ }));
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Minimum security" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Military: Dunno" })).toBeInTheDocument();
  });
});
