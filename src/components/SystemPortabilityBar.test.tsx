// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalBody, JournalSystem } from "../journal/parser";
import { getLastUsedSystemAddress, listSavedSystems, saveSystem, setLastUsedSystemAddress } from "../persistence/journalSystems";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { SystemPortabilityBar } from "./SystemPortabilityBar";

function star(bodyId: number): JournalBody {
  return { bodyName: `Star ${bodyId}`, bodyId, kind: "star", landable: false, parents: [], rings: [], raw: {} };
}

const SYSTEM_A: JournalSystem = { starSystem: "System A", systemAddress: 1, bodies: [star(0)] };
const SYSTEM_B: JournalSystem = { starSystem: "System B", systemAddress: 2, bodies: [star(0)] };
const SYSTEM_WITH_RC: JournalSystem = {
  starSystem: "System RC",
  systemAddress: 3,
  bodies: [star(0)],
  ravenColonialSkeleton: { name: "System RC", id64: 3, bodies: [], sites: [], slots: {} },
};

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

  it("auto-restores the last-used saved system on mount (moved here from JournalImportPanel, 2026-07-27 — see that panel's now-removed mount effect)", () => {
    saveSystem(SYSTEM_A);
    setLastUsedSystemAddress(SYSTEM_A.systemAddress);
    const dispatch = vi.fn();
    render(<SystemPortabilityBar formState={INITIAL_FORM_STATE} dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({ systemAddress: 1, starSystem: "System A", systemConfigured: true }),
      }),
    );
  });

  it("carries a saved system's Raven Colonial skeleton along when switching to it via the dropdown — regression for the skeleton silently disappearing after a switch/reload", async () => {
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_WITH_RC);
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(<SystemPortabilityBar formState={formStateFor(SYSTEM_A)} dispatch={dispatch} />);

    const switcher = screen.getByRole("combobox", { name: "Switch system" });
    await user.selectOptions(switcher, "3");

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({ systemAddress: 3, ravenColonialSkeleton: SYSTEM_WITH_RC.ravenColonialSkeleton }),
      }),
    );
  });

  it("carries a saved system's Raven Colonial skeleton along on mount-time auto-restore too", () => {
    saveSystem(SYSTEM_WITH_RC);
    setLastUsedSystemAddress(SYSTEM_WITH_RC.systemAddress);
    const dispatch = vi.fn();
    render(<SystemPortabilityBar formState={INITIAL_FORM_STATE} dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({ systemAddress: 3, ravenColonialSkeleton: SYSTEM_WITH_RC.ravenColonialSkeleton }),
      }),
    );
  });

  it("does not auto-restore when a system is already active", () => {
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_B);
    setLastUsedSystemAddress(SYSTEM_A.systemAddress);
    const dispatch = vi.fn();
    render(<SystemPortabilityBar formState={formStateFor(SYSTEM_B)} dispatch={dispatch} />);
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe("Delete", () => {
    it("is disabled when no system is active", () => {
      render(<SystemPortabilityBar formState={INITIAL_FORM_STATE} dispatch={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    });

    it("does nothing when the user cancels the confirm dialog", async () => {
      saveSystem(SYSTEM_A);
      const dispatch = vi.fn();
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<SystemPortabilityBar formState={formStateFor(SYSTEM_A)} dispatch={dispatch} />);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(listSavedSystems().some((s) => s.systemAddress === SYSTEM_A.systemAddress)).toBe(true);
      confirmSpy.mockRestore();
    });

    it("deletes the active system, resets formState, clears the stale result, and refreshes siblings when confirmed", async () => {
      saveSystem(SYSTEM_A);
      setLastUsedSystemAddress(SYSTEM_A.systemAddress);
      const dispatch = vi.fn();
      const onSystemChanged = vi.fn();
      const onImported = vi.fn();
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(
        <SystemPortabilityBar
          formState={formStateFor(SYSTEM_A)}
          dispatch={dispatch}
          onSystemChanged={onSystemChanged}
          onImported={onImported}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith({ type: "reset" });
      expect(onSystemChanged).toHaveBeenCalled();
      expect(onImported).toHaveBeenCalled();
      expect(listSavedSystems().some((s) => s.systemAddress === SYSTEM_A.systemAddress)).toBe(false);
      // The dangling last-used pointer must go with it too, or the next mount would try (and fail)
      // to restore a system that no longer exists.
      expect(getLastUsedSystemAddress()).toBeNull();
      confirmSpy.mockRestore();
    });
  });
});
