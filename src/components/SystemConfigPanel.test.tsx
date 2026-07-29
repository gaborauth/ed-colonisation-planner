// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JournalBody } from "../journal/parser";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { SystemConfigPanel } from "./SystemConfigPanel";

function star(bodyId: number): JournalBody {
  return {
    bodyName: `Star ${bodyId}`,
    bodyId,
    kind: "star",
    landable: false,
    parents: [],
    rings: [],
    raw: {},
    slots: { space: 1, ground: 0, asteroid: 0 },
  };
}

function renderPanel(formState: PlannerFormState) {
  render(<SystemConfigPanel formState={formState} dispatch={vi.fn()} justSolved={null} />);
}

describe("SystemConfigPanel's Primary station field emphasis", () => {
  it("always shows the highlighted box with its description, regardless of whether a primary station is picked", () => {
    renderPanel(INITIAL_FORM_STATE);
    expect(screen.getByText(/The station you already have \(or plan to build first\)/)).toHaveClass("panel-hint");
    expect(
      screen.getByText(/The station you already have \(or plan to build first\)/).closest(".field-highlight"),
    ).toBeInTheDocument();

    renderPanel({ ...INITIAL_FORM_STATE, firstStationBuilding: "Coriolis" });
    expect(screen.getAllByText(/The station you already have \(or plan to build first\)/)[1]).toBeInTheDocument();
  });

  it("wraps the Primary station, On body, and System resource level fields in the same highlighted box", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)] });
    const box = screen.getByLabelText("Primary station *").closest(".field-highlight");
    expect(box).toBeInTheDocument();
    expect(box).toContainElement(screen.getByLabelText("On body *"));
    expect(box).toContainElement(screen.getByLabelText("System resource level"));
  });
});

describe("SystemConfigPanel's primary station body requirement", () => {
  it("On body defaults to unselected, requiring an explicit choice", () => {
    renderPanel({ ...INITIAL_FORM_STATE, bodies: [star(0)], firstStationBuilding: "Coriolis" });
    expect(screen.getByLabelText("On body *")).toHaveValue("");
  });
});
