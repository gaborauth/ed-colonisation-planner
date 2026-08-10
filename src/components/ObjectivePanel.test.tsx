// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalBody } from "../journal/parser";
import { setStoredPanelCollapsed } from "../persistence/panelCollapse";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { ObjectivePanel } from "./ObjectivePanel";

function star(bodyId: number): JournalBody {
  return { bodyName: `Star ${bodyId}`, bodyId, kind: "star", landable: false, parents: [], rings: [], raw: {} };
}

function renderPanel(formState: PlannerFormState, dispatch = vi.fn()) {
  render(<ObjectivePanel formState={formState} dispatch={dispatch} onSolve={vi.fn()} solving={false} result={null} />);
  return dispatch;
}

function renderPanelWithRerender(formState: PlannerFormState) {
  const dispatch = vi.fn();
  const { rerender } = render(
    <ObjectivePanel formState={formState} dispatch={dispatch} onSolve={vi.fn()} solving={false} result={null} />,
  );
  return {
    dispatch,
    rerenderWith: (next: PlannerFormState) =>
      rerender(<ObjectivePanel formState={next} dispatch={dispatch} onSolve={vi.fn()} solving={false} result={null} />),
  };
}

describe("ObjectivePanel's Economy preferences section", () => {
  beforeEach(() => {
    // Fold state is persisted via persistence/panelCollapse.ts — clear so each test starts from a
    // clean slate, then explicitly force this section open. Economy preferences now defaults to
    // COLLAPSED (2026-07-28 user request — see "ObjectivePanel's foldable sub-sections" below for
    // the dedicated tests on that default itself); these tests are about the section's own
    // checkbox/slider behavior once opened, not about the fold default, so they force it open
    // rather than clicking through the toggle in every single test.
    localStorage.clear();
    setStoredPanelCollapsed("objective-economy-preferences", false);
  });

  it("is disabled (with an explanatory hint, no per-economy controls) when no per-body layout is applied", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByText(/Requires a per-body system layout/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Military: enable preference" })).not.toBeInTheDocument();
  });

  it("renders one row per EconomyType, defaulting to unchecked/unbiased, once a per-body layout is applied", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("checkbox", { name: "Military: enable preference" })).not.toBeChecked();
    // The slider stays a real, interactive control even while unchecked (see ObjectivePanel.tsx's
    // comment on why it's never `disabled`) — dragging or clicking it is itself how a user opts in.
    expect(screen.getByRole("slider", { name: /Military: preference/ })).toBeEnabled();
    // Spot-check a couple more of the 9 EconomyType rows are present too.
    expect(screen.getByRole("checkbox", { name: "Agriculture: enable preference" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Colony: enable preference" })).not.toBeChecked();
  });

  it("reflects an already-set Forbid preference as a checked checkbox and slider value 0", () => {
    renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: "forbid" },
    });
    expect(screen.getByRole("checkbox", { name: "Military: enable preference" })).toBeChecked();
    expect(screen.getByRole("slider", { name: /Military: preference/ })).toHaveValue("0");
  });

  it("dispatches forbid when the slider is moved to 0", () => {
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: 100 },
    });
    fireEvent.change(screen.getByRole("slider", { name: /Military: preference/ }), { target: { value: "0" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: "forbid" });
  });

  it("dispatches a numeric value when the slider is moved above 0, implicitly enabling it even from the unchecked/inactive state", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    fireEvent.change(screen.getByRole("slider", { name: /Military: preference/ }), { target: { value: "150" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: 150 });
  });

  it("dispatches value: undefined when unchecking an already-enabled preference", async () => {
    const user = userEvent.setup();
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: 100 },
    });
    await user.click(screen.getByRole("checkbox", { name: "Military: enable preference" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: undefined });
  });

  it("dispatches the neutral default (50) when checking the box from the unchecked default", async () => {
    const user = userEvent.setup();
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("checkbox", { name: "Military: enable preference" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: 50 });
  });

  it("the number field beside the slider shows the same value, blank while unchecked", () => {
    const { rerender } = render(
      <ObjectivePanel
        formState={{ ...INITIAL_FORM_STATE, bodies: [star(0)] }}
        dispatch={vi.fn()}
        onSolve={vi.fn()}
        solving={false}
        result={null}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Military: preference number (0-200)" })).toHaveValue("");
    rerender(
      <ObjectivePanel
        formState={{ ...INITIAL_FORM_STATE, bodies: [star(0)], economyPreferences: { Military: 120 } }}
        dispatch={vi.fn()}
        onSolve={vi.fn()}
        solving={false}
        result={null}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Military: preference number (0-200)" })).toHaveValue("120");
  });

  it("typing a value into the number field dispatches it, implicitly enabling it from the unchecked state", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    fireEvent.change(screen.getByRole("textbox", { name: "Military: preference number (0-200)" }), {
      target: { value: "150" },
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: 150 });
  });

  it("typing 0 into the number field dispatches forbid, mirroring the slider", () => {
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: 100 },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Military: preference number (0-200)" }), {
      target: { value: "0" },
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: "forbid" });
  });

  it("clicking the number field enables it at the neutral default (50) when unchecked, same as the checkbox", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    fireEvent.click(screen.getByRole("textbox", { name: "Military: preference number (0-200)" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: 50 });
  });

  it("merely focusing (e.g. keyboard Tab-through) the number field does NOT enable it — only a real click or typed value does", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    fireEvent.focus(screen.getByRole("textbox", { name: "Military: preference number (0-200)" }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("clearing the number field and blurring dispatches undefined, unchecking the box (NumberInput's own blank-on-blur convention)", () => {
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [star(0)],
      economyPreferences: { Military: 100 },
    });
    const field = screen.getByRole("textbox", { name: "Military: preference number (0-200)" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(dispatch).toHaveBeenCalledWith({ type: "setEconomyPreference", economy: "Military", value: undefined });
  });
});

describe("ObjectivePanel's Self-sufficiency section", () => {
  function cleanRockyPlanet(bodyId: number): JournalBody {
    return {
      bodyName: `Planet ${bodyId}`,
      bodyId,
      kind: "planet",
      planetClass: "Rocky body",
      landable: true,
      hasBiologicalSignals: false,
      hasGeologicalSignals: false,
      parents: [{ type: "Star", bodyId: 0 }],
      rings: [],
      raw: {},
      slots: { space: 1, ground: 5, asteroid: 0 },
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to collapsed when no per-body layout is applied at all", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an explanatory hint and no checkboxes once manually expanded with no per-body layout applied", async () => {
    const user = userEvent.setup();
    renderPanel(INITIAL_FORM_STATE);
    await user.click(screen.getByRole("button", { name: /Self-sufficiency/ }));
    expect(screen.getByText(/Requires a per-body system layout/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Commodity Hub/ })).not.toBeInTheDocument();
  });

  it("defaults to collapsed when bodies exist but none are eligible for either combo", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("defaults to EXPANDED as soon as at least one body is eligible for either combo", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Commodity Hub–eligible bodies: 1")).toBeInTheDocument();
    expect(screen.getByText("Manufacturing Hub–eligible bodies: 1")).toBeInTheDocument();
  });

  it("auto-expands on a rerender once eligibility newly appears, without needing a manual click", () => {
    const { rerenderWith } = renderPanelWithRerender({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
    rerenderWith({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("auto-collapses on a rerender once eligibility disappears", () => {
    const { rerenderWith } = renderPanelWithRerender({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "true");
    rerenderWith({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("doesn't fight a manual toggle while eligibility stays unchanged across rerenders", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderPanelWithRerender({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: /Self-sufficiency/ }));
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
    // Same single eligible body, just a fresh array reference — an unrelated rerender must not
    // silently re-force this back open.
    rerenderWith({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("button", { name: /Self-sufficiency/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders unchecked checkboxes by default and dispatches setSelfSufficiencyGoal on toggle", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    const commodityHubCheckbox = screen.getByRole("checkbox", { name: /Commodity Hub/ });
    expect(commodityHubCheckbox).not.toBeChecked();

    fireEvent.click(commodityHubCheckbox);
    expect(dispatch).toHaveBeenCalledWith({ type: "setSelfSufficiencyGoal", combo: "commodityHub", value: true });
  });

  it("reflects an already-checked goal from formState and unchecks it on toggle", () => {
    const dispatch = renderPanel({
      ...INITIAL_FORM_STATE,
      bodies: [cleanRockyPlanet(1)],
      selfSufficiencyGoals: { manufacturingHub: true },
    });
    const manufacturingHubCheckbox = screen.getByRole("checkbox", { name: /Manufacturing Hub/ });
    expect(manufacturingHubCheckbox).toBeChecked();

    fireEvent.click(manufacturingHubCheckbox);
    expect(dispatch).toHaveBeenCalledWith({ type: "setSelfSufficiencyGoal", combo: "manufacturingHub", value: false });
  });

  it("doesn't touch presentFacilities/T2/T3 points — the checkbox never places a present facility", () => {
    const dispatch = renderPanel({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    fireEvent.click(screen.getByRole("checkbox", { name: /Commodity Hub/ }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setFacilitySlot" }));
  });

  it("disables both checkboxes when manually expanded with no body currently eligible for either combo", async () => {
    const user = userEvent.setup();
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("button", { name: /Self-sufficiency/ }));
    expect(screen.getByRole("checkbox", { name: /Commodity Hub/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Manufacturing Hub/ })).toBeDisabled();
    expect(screen.getByText("Commodity Hub–eligible bodies: 0")).toBeInTheDocument();
    expect(screen.getByText("Manufacturing Hub–eligible bodies: 0")).toBeInTheDocument();
  });

  it("leaves the checkbox enabled when its combo has at least one eligible body", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [cleanRockyPlanet(1)] });
    expect(screen.getByRole("checkbox", { name: /Commodity Hub/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Manufacturing Hub/ })).toBeEnabled();
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

describe("ObjectivePanel's Score constraints rows", () => {
  it("capitalizes the score name and shows a short description under it", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText("security")).not.toBeInTheDocument();
    expect(screen.getByText("How safe the system is from piracy.")).toHaveClass("panel-hint");
  });

  it("places a divider after System score, separating real system stats from construction_cost onward", () => {
    renderPanel(INITIAL_FORM_STATE);
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(".score-constraints-table tbody tr"));
    const systemScoreIndex = rows.findIndex((r) => r.textContent?.includes("System score"));
    const dividerIndex = rows.findIndex((r) => r.getAttribute("aria-hidden") === "true");
    const constructionIndex = rows.findIndex((r) => r.textContent?.includes("Construction cost"));
    expect(dividerIndex).toBe(systemScoreIndex + 1);
    expect(constructionIndex).toBe(dividerIndex + 1);
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

  it("Score constraints defaults to expanded, Economy preferences defaults to collapsed", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Economy preferences/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("textbox", { name: "Minimum security" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Military: enable preference" })).not.toBeInTheDocument();
  });

  it("folding Score constraints hides its table without affecting Economy preferences' own (collapsed) state", async () => {
    const user = userEvent.setup();
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("button", { name: /Score constraints/ }));
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Minimum security" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Economy preferences/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("expanding Economy preferences works independently of Score constraints", async () => {
    const user = userEvent.setup();
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    await user.click(screen.getByRole("button", { name: /Economy preferences/ }));
    expect(screen.getByRole("button", { name: /Economy preferences/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Military: enable preference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Score constraints/ })).toHaveAttribute("aria-expanded", "true");
  });
});
