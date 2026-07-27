// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalBody, JournalSystem } from "../journal/parser";
import { saveSystem, setLastUsedSystemAddress } from "../persistence/journalSystems";
import { JournalImportPanel } from "./JournalImportPanel";

vi.mock("../spansh/api", () => ({
  searchSystemNames: vi.fn(),
  fetchSpanshSystemDump: vi.fn(),
}));

import { fetchSpanshSystemDump, searchSystemNames } from "../spansh/api";

const mockedSearch = vi.mocked(searchSystemNames);
const mockedFetchDump = vi.mocked(fetchSpanshSystemDump);

const CANDIDATE = { id64: 1797250861443, name: "Swoilz AW-C d52" };

const DUMP_RECORD = {
  name: "Swoilz AW-C d52",
  id64: 1797250861443,
  bodies: [
    { bodyId: 0, id64: 1797250861443, name: "Swoilz AW-C d52", type: "Star" as const, mainStar: true, subType: "F (White) Star" },
    { bodyId: 1, id64: 360305942698254, name: "Swoilz AW-C d52 1", type: "Planet" as const, subType: "Class III gas giant" },
  ],
};

describe("JournalImportPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedSearch.mockReset();
    mockedFetchDump.mockReset();
  });

  it("renames the panel to 'Import system' and shows both tabs", () => {
    render(<JournalImportPanel dispatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Import system/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Journal file" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Spansh" })).toBeInTheDocument();
  });

  it("searches, loads, and applies a system from the Spansh tab, feeding the same shared table and dispatch shape as a Journal import", async () => {
    mockedSearch.mockResolvedValue([CANDIDATE]);
    mockedFetchDump.mockResolvedValue(DUMP_RECORD);
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(<JournalImportPanel dispatch={dispatch} />);

    await user.click(screen.getByRole("tab", { name: "Spansh" }));
    await user.type(screen.getByLabelText("System name"), "Swoil");

    const option = await screen.findByRole("option", { name: "Swoilz AW-C d52" });
    await user.click(option);
    expect(mockedSearch).toHaveBeenCalledWith("Swoil");

    const loadButton = screen.getByRole("button", { name: "Load" });
    expect(loadButton).toBeEnabled();
    await user.click(loadButton);

    expect(await screen.findByText("Swoilz AW-C d52 1")).toBeInTheDocument();
    expect(screen.getByText("Swoilz AW-C d52")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply slots and body layout to Actual facilities in the system" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({
          systemConfigured: true,
          systemAddress: 1797250861443,
          starSystem: "Swoilz AW-C d52",
          bodies: expect.arrayContaining([expect.objectContaining({ bodyName: "Swoilz AW-C d52 1" })]),
        }),
      }),
    );
  });

  it("auto-restores the last-used saved system on mount even without a saved primary station yet", () => {
    // Regression test: this used to require a saved primary station before auto-restoring, which
    // left a real inconsistency after a page reload — this panel's own selected-system state
    // (below) already defaults to the last-used system regardless of primary-station status, so it
    // visually looked "loaded" while the rest of the app (formState, the toolbar system switcher)
    // stayed blank until a primary station had been chosen and saved at least once.
    const star: JournalBody = { bodyName: "Star", bodyId: 0, kind: "star", landable: false, parents: [], rings: [], raw: {} };
    const system: JournalSystem = { starSystem: "System A", systemAddress: 42, bodies: [star] };
    saveSystem(system);
    setLastUsedSystemAddress(42);

    const dispatch = vi.fn();
    render(<JournalImportPanel dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch",
        patch: expect.objectContaining({ systemAddress: 42, starSystem: "System A", systemConfigured: true }),
      }),
    );
  });

  it("loading a second Spansh system after one is already applied still replaces the shown system (regression, 2026-07-27)", async () => {
    // Real bug: once `activeSystemAddress` (formState.systemAddress, mirroring what App.tsx would
    // pass down after a real Apply) is non-null, the "sync to formState" effect used to fire on
    // ANY divergence between it and this panel's own `selectedAddress` — including one caused by
    // this panel's OWN Spansh "Load" button setting `selectedAddress` to a not-yet-applied
    // candidate — and stomp `selectedAddress` straight back to `activeSystemAddress`, undoing the
    // Load a moment after it happened. Reproduced here by first applying System A (so
    // `activeSystemAddress` becomes non-null, matching what App.tsx would do after the dispatch),
    // then loading a different System B from Spansh and asserting B's body actually shows,
    // instead of reverting to A's.
    const starA: JournalBody = { bodyName: "Star", bodyId: 0, kind: "star", landable: false, parents: [], rings: [], raw: {} };
    const systemA: JournalSystem = { starSystem: "System A", systemAddress: 11, bodies: [starA] };
    saveSystem(systemA);

    mockedSearch.mockResolvedValue([CANDIDATE]);
    mockedFetchDump.mockResolvedValue(DUMP_RECORD);
    const dispatch = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<JournalImportPanel dispatch={dispatch} activeSystemAddress={null} />);

    // Simulate applying System A (Journal tab's existing "Apply" flow), then App.tsx re-rendering
    // this panel with the resulting formState.systemAddress, same as the real parent would.
    await user.click(screen.getByRole("button", { name: "Apply slots and body layout to Actual facilities in the system" }));
    rerender(<JournalImportPanel dispatch={dispatch} activeSystemAddress={11} />);

    // Applying folds the panel — reopen it before switching tabs.
    await user.click(screen.getByRole("button", { name: /Import system/ }));
    await user.click(screen.getByRole("tab", { name: "Spansh" }));
    await user.type(screen.getByLabelText("System name"), "Swoil");
    await user.click(await screen.findByRole("option", { name: "Swoilz AW-C d52" }));
    await user.click(screen.getByRole("button", { name: "Load" }));

    await screen.findByText("Swoilz AW-C d52 1");
    // The bug reverted this back to System A's (empty) body list a tick after the Load — assert it
    // stays showing System B even after the effect above has had a chance to run.
    await waitFor(() => expect(screen.getByText("Swoilz AW-C d52 1")).toBeInTheDocument());
    expect(screen.getByText("Swoilz AW-C d52")).toBeInTheDocument();
  });

  it("shows a readable error when the Spansh load fails", async () => {
    mockedSearch.mockResolvedValue([CANDIDATE]);
    mockedFetchDump.mockRejectedValue(new Error("Spansh proxy request failed (502)."));
    const user = userEvent.setup();
    render(<JournalImportPanel dispatch={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Spansh" }));
    await user.type(screen.getByLabelText("System name"), "Swoil");
    await user.click(await screen.findByRole("option", { name: "Swoilz AW-C d52" }));
    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(await screen.findByText("Spansh proxy request failed (502).")).toBeInTheDocument();
  });
});
