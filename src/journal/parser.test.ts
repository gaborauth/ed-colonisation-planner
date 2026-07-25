import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/sample.jsonl?raw";
import { compareBodyNames, parseJournalScans, type JournalBody } from "./parser";

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
    expect(system.bodies).toHaveLength(4);
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
