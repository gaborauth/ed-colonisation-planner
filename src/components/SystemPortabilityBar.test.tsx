// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalBody, JournalSystem } from "../journal/parser";
import { saveSystem } from "../persistence/journalSystems";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { SystemPortabilityBar } from "./SystemPortabilityBar";

function star(bodyId: number): JournalBody {
  return { bodyName: `Star ${bodyId}`, bodyId, kind: "star", landable: false, parents: [], rings: [], raw: {} };
}

const SYSTEM_A: JournalSystem = { starSystem: "System A", systemAddress: 1, bodies: [star(0)] };
const SYSTEM_B: JournalSystem = { starSystem: "System B", systemAddress: 2, bodies: [star(0)] };

function formStateFor(system: JournalSystem): PlannerFormState {
  return {
    ...INITIAL_FORM_STATE,
    bodies: system.bodies,
    starSystem: system.starSystem,
    systemAddress: system.systemAddress,
  };
}

describe("SystemPortabilityBar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the system name as plain text when only one (or zero) systems are saved", () => {
    saveSystem(SYSTEM_A);
    render(<SystemPortabilityBar formState={formStateFor(SYSTEM_A)} dispatch={vi.fn()} />);
    expect(screen.getByText("System A")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Switch system" })).not.toBeInTheDocument();
  });

  it("shows a switcher (with a placeholder) even when no system is currently active, as long as one is saved — the reload-loses-the-dropdown regression", async () => {
    // Regression test: formState starting blank (systemAddress: null) is exactly what happens on a
    // fresh page load when JournalImportPanel's mount-effect doesn't auto-restore the last-used
    // system (it only does when that system had a primary station saved already) — the toolbar
    // summary, and the switcher inside it, used to stay hidden entirely until the user re-imported.
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_B);
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(<SystemPortabilityBar formState={INITIAL_FORM_STATE} dispatch={dispatch} />);

    const switcher = screen.getByRole("combobox", { name: "Switch system" });
    expect(switcher).toHaveValue(""); // placeholder, nothing "current" yet

    await user.selectOptions(switcher, "1");

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({ systemAddress: 1, starSystem: "System A", systemConfigured: true }),
      }),
    );
  });

  it("shows a switcher dropdown once more than one system is saved, and switching dispatches the other system's saved data", async () => {
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_B);
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(<SystemPortabilityBar formState={formStateFor(SYSTEM_A)} dispatch={dispatch} />);

    const switcher = screen.getByRole("combobox", { name: "Switch system" });
    expect(switcher).toHaveValue("1");

    await user.selectOptions(switcher, "2");

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({
          systemAddress: 2,
          starSystem: "System B",
          systemConfigured: true,
        }),
      }),
    );
  });
});
