import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { compareBodyNames, migrateRingBodyIds, parseJournalScans, withRingBodies, type JournalBody } from "./parser";

function star(bodyId: number, beltNames: string[]): JournalBody {
  return {
    bodyName: `Star ${bodyId}`,
    bodyId,
    kind: "star",
    landable: false,
    parents: [],
    rings: beltNames.map((name) => ({ name, ringClass: "Rocky", massMT: 1 })),
    raw: {},
  };
}

describe("parseJournalScans", () => {
  it("groups scanned bodies by system, keeping only real bodies (not belt-cluster fragments)", () => {
    const systems = parseJournalScans(FIXTURE);
    expect(systems).toHaveLength(1);
    const [system] = systems;
    expect(system.starSystem).toBe("Test System A");
    expect(system.bodies.filter((b) => b.kind !== "ring").map((b) => b.bodyName)).toEqual([
      "Test System A",
      "Test System A 1",
      "Test System A 2",
      "Test System A 3",
    ]);
    // Plus one synthesized `kind: "ring"` body for the STAR's own belt only — the gas giant's own
    // ring stays plain metadata on the planet itself (see eligibility.test.ts for that case).
    expect(system.bodies.filter((b) => b.kind === "ring").map((b) => b.bodyName)).toEqual(["Test System A A Ring"]);
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

  it("reads ReserveLevel as a top-level field on the ringed body's own Scan event, not nested per-ring", () => {
    // The user's own real journal line for a ringed body — ReserveLevel sits alongside Rings, not
    // inside any individual ring object.
    const real =
      '{"timestamp":"2025-03-27T10:38:08Z","event":"Scan","ScanType":"Detailed","BodyName":"Swoilz AW-C d52 11","BodyID":55,"Parents":[{"Star":0}],"StarSystem":"Swoilz AW-C d52","SystemAddress":1797250861443,"DistanceFromArrivalLS":5175.459216,"TidalLock":false,"TerraformState":"","PlanetClass":"Icy body","Landable":false,"Rings":[{"Name":"Swoilz AW-C d52 11 A Ring","RingClass":"eRingClass_Icy","MassMT":2.1732e9,"InnerRad":3.4816e7,"OuterRad":1.3348e8}],"ReserveLevel":"PristineResources","WasDiscovered":true,"WasMapped":false}';
    const [system] = parseJournalScans(real);
    const body = system.bodies[0];
    expect(body.reserveLevel).toBe("PristineResources");
    expect(body.rings).toEqual([{ name: "Swoilz AW-C d52 11 A Ring", ringClass: "eRingClass_Icy", massMT: 2.1732e9 }]);
  });

  it("parses tidal lock and the parent-body hierarchy", () => {
    const [system] = parseJournalScans(FIXTURE);
    const star = system.bodies.find((b) => b.bodyName === "Test System A")!;
    expect(star.tidalLocked).toBeUndefined(); // stars don't report TidalLock
    expect(star.parents).toEqual([{ type: "Null", bodyId: 0 }]);

    const rocky = system.bodies.find((b) => b.bodyName === "Test System A 2")!;
    expect(rocky.tidalLocked).toBe(true);
    expect(rocky.parents).toEqual([{ type: "Star", bodyId: 0 }]);

    const gasGiant = system.bodies.find((b) => b.bodyName === "Test System A 1")!;
    expect(gasGiant.tidalLocked).toBe(false);
  });

  it("ignores malformed lines and non-Scan events without throwing", () => {
    const text = `not json\n${FIXTURE}\n{"event":"Music"}\n`;
    expect(() => parseJournalScans(text)).not.toThrow();
    expect(parseJournalScans(text)).toHaveLength(1);
  });

  it("de-duplicates a body scanned twice, keeping the later scan", () => {
    const doubled = `${FIXTURE}\n${FIXTURE}`;
    const [system] = parseJournalScans(doubled);
    // 4 real bodies, deduplicated (not 8) + 1 synthesized star-belt ring body (not doubled either,
    // since ring synthesis runs once, after deduplication).
    expect(system.bodies.filter((b) => b.kind !== "ring")).toHaveLength(4);
    expect(system.bodies.filter((b) => b.kind === "ring")).toHaveLength(1);
  });
});

describe("FSSBodySignals parsing", () => {
  const bodySignals = (signals: string) =>
    `{"timestamp":"2026-01-01T00:00:06Z","event":"FSSBodySignals","BodyName":"Test System A 2","BodyID":2,"SystemAddress":1000001,"Signals":[${signals}]}`;

  it("confidently sets both flags true/false from the event's Signals list, regardless of line order relative to the Scan event", () => {
    const bioOnly = bodySignals('{"Type":"$SAA_SignalType_Biological;","Type_Localised":"Biological","Count":4}');
    // Before the body's own Scan line in the file.
    const before = parseJournalScans(`${bioOnly}\n${FIXTURE}`);
    const bodyBefore = before[0].bodies.find((b) => b.bodyId === 2)!;
    expect(bodyBefore.hasBiologicalSignals).toBe(true);
    expect(bodyBefore.hasGeologicalSignals).toBe(false); // present event, but no Geological entry -> confidently zero

    // After the body's own Scan line in the file.
    const after = parseJournalScans(`${FIXTURE}\n${bioOnly}`);
    const bodyAfter = after[0].bodies.find((b) => b.bodyId === 2)!;
    expect(bodyAfter.hasBiologicalSignals).toBe(true);
    expect(bodyAfter.hasGeologicalSignals).toBe(false);
  });

  it("sets hasGeologicalSignals from a Geological signal entry", () => {
    const geoOnly = bodySignals('{"Type":"$SAA_SignalType_Geological;","Type_Localised":"Geological","Count":3}');
    const [system] = parseJournalScans(`${FIXTURE}\n${geoOnly}`);
    const body = system.bodies.find((b) => b.bodyId === 2)!;
    expect(body.hasGeologicalSignals).toBe(true);
    expect(body.hasBiologicalSignals).toBe(false);
  });

  it("sets both flags true from one event whose Signals array combines Biological and Geological", () => {
    const combined = bodySignals(
      '{"Type":"$SAA_SignalType_Biological;","Type_Localised":"Biological","Count":2},' +
        '{"Type":"$SAA_SignalType_Geological;","Type_Localised":"Geological","Count":1}',
    );
    const [system] = parseJournalScans(`${FIXTURE}\n${combined}`);
    const body = system.bodies.find((b) => b.bodyId === 2)!;
    expect(body.hasBiologicalSignals).toBe(true);
    expect(body.hasGeologicalSignals).toBe(true);
  });

  it("merges (OR) rather than overwrites across two separate FSSBodySignals events for the same body", () => {
    // A journal spanning multiple sessions can honk the same body twice, each time reporting only
    // part of the picture — the later, geological-only event must not erase the earlier bio flag.
    const bioOnly = bodySignals('{"Type":"$SAA_SignalType_Biological;","Type_Localised":"Biological","Count":4}');
    const geoOnly = bodySignals('{"Type":"$SAA_SignalType_Geological;","Type_Localised":"Geological","Count":3}');
    const [system] = parseJournalScans(`${FIXTURE}\n${bioOnly}\n${geoOnly}`);
    const body = system.bodies.find((b) => b.bodyId === 2)!;
    expect(body.hasBiologicalSignals).toBe(true);
    expect(body.hasGeologicalSignals).toBe(true);

    // Order shouldn't matter either.
    const [reversed] = parseJournalScans(`${FIXTURE}\n${geoOnly}\n${bioOnly}`);
    const reversedBody = reversed.bodies.find((b) => b.bodyId === 2)!;
    expect(reversedBody.hasBiologicalSignals).toBe(true);
    expect(reversedBody.hasGeologicalSignals).toBe(true);
  });

  it("reproduces the user's own real journal lines: different bodies each getting their own single signal type", () => {
    const real = [
      '{"timestamp":"2025-03-27T10:36:01Z","event":"FSSBodySignals","BodyName":"Swoilz AW-C d52 9 b","BodyID":39,"SystemAddress":1797250861443,"Signals":[{"Type":"$SAA_SignalType_Biological;","Type_Localised":"Biological","Count":4}]}',
      '{"timestamp":"2025-03-27T10:37:28Z","event":"FSSBodySignals","BodyName":"Swoilz AW-C d52 1 a","BodyID":4,"SystemAddress":1797250861443,"Signals":[{"Type":"$SAA_SignalType_Geological;","Type_Localised":"Geological","Count":3}]}',
      '{"timestamp":"2025-03-27T10:37:29Z","event":"Scan","ScanType":"Detailed","BodyName":"Swoilz AW-C d52 9 b","BodyID":39,"SystemAddress":1797250861443,"StarSystem":"Swoilz AW-C d52","PlanetClass":"Rocky body","Landable":true}',
      '{"timestamp":"2025-03-27T10:37:30Z","event":"Scan","ScanType":"Detailed","BodyName":"Swoilz AW-C d52 1 a","BodyID":4,"SystemAddress":1797250861443,"StarSystem":"Swoilz AW-C d52","PlanetClass":"Rocky body","Landable":true}',
    ].join("\n");
    const [system] = parseJournalScans(real);
    const nineB = system.bodies.find((b) => b.bodyId === 39)!;
    const oneA = system.bodies.find((b) => b.bodyId === 4)!;
    expect(nineB.hasBiologicalSignals).toBe(true);
    expect(nineB.hasGeologicalSignals).toBe(false);
    expect(oneA.hasGeologicalSignals).toBe(true);
    expect(oneA.hasBiologicalSignals).toBe(false);
  });

  it("leaves both flags undefined (genuinely unknown) for a body never FSS-signal-scanned", () => {
    const [system] = parseJournalScans(FIXTURE);
    const body = system.bodies.find((b) => b.bodyId === 2)!;
    expect(body.hasBiologicalSignals).toBeUndefined();
    expect(body.hasGeologicalSignals).toBeUndefined();
  });
});

describe("compareBodyNames", () => {
  it("sorts numerically, not lexically, so body 2 comes before body 10", () => {
    const names = ["Wyrd A 10", "Wyrd A 2", "Wyrd A 1"];
    const bodies = names.map((bodyName) => ({ bodyName }) as JournalBody);
    expect(bodies.sort(compareBodyNames).map((b) => b.bodyName)).toEqual(["Wyrd A 1", "Wyrd A 2", "Wyrd A 10"]);
  });
});

describe("withRingBodies", () => {
  it("numbers a single star's belts 100000/100001, matching Raven Colonial's own numbering for the same belts", () => {
    const bodies = withRingBodies([star(0, ["A Belt", "B Belt"])]);
    const rings = bodies.filter((b) => b.kind === "ring");
    expect(rings.map((r) => [r.bodyName, r.bodyId])).toEqual([
      ["A Belt", 100000],
      ["B Belt", 100001],
    ]);
  });

  it("uses a star's own real bodyId directly, not its ordinal position among the system's stars", () => {
    // Real-data-confirmed 2026-08-24 against a real 2-star system (HIP 56772): star "B" (real
    // Frontier bodyId 2, the system's 2nd star) has a belt whose real Raven Colonial `num` is
    // 100200 (100000 + 100*2), NOT 100100 (which an earlier "0-based ordinal star index" guess in
    // this function would have produced instead) — ruling that guess out for good.
    const bodies = withRingBodies([star(1, []), star(2, ["A Belt"])]);
    const ring = bodies.find((b) => b.kind === "ring");
    expect(ring?.bodyId).toBe(100200);
  });
});

describe("migrateRingBodyIds", () => {
  it("is a no-op for a system with no old-scheme ring bodies", () => {
    const bodies = withRingBodies([star(0, ["A Belt"])]);
    const { bodies: migrated, idRemap } = migrateRingBodyIds(bodies);
    expect(migrated).toBe(bodies);
    expect(idRemap.size).toBe(0);
  });

  it("converts a pre-1.7.0 ring bodyId to the current scheme and carries over user edits by name", () => {
    const oldRingBody: JournalBody = {
      bodyName: "A Belt",
      bodyId: 1_000_000, // pre-1.7.0 scheme: 1_000_000 + parentBodyId*100 + ringIndex
      kind: "ring",
      landable: false,
      parents: [{ type: "Star", bodyId: 0 }],
      rings: [{ name: "A Belt", ringClass: "Rocky", massMT: 1 }],
      raw: {},
      slots: { space: 1, ground: 0, asteroid: 1 },
      presentFacilities: { space: [{ building: "Asteroid_Base", demolishable: false }], ground: [] },
      blockedSlots: { space: [false], ground: [] },
    };
    const bodies = [star(0, ["A Belt"]), oldRingBody];

    const { bodies: migrated, idRemap } = migrateRingBodyIds(bodies);

    expect(idRemap.get(1_000_000)).toBe(100000);
    const newRingBody = migrated.find((b) => b.kind === "ring")!;
    expect(newRingBody.bodyId).toBe(100000);
    expect(newRingBody.slots).toEqual(oldRingBody.slots);
    expect(newRingBody.presentFacilities).toEqual(oldRingBody.presentFacilities);
    expect(newRingBody.blockedSlots).toEqual(oldRingBody.blockedSlots);
  });

  it("matches the real multi-star system's own belt (jsons/swoilz-eg-i-b2-3.json: belt on star bodyId 3)", () => {
    // Real fixture's belt sits on the star with real Frontier bodyId 3 -> 100000 + 3*100 + 0 =
    // 100300, replacing the old scheme's 1_000_000 + 3*100 + 0 = 1_000_300.
    const bodies = [star(2, []), star(3, ["B A Belt"]), star(4, [])];
    const oldRingBody: JournalBody = {
      bodyName: "B A Belt",
      bodyId: 1_000_300,
      kind: "ring",
      landable: false,
      parents: [{ type: "Star", bodyId: 3 }],
      rings: [{ name: "B A Belt", ringClass: "Rocky", massMT: 1 }],
      raw: {},
    };

    const { bodies: migrated, idRemap } = migrateRingBodyIds([...bodies, oldRingBody]);

    expect(idRemap.get(1_000_300)).toBe(100300);
    expect(migrated.find((b) => b.kind === "ring")?.bodyId).toBe(100300);
  });

  it("matches the real 2-star system's own belt (HIP 56772: belt on star B, real bodyId 2, Raven Colonial's own num is 100200)", () => {
    const bodies = [star(1, []), star(2, ["B A Belt"])];
    const oldRingBody: JournalBody = {
      bodyName: "B A Belt",
      bodyId: 1_000_200, // pre-1.7.0 scheme: 1_000_000 + 2*100 + 0
      kind: "ring",
      landable: false,
      parents: [{ type: "Star", bodyId: 2 }],
      rings: [{ name: "B A Belt", ringClass: "Metal Rich", massMT: 1 }],
      raw: {},
    };

    const { bodies: migrated, idRemap } = migrateRingBodyIds([...bodies, oldRingBody]);

    expect(idRemap.get(1_000_200)).toBe(100200);
    expect(migrated.find((b) => b.kind === "ring")?.bodyId).toBe(100200);
  });
});
