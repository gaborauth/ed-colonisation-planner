// Real-fixture regression test, sibling to spansh/realSpanshSystem.test.ts's pattern: overlays a
// real Raven Colonial export onto the real Spansh dump of the SAME system, then runs the exact
// pipeline a real "Solve for a system" click performs. Also spot-checks specific bodies/facilities
// against the real committed jsons/swoilz-aw-c-d52.json export for this system (matched by
// customName), which is the reference this adapter's slot-array-length and empty-vs-null-padding
// rules are built to match.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "../App";
import { computeSolvedSystemLinks } from "../domain/solvedLinks";
import { computeSolvedPlacements } from "../domain/solvedPlacement";
import { getOrderingFromResult } from "../domain/ordering";
import { solve } from "../solver/solve";
import { spanshDumpToJournalSystem } from "../spansh/adapter";
import type { SpanshDumpRecord } from "../spansh/types";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";
import type { JournalBody, JournalSystem } from "../journal/parser";
import { applyRavenColonialOverlay } from "./adapter";
import type { RcSystem } from "./types";

const spanshRecord: SpanshDumpRecord = JSON.parse(
  readFileSync(path.join(process.cwd(), "spansh-jsons", "swoilz-aw-c-d52-dump.json"), "utf-8"),
).system;
const rcSystem: RcSystem = JSON.parse(readFileSync(path.join(process.cwd(), "rc-jsons", "swoilz-aw-c-d52.json"), "utf-8"));

