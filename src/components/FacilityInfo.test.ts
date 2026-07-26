// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { computeSystemLinks, type BuildingPlacement } from "../domain/links";
import type { JournalBody } from "../journal/parser";
import { facilityEconomyRatios, facilityMarketLinks } from "./FacilityInfo";

function makeBody(bodyId: number, overrides: Partial<JournalBody> = {}): JournalBody {
  return {
    bodyName: `Body ${bodyId}`,
    bodyId,
    kind: "planet",
    landable: true,
    parents: [{ type: "Star", bodyId: 0 }],
    rings: [],
    raw: {},
    ...overrides,
  };
}

describe("facilityEconomyRatios / facilityMarketLinks isDominantInstance", () => {
  // Real bug (2026-07-26 user report against the "Solved system" tree): a body with two physical
  // instances of the identical port building type both showed the SAME aggregate "receives strong
  // links" tooltip content, as if each independently received everything — only one physical
  // instance can ever really be the receiving/dominant one. `links.ts`'s own math fix (see
  // domain/links.test.ts) makes the AGGREGATE numbers correct; these two functions are the other
  // half — the per-physical-slot UI layer that decides which slot actually shows that aggregate.
  const body = makeBody(1, { planetClass: "Rocky body" });
  const placements: BuildingPlacement[] = [{ building: "Commercial_Outpost", bodyId: 1, count: 2 }];
  const linksResult = computeSystemLinks([body], placements, []);

  it("the dominant instance (default, isDominantInstance=true) shows the full aggregate — incoming strong link included", () => {
    const ratios = facilityEconomyRatios("Commercial_Outpost", body, [body], linksResult);
    expect(ratios.some((r) => r.strongPercent > 0)).toBe(true);
    const marketLinks = facilityMarketLinks("Commercial_Outpost", body, linksResult);
    expect(marketLinks.length).toBeGreaterThan(0);
  });

  it("a non-dominant physical instance of the SAME building (isDominantInstance=false) falls back to its own-only economy, with no market links", () => {
    const ratios = facilityEconomyRatios("Commercial_Outpost", body, [body], linksResult, false);
    expect(ratios.every((r) => r.strongPercent === 0 && r.weakPercent === 0)).toBe(true);
    expect(ratios.some((r) => r.ownPercent > 0)).toBe(true);
    const marketLinks = facilityMarketLinks("Commercial_Outpost", body, linksResult, false);
    expect(marketLinks).toEqual([]);
  });
});
