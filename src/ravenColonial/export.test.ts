// Real-fixture regression test, sibling to adapter.test.ts's pattern: overlays the real committed
// Raven Colonial export onto the real Spansh dump of the same system, solves it, then exports the
// solved plan back out and checks the round trip.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSolverInput } from "../App";
import { getOrderingFromResult } from "../domain/ordering";
import { computeSolvedPlacements } from "../domain/solvedPlacement";
import { solve } from "../solver/solve";
import { spanshDumpToJournalSystem } from "../spansh/adapter";
import type { SpanshDumpRecord } from "../spansh/types";
import { INITIAL_FORM_STATE, type PlannerFormState } from "../state/plannerState";
import { toPlanResult } from "../state/toPlanResult";
import { applyRavenColonialOverlay } from "./adapter";
import { buildRavenColonialExport } from "./export";
import type { RcSystem, RcSystemSkeleton } from "./types";

const spanshRecord: SpanshDumpRecord = JSON.parse(
  readFileSync(path.join(process.cwd(), "spansh-jsons", "swoilz-aw-c-d52-dump.json"), "utf-8"),
).system;
const rcSystem: RcSystem = JSON.parse(readFileSync(path.join(process.cwd(), "rc-jsons", "swoilz-aw-c-d52.json"), "utf-8"));
// Same parsed object, viewed with the wider type — for asserting the "extra" fields `RcSystem`
// itself doesn't declare (v/rev/architect/pos/...) survive the export unchanged.
const rcSystemFull = rcSystem as unknown as RcSystemSkeleton;

describe("Raven Colonial export: swoilz-aw-c-d52", () => {
  it("round-trips a solved plan into a re-importable Raven Colonial file", async () => {
    const base = spanshDumpToJournalSystem(spanshRecord);
    const { system } = applyRavenColonialOverlay(base, rcSystem);
    expect(system.ravenColonialSkeleton).toBeDefined();

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
      ravenColonialSkeleton: system.ravenColonialSkeleton,
    };

    const result = await solve(buildSolverInput(formState));
    expect(result.status).toBe("optimal");

    const order = getOrderingFromResult(toPlanResult(formState, result), true, false);
    const solved = computeSolvedPlacements(formState.bodies, result, order);
    expect(solved.warnings).toEqual([]);

    const skeleton = formState.ravenColonialSkeleton as unknown as RcSystemSkeleton;
    const { json, warnings } = buildRavenColonialExport(skeleton, formState.bodies, solved.byBody);

    // Every solved new build is covered by RC_BUILD_TYPE's reverse mapping — no unmapped-building
    // skips for this real fixture.
    expect(warnings).toEqual([]);

    // Every original site is still present, byte-identical, plus at least one new "plan" site per
    // real new build the solver proposed.
    const newBuildCount = [...solved.byBody.values()]
      .flatMap((s) => [...s.space, ...s.ground])
      .filter((s) => s.status === "new" || s.status === "demolished-rebuilt").length;
    expect(newBuildCount).toBeGreaterThan(0);
    expect(json.sites.length).toBe(rcSystem.sites.length + newBuildCount);
    for (const original of rcSystem.sites) {
      expect(json.sites).toContainEqual(original);
    }

    // Every newly-added site is a well-formed, unique "plan" entry on a real body.
    const bodyIds = new Set(formState.bodies.map((b) => b.bodyId));
    const newSites = json.sites.slice(rcSystem.sites.length);
    const seenIds = new Set<string>();
    for (const site of newSites) {
      expect(site.status).toBe("plan");
      expect(bodyIds.has(site.bodyNum)).toBe(true);
      expect(site.marketId).toBeUndefined();
      expect(seenIds.has(site.id)).toBe(false);
      seenIds.add(site.id);
    }

    // Passthrough skeleton fields are carried through verbatim, unbumped.
    expect(json.v).toBe(rcSystemFull.v);
    expect(json.rev).toBe(rcSystemFull.rev);
    expect(json.architect).toBe(rcSystemFull.architect);
    expect(json.pos).toEqual(rcSystemFull.pos);
    expect(json.id64).toBe(rcSystem.id64);
    expect(json.name).toBe(rcSystem.name);

    // slots is regenerated from the app's OWN current per-body counts, not the frozen skeleton.
    const byBodyId = new Map(formState.bodies.map((b) => [b.bodyId, b]));
    for (const [numStr, pair] of Object.entries(json.slots)) {
      const body = byBodyId.get(Number(numStr));
      if (!body?.slots) continue;
      expect(pair).toEqual([body.slots.space, body.slots.ground]);
    }
  }, 30000);

  it("skips a solved building with no known Raven Colonial build type, reporting a warning instead of throwing", () => {
    const skeleton: RcSystemSkeleton = { name: "Test", id64: 1, bodies: [], sites: [], slots: {} };
    const bodies = [
      { bodyName: "Test 1", bodyId: 0, kind: "star" as const, landable: false, parents: [], rings: [], raw: {} },
    ];
    const byBody = new Map([
      [0, { space: [{ status: "new" as const, building: "Not_A_Real_Building", order: 1 }], ground: [] }],
    ]);

    const { json, warnings } = buildRavenColonialExport(skeleton, bodies, byBody);

    expect(json.sites).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Not A Real Building/);
  });
});