describe("Raven Colonial overlay: swoilz-aw-c-d52", () => {
  it("merges cleanly with no warnings and matches the real primary station", () => {
    const base = spanshDumpToJournalSystem(spanshRecord);
    const { system, warnings } = applyRavenColonialOverlay(base, rcSystem);

    expect(warnings).toEqual([]);
    expect(system.firstStationBuilding).toBe("Coriolis");
    expect(system.firstStationBodyId).toBe(22);
    expect(system.firstStationCustomName).toBe("Froude City");
    expect(system.firstStationVariant).toBe("Quad Truss");
  });

  it("skips a leading non-complete site when picking the primary station, and doesn't seat it as an ordinary facility either", () => {
    const bodyAt = (bodyId: number): JournalBody => ({
      bodyName: `Body ${bodyId}`,
      bodyId,
      kind: "star",
      landable: false,
      parents: [],
      rings: [],
      raw: {},
    });
    const base: JournalSystem = { starSystem: "Test", systemAddress: 1, bodies: [bodyAt(0), bodyAt(1)] };
    const rc: RcSystem = {
      name: "Test",
      id64: 1,
      bodies: [],
      slots: { "0": [1, -1], "1": [1, -1] },
      sites: [
        { id: "1", name: "Not Built Yet", bodyNum: 0, buildType: "pistis", status: "planned" },
        { id: "2", name: "Real Primary", bodyNum: 1, buildType: "quad_truss", status: "complete" },
      ],
    };

    const { system, warnings } = applyRavenColonialOverlay(base, rc);

    expect(system.firstStationCustomName).toBe("Real Primary");
    expect(system.firstStationBodyId).toBe(1);
    expect(system.firstStationBuilding).toBe("Coriolis");
    // The skipped-over planned site never gets seated as an ordinary facility either — it's simply
    // not built, not "unrecognized"/an error, so no warning either.
    expect(system.bodies.find((b) => b.bodyId === 0)?.presentFacilities).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("matches the real committed export's facilities and slots for every body except the two RC manually mis-entered ground counts", () => {
    const base = spanshDumpToJournalSystem(spanshRecord);
    const { system } = applyRavenColonialOverlay(base, rcSystem);

    // Bodies 47/48: the RC export itself has a manual slot-entry mistake for these two ground
    // counts (verified against the real in-game system) — not an adapter bug. Everything else
    // should match exactly.
    const KNOWN_RC_DATA_ENTRY_MISTAKES = new Set([47, 48]);

    const byId = new Map(system.bodies.map((b) => [b.bodyId, b]));
    for (const [numStr, [space, ground]] of Object.entries(rcSystem.slots)) {
      const bodyId = Number(numStr);
      if (KNOWN_RC_DATA_ENTRY_MISTAKES.has(bodyId)) continue;
      const body = byId.get(bodyId);
      expect(body?.slots?.space).toBe(Math.max(space, 0));
      expect(body?.slots?.ground).toBe(Math.max(ground, 0));
    }

    // A ringed body with an ordinary orbital slot keeps its asteroid eligibility as an ADDITIONAL
    // presentFacilities.space array position, not a substitute (bodyId 15, "Swoilz AW-C d52 3").
    const hmc = byId.get(15);
    expect(hmc?.slots).toEqual({ space: 1, ground: 0, asteroid: 1 });
    expect(hmc?.presentFacilities?.space).toEqual([
      { building: "Government", demolishable: false, variant: "Harmonia", customName: "Chapman Depot" },
      null,
    ]);

    // A slotKind with no real sites stays `[]` even when its own slot count is > 0 (bodyId 14 has
    // 3 ground facilities but 1 empty orbital slot).
    const agriMoon = byId.get(14);
    expect(agriMoon?.presentFacilities?.space).toEqual([]);
    expect(agriMoon?.presentFacilities?.ground?.map((f) => f?.customName).sort()).toEqual(
      ["Biggs Hydroponics Garden", "Kolsuk Cultivation Exchange", "Teixeira Agricultural Estate"].sort(),
    );

    // Multiple different building types sharing one body (bodyId 7): Civilian_Planetary_Outpost on
    // the ground, plus Coriolis + Orbis_or_Ocellus in space.
    const busyBody = byId.get(7);
    expect(busyBody?.presentFacilities?.ground?.[0]?.building).toBe("Civilian_Planetary_Outpost");
    expect(busyBody?.presentFacilities?.space?.map((f) => f?.building).sort()).toEqual(
      ["Coriolis", "Orbis_or_Ocellus"].sort(),
    );
    // Known, accepted limitation (see buildTypes.ts's header comment): RC's buildType "hestia" maps
    // to variant "Hestia" here, but the real facility on this body is actually laid out as "Clotho"
    // — a different valid option of the same building. Cosmetic-only, freely correctable in the UI.
    expect(busyBody?.presentFacilities?.ground?.[0]?.variant).toBe("Hestia");
  });

  it("solves end-to-end after the overlay, never over-reports free capacity, and produces a valid build order + link topology", async () => {
    const base = spanshDumpToJournalSystem(spanshRecord);
    const { system } = applyRavenColonialOverlay(base, rcSystem);

    const formState: PlannerFormState = {
      ...INITIAL_FORM_STATE,
      bodies: system.bodies,
      starSystem: system.starSystem,
      systemAddress: system.systemAddress,
      systemConfigured: true,
      firstStationBuilding: system.firstStationBuilding ?? "",
      firstStationBodyId: system.firstStationBodyId,
      firstStationVariant: system.firstStationVariant,
      firstStationCustomName: system.firstStationCustomName,
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");

    expect(result.slotsRemaining.space).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.ground).toBeGreaterThanOrEqual(0);
    expect(result.slotsRemaining.asteroid).toBeGreaterThanOrEqual(0);
    expect(result.finalT2Points).toBeGreaterThanOrEqual(0);
    expect(result.finalT3Points).toBeGreaterThanOrEqual(0);

    const planResult = toPlanResult(formState, result);
    let order: string[] = [];
    expect(() => {
      order = getOrderingFromResult(planResult, true, false);
    }).not.toThrow();

    expect(() => computeSolvedSystemLinks(formState.bodies, result)).not.toThrow();

    const solved = computeSolvedPlacements(formState.bodies, result, order);
    expect(solved.warnings).toEqual([]);
  }, 30000);
});

describe("Raven Colonial overlay: Tellus buildType disambiguation", () => {
  // Raven Colonial's own buildType strings for the two Tellus hub layouts (once genuinely
  // ambiguous between Exploration Hub and Industrial Hub, see buildTypes.ts's header comment) were
  // renamed to "tellus_e"/"tellus_i" — a real RC export never emits bare "tellus" anymore, so both
  // must resolve to their own distinct building, not the old shared guess.
  const bodyAt = (bodyId: number): JournalBody => ({
    bodyName: `Body ${bodyId}`,
    bodyId,
    kind: "planet",
    landable: true,
    parents: [],
    rings: [],
    raw: {},
  });
  // A third, unrelated "complete" site (bodyNum 2) is listed first so `pickPrimarySite` claims it
  // as the primary station instead of either Tellus site — otherwise whichever Tellus site sorts
  // first would be consumed as the primary and never seated as an ordinary ground facility at all.
  const base: JournalSystem = { starSystem: "Test", systemAddress: 1, bodies: [bodyAt(0), bodyAt(1), bodyAt(2)] };
  const rc: RcSystem = {
    name: "Test",
    id64: 1,
    bodies: [],
    slots: { "0": [0, 1], "1": [0, 1], "2": [1, -1] },
    sites: [
      { id: "0", name: "Primary", bodyNum: 2, buildType: "quad_truss", status: "complete" },
      { id: "1", name: "Exploration Site", bodyNum: 0, buildType: "tellus_e", status: "complete" },
      { id: "2", name: "Industrial Site", bodyNum: 1, buildType: "tellus_i", status: "complete" },
    ],
  };

  it("maps tellus_e to Exploration_Hub and tellus_i to Industrial_Hub with no warnings", () => {
    const { system, warnings } = applyRavenColonialOverlay(base, rc);

    expect(warnings).toEqual([]);
    const byId = new Map(system.bodies.map((b) => [b.bodyId, b]));
    expect(byId.get(0)?.presentFacilities?.ground?.[0]).toMatchObject({
      building: "Exploration_Hub",
      variant: "Tellus A",
    });
    expect(byId.get(1)?.presentFacilities?.ground?.[0]).toMatchObject({
      building: "Industrial_Hub",
      variant: "Tellus B",
    });
  });

  it("maps the legacy bare tellus buildType to Industrial_Hub, matching Raven Colonial's own altTypes alias", () => {
    const legacyRc: RcSystem = {
      ...rc,
      sites: [
        { id: "0", name: "Primary", bodyNum: 2, buildType: "quad_truss", status: "complete" },
        { id: "1", name: "Legacy Site", bodyNum: 1, buildType: "tellus", status: "complete" },
      ],
    };
    const { system, warnings } = applyRavenColonialOverlay(base, legacyRc);

    expect(warnings).toEqual([]);
    const byId = new Map(system.bodies.map((b) => [b.bodyId, b]));
    expect(byId.get(1)?.presentFacilities?.ground?.[0]).toMatchObject({
      building: "Industrial_Hub",
      variant: "Tellus B",
    });
  });
});
