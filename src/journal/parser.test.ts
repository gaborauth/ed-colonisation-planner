import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { parseJournalScans } from "./parser";

describe("parseJournalScans", () => {
  it("groups scanned bodies by system, keeping only real bodies (not belt-cluster fragments)", () => {
    const systems = parseJournalScans(FIXTURE);
    expect(systems).toHaveLength(1);
    const [system] = systems;
    expect(system.starSystem).toBe("Test System A");
    expect(system.bodies.map((b) => b.bodyName)).toEqual([
      "Test System A",
      "Test System A 1",
      "Test System A 2",
      "Test System A 3",
    ]);
  });

  it("classifies stars vs planets and carries over landable/gravity/rings", () => {
    const [system] = parseJournalScans(FIXTURE);
    const star = system.bodies.find((b) => b.bodyName === "Test System A")!;
    expect(star.kind).toBe("star");
    expect(star.rings).toHaveLength(1);
    expect(star.rings[0].ringClass).toBe("eRingClass_MetalRich");

    const landable = system.bodies.find((b) => b.bodyName === "Test System A 2")!;
    expect(landable.kind).toBe("planet");
    expect(landable.landable).toBe(true);
    expect(landable.surfaceGravity).toBeCloseTo(0.7);

    const gasGiant = system.bodies.find((b) => b.bodyName === "Test System A 1")!;
    expect(gasGiant.landable).toBe(false);
    expect(gasGiant.rings).toHaveLength(1);
  });

  it("ignores malformed lines and non-Scan events without throwing", () => {
    const text = `not json\n${FIXTURE}\n{"event":"Music"}\n`;
    expect(() => parseJournalScans(text)).not.toThrow();
    expect(parseJournalScans(text)).toHaveLength(1);
  });

  it("de-duplicates a body scanned twice, keeping the later scan", () => {
    const doubled = `${FIXTURE}\n${FIXTURE}`;
    const [system] = parseJournalScans(doubled);
    expect(system.bodies).toHaveLength(4);
  });
});
