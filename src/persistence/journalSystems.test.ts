// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { JournalSystem } from "../journal/parser";
import {
  deleteSystem,
  getLastUsedSystemAddress,
  listSavedSystems,
  saveSystem,
  setLastUsedSystemAddress,
} from "./journalSystems";

const SYSTEM_A: JournalSystem = {
  starSystem: "HIP 48661",
  systemAddress: 663362718067,
  bodies: [
    {
      bodyName: "HIP 48661 A",
      bodyId: 1,
      kind: "star",
      landable: false,
      parents: [],
      rings: [],
      slots: { space: 1, ground: 0, asteroid: 0 },
      raw: { event: "Scan", BodyName: "HIP 48661 A" },
    },
  ],
};

const SYSTEM_B: JournalSystem = {
  starSystem: "Swoilz AW-C d52",
  systemAddress: 1797250861443,
  bodies: [],
};

beforeEach(() => {
  localStorage.clear();
});

describe("journal system persistence", () => {
  it("round-trips a saved system through localStorage", () => {
    saveSystem(SYSTEM_A);
    const systems = listSavedSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0]).toEqual(SYSTEM_A);
  });

  it("overwrites a system saved again under the same system address", () => {
    saveSystem(SYSTEM_A);
    const updated = { ...SYSTEM_A, bodies: [...SYSTEM_A.bodies, { ...SYSTEM_A.bodies[0], bodyId: 2 }] };
    saveSystem(updated);
    const systems = listSavedSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0].bodies).toHaveLength(2);
  });

  it("lists multiple saved systems sorted by name", () => {
    saveSystem(SYSTEM_B);
    saveSystem(SYSTEM_A);
    const systems = listSavedSystems();
    expect(systems.map((s) => s.starSystem)).toEqual(["HIP 48661", "Swoilz AW-C d52"]);
  });

  it("deleteSystem removes only the targeted system", () => {
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_B);
    deleteSystem(SYSTEM_A.systemAddress);
    const systems = listSavedSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0].starSystem).toBe("Swoilz AW-C d52");
  });

  it("deleteSystem clears the last-used pointer when it targets the deleted system", () => {
    saveSystem(SYSTEM_A);
    setLastUsedSystemAddress(SYSTEM_A.systemAddress);
    deleteSystem(SYSTEM_A.systemAddress);
    expect(getLastUsedSystemAddress()).toBeNull();
  });

  it("deleteSystem leaves the last-used pointer untouched when it targets a different system", () => {
    saveSystem(SYSTEM_A);
    saveSystem(SYSTEM_B);
    setLastUsedSystemAddress(SYSTEM_B.systemAddress);
    deleteSystem(SYSTEM_A.systemAddress);
    expect(getLastUsedSystemAddress()).toBe(SYSTEM_B.systemAddress);
  });

  it("migrates a system with a pre-1.7.0 ring bodyId on read, and writes the migrated form back to storage", () => {
    const staleSystem: JournalSystem = {
      starSystem: "Swoilz CD-E c1-1",
      systemAddress: 359200166666,
      bodies: [
        {
          bodyName: "Swoilz CD-E c1-1",
          bodyId: 0,
          kind: "star",
          landable: false,
          parents: [],
          rings: [{ name: "A Belt", ringClass: "Rocky", massMT: 1 }],
          raw: {},
        },
        {
          bodyName: "A Belt",
          bodyId: 1_000_000,
          kind: "ring",
          landable: false,
          parents: [{ type: "Star", bodyId: 0 }],
          rings: [{ name: "A Belt", ringClass: "Rocky", massMT: 1 }],
          raw: {},
          slots: { space: 1, ground: 0, asteroid: 1 },
        },
      ],
      firstStationBuilding: "Asteroid_Base",
      firstStationBodyId: 1_000_000,
    };
    // Bypasses `saveSystem` (which would write current-scheme data fresh) to simulate genuinely
    // stale localStorage content from before this migration existed.
    localStorage.setItem("edcp:journalSystems", JSON.stringify({ [staleSystem.systemAddress]: staleSystem }));

    const [migrated] = listSavedSystems();
    expect(migrated.bodies.find((b) => b.kind === "ring")?.bodyId).toBe(100000);
    expect(migrated.bodies.find((b) => b.kind === "ring")?.slots).toEqual({ space: 1, ground: 0, asteroid: 1 });
    expect(migrated.firstStationBodyId).toBe(100000);

    // Written back, so a second read doesn't need to migrate again.
    const raw = JSON.parse(localStorage.getItem("edcp:journalSystems")!);
    expect(raw[staleSystem.systemAddress].firstStationBodyId).toBe(100000);
  });
});
