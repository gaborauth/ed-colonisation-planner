// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { JournalSystem } from "../journal/parser";
import { deleteSystem, listSavedSystems, saveSystem } from "./journalSystems";

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
});
