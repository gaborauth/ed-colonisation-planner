import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import { buildBodyHierarchy } from "./bodyHierarchy";

function makeBody(bodyId: number, bodyName: string): JournalBody {
  return { bodyName, bodyId, kind: "planet", landable: false, parents: [], rings: [], raw: {} };
}

describe("buildBodyHierarchy", () => {
  it("nests a star/planet/moon/sub-moon chain per the naming convention", () => {
    const starSystem = "Swoilz AW-C d52";
    const bodies = [
      makeBody(1, "Swoilz AW-C d52 B 10 e a"),
      makeBody(2, "Swoilz AW-C d52 B 10 e"),
      makeBody(3, "Swoilz AW-C d52 B 10"),
      makeBody(4, "Swoilz AW-C d52 B"),
    ];
    const root = buildBodyHierarchy(starSystem, bodies);

    expect(root.label).toBe(starSystem);
    expect(root.body).toBeNull(); // multi-star system: no bare-system-name body
    expect(root.children).toHaveLength(1);

    const starB = root.children[0];
    expect(starB.label).toBe("B");
    expect(starB.path).toBe("B");
    expect(starB.body?.bodyId).toBe(4);
    expect(starB.children).toHaveLength(1);

    const planet10 = starB.children[0];
    expect(planet10.label).toBe("10");
    expect(planet10.path).toBe("B 10");
    expect(planet10.body?.bodyId).toBe(3);
    expect(planet10.children).toHaveLength(1);

    const moonE = planet10.children[0];
    expect(moonE.label).toBe("e");
    expect(moonE.path).toBe("B 10 e");
    expect(moonE.body?.bodyId).toBe(2);
    expect(moonE.children).toHaveLength(1);

    const subMoonA = moonE.children[0];
    expect(subMoonA.label).toBe("a");
    expect(subMoonA.path).toBe("B 10 e a");
    expect(subMoonA.body?.bodyId).toBe(1);
    expect(subMoonA.children).toHaveLength(0);
  });

  it("creates a synthetic (body: null) node for a never-individually-scanned ancestor", () => {
    // Planet 10 itself was never scanned, but its moon "e" was — "10" must still appear as a
    // grouping node so "e" nests correctly, per the "missing branches" case.
    const starSystem = "Swoilz AW-C d52";
    const bodies = [makeBody(1, "Swoilz AW-C d52 B 10 e"), makeBody(2, "Swoilz AW-C d52 B")];
    const root = buildBodyHierarchy(starSystem, bodies);

    const starB = root.children[0];
    expect(starB.body?.bodyId).toBe(2);
    const planet10 = starB.children[0];
    expect(planet10.label).toBe("10");
    expect(planet10.body).toBeNull();
    expect(planet10.children[0].body?.bodyId).toBe(1);
  });

  it("treats a single, bare-named star as the root itself, not a separate child", () => {
    const starSystem = "Swoilz AW-C d52";
    const bodies = [makeBody(1, "Swoilz AW-C d52"), makeBody(2, "Swoilz AW-C d52 1")];
    const root = buildBodyHierarchy(starSystem, bodies);

    expect(root.body?.bodyId).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].label).toBe("1");
    expect(root.children[0].body?.bodyId).toBe(2);
  });

  it("sorts children naturally/numerically at every level", () => {
    const starSystem = "Sys";
    const bodies = [
      makeBody(1, "Sys 10"),
      makeBody(2, "Sys 2"),
      makeBody(3, "Sys 1"),
    ];
    const root = buildBodyHierarchy(starSystem, bodies);
    expect(root.children.map((c) => c.label)).toEqual(["1", "2", "10"]);
  });

  it("degrades to a single flat node for a body name that doesn't match the system prefix", () => {
    const root = buildBodyHierarchy("Sys", [makeBody(1, "Totally Different Name")]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].label).toBe("Totally Different Name");
    expect(root.children[0].body?.bodyId).toBe(1);
  });
});
