// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
