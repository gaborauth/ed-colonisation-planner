import { describe, expect, it } from "vitest";
import type { JournalBody } from "../journal/parser";
import { computeSystemLinks, type BuildingPlacement } from "./links";

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

describe("computeSystemLinks", () => {
  it("reproduces the source's worked example: tier-2 port dominates a body with a tier-1 port and two facilities", () => {
    // Body 1: ground facility (Extraction_Hub) + orbital facility (Government) + a tier-1 port
    // (Commercial_Outpost) + a tier-2 port (Coriolis), all in orbit/on the body per the example.
    // Body 2: a ground port (Planetary_Port) + an orbital facility (Government).
    const body1 = makeBody(1, { planetClass: "Rocky body" });
    const body2 = makeBody(2, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Extraction_Hub", bodyId: 1, count: 1 },
      { building: "Government", bodyId: 1, count: 1 },
      { building: "Commercial_Outpost", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
      { building: "Planetary_Port", bodyId: 2, count: 1 },
      { building: "Government", bodyId: 2, count: 1 },
    ];
    const result = computeSystemLinks([body1, body2], placements, ["Commercial_Outpost", "Coriolis", "Planetary_Port"]);

    // Strong links on body 1 all target Coriolis (the tier-2 port), not Commercial_Outpost (tier 1).
    const body1Strong = result.strongLinks.filter((l) => l.bodyId === 1);
    expect(body1Strong.every((l) => l.toPortBuilding === "Coriolis")).toBe(true);
    expect(body1Strong.map((l) => l.fromBuilding).sort()).toEqual(
      ["Commercial_Outpost", "Extraction_Hub", "Government"].sort(),
    );

    // Body 1's Coriolis <-> Body 2's Planetary_Port get a weak link in both directions.
    expect(
      result.weakLinks.some((l) => l.fromBodyId === 1 && l.toPortBodyId === 2 && l.toPortBuilding === "Planetary_Port"),
    ).toBe(true);
    expect(
      result.weakLinks.some((l) => l.fromBodyId === 2 && l.toPortBodyId === 1 && l.toPortBuilding === "Coriolis"),
    ).toBe(true);
  });

  it("chains a planetary port's strong links onward to the orbital port on the same body", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Small_Agricultural_Settlement", bodyId: 1, count: 1 }, // ground facility
      { building: "Planetary_Port", bodyId: 1, count: 1 }, // ground port
      { building: "Coriolis", bodyId: 1, count: 1 }, // space port
    ];
    const result = computeSystemLinks([body], placements, ["Planetary_Port", "Coriolis"]);

    const groundFacilityLink = result.strongLinks.find((l) => l.fromBuilding === "Small_Agricultural_Settlement");
    expect(groundFacilityLink?.toPortBuilding).toBe("Planetary_Port");

    const chainLink = result.strongLinks.find((l) => l.fromBuilding === "Planetary_Port");
    expect(chainLink?.toPortBuilding).toBe("Coriolis");

    // Coriolis (the orbital port) is the body's representative for weak links, not Planetary_Port.
    const dominantPorts = result.ports.filter((p) => p.bodyId === 1 && p.isDominantOnBody);
    expect(dominantPorts.map((p) => p.building).sort()).toEqual(["Coriolis", "Planetary_Port"].sort());
  });

  it("breaks a same-tier tie between different port types using buildOrderHint", () => {
    // Coriolis and Asteroid_Base are both tier 2. Asteroid_Base appears earlier in the hint.
    const body = makeBody(1, { planetClass: "Rocky body", rings: [{ name: "r", ringClass: "x", massMT: 1 }] });
    const placements: BuildingPlacement[] = [
      { building: "Government", bodyId: 1, count: 1 },
      { building: "Asteroid_Base", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
    ];
    const result = computeSystemLinks([body], placements, ["Asteroid_Base", "Coriolis"]);
    const facilityLink = result.strongLinks.find((l) => l.fromBuilding === "Government");
    expect(facilityLink?.toPortBuilding).toBe("Asteroid_Base");
  });

  it("treats extra physical instances of an identical port building type as their own strong-link givers into the one dominant instance", () => {
    // Two Commercial_Outposts on one body (same building, hence trivially same tier) — real bug
    // found 2026-07-26 via a user report against a real solved plan (the solver had placed two
    // Commercial_Outposts, and two Dodecahedrons, each pair on one body): only ONE physical port
    // instance can ever really be the dominant/receiving one in the game, but the old code
    // collapsed same-named instances into a single logical port via `Set`-dedup, so both physical
    // UI slots showed the SAME aggregate "receives strong links" content, as if each independently
    // received everything. The second instance must instead behave exactly like a losing
    // DIFFERENT-name non-dominant port already does: its own base economies flow INTO the one true
    // dominant instance as an ordinary strong link.
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [{ building: "Commercial_Outpost", bodyId: 1, count: 2 }];
    const result = computeSystemLinks([body], placements, []);

    const selfLink = result.strongLinks.find(
      (l) => l.fromBuilding === "Commercial_Outpost" && l.toPortBuilding === "Commercial_Outpost",
    );
    expect(selfLink).toBeDefined();
    expect(selfLink?.count).toBe(1);

    // Still one aggregate PortSummary per (body, building name) — the per-physical-slot UI split
    // that decides which slot's info hover actually shows this content lives in
    // FacilityInfo.tsx's `isDominantInstance` parameter, not here.
    const ports = result.ports.filter((p) => p.bodyId === 1 && p.building === "Commercial_Outpost");
    expect(ports).toHaveLength(1);
    expect(ports[0].isDominantOnBody).toBe(true);
    // The sibling instance's own economies should show up as a nonzero incoming strong-link
    // contribution on the aggregate — previously 0, since a port never strong-linked to itself.
    expect(ports[0].economyRatios.some((r) => r.strongPercent > 0)).toBe(true);
  });

  it("evaluates boost/decrease per individual strong link, not once per body", () => {
    // Matches the source's own example: a volcanic body's extraction facility strong link is
    // boosted, its agricultural facility strong link is not.
    const body = makeBody(1, { planetClass: "Icy body" }); // icy -> decreases Agriculture, not Extraction
    const placements: BuildingPlacement[] = [
      { building: "Extraction_Hub", bodyId: 1, count: 1 },
      { building: "Civilian_Hub", bodyId: 1, count: 1 }, // FACILITY_ECONOMY_GUESS maps this to Agriculture
      { building: "Coriolis", bodyId: 1, count: 1 },
    ];
    const result = computeSystemLinks([body], placements, ["Coriolis"]);
    const extractionLink = result.strongLinks.find((l) => l.fromBuilding === "Extraction_Hub")!;
    const agricultureLink = result.strongLinks.find((l) => l.fromBuilding === "Civilian_Hub")!;
    expect(extractionLink.decreasedEconomies).toEqual([]);
    expect(agricultureLink.decreasedEconomies).toEqual(["Agriculture"]);
  });

  it("warns about facilities on a body with no port instead of dropping them silently", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [{ building: "Government", bodyId: 1, count: 1 }];
    const result = computeSystemLinks([body], placements, []);
    expect(result.strongLinks).toEqual([]);
    expect(result.warnings.some((w) => w.includes("no port"))).toBe(true);
  });

  it("creates no weak links for a single-body system", () => {
    const body = makeBody(1, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [{ building: "Coriolis", bodyId: 1, count: 1 }];
    const result = computeSystemLinks([body], placements, ["Coriolis"]);
    expect(result.weakLinks).toEqual([]);
  });

  it("a facility on a port-less body still weak-links system-wide, even though it can't strong-link locally", () => {
    // Reproduces a user-reported real in-game discrepancy: 3 port-less bodies whose only content
    // was Agricultural settlements (which can't strong-link — no port on their own body) turned out
    // to be the system's ONLY Agriculture source at all, and were still confirmed in-game to
    // contribute weak links elsewhere.
    const body1 = makeBody(1, { planetClass: "Rocky body" });
    const body2 = makeBody(2, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Coriolis", bodyId: 1, count: 1 },
      { building: "Medium_Agricultural_Settlement", bodyId: 2, count: 1 },
    ];
    const result = computeSystemLinks([body1, body2], placements, ["Coriolis"]);

    expect(result.warnings.some((w) => w.includes("Body 2") && w.includes("no port"))).toBe(true);
    const coriolis = result.ports.find((p) => p.building === "Coriolis")!;
    expect(coriolis.marketLinks.find((m) => m.economy === "Agriculture")).toEqual({
      economy: "Agriculture",
      strongCount: 0,
      weakCount: 1,
    });
  });

  it("doesn't double-count a ground->space forwarding hop as its own separate weak-link giver", () => {
    // Reproduces the other half of the same user-reported discrepancy: a chain body's ground port
    // forwarding to its space port must NOT also independently weak-link the same economy a second
    // time — only a same-side non-dominant port (Coriolis here, tier 2, losing to Orbis_or_Ocellus's
    // tier 3) should count as an additional weak-link giver alongside the chain body's own sources.
    const chainBody = makeBody(1, { planetClass: "Rocky body" }); // Rocky -> Refinery
    const receiverBody = makeBody(2, { planetClass: "Icy body" }); // Icy -> Industrial, not Refinery
    const placements: BuildingPlacement[] = [
      { building: "Civilian_Planetary_Outpost", bodyId: 1, count: 1 }, // ground port, chains to space
      { building: "Coriolis", bodyId: 1, count: 1 }, // space, non-dominant (tier 2)
      { building: "Orbis_or_Ocellus", bodyId: 1, count: 1 }, // space, dominant (tier 3)
      { building: "Military_Outpost", bodyId: 2, count: 1 }, // the receiver, elsewhere in the system
    ];
    const result = computeSystemLinks([chainBody, receiverBody], placements, ["Civilian_Planetary_Outpost", "Orbis_or_Ocellus", "Coriolis"]);

    const militaryOutpost = result.ports.find((p) => p.building === "Military_Outpost")!;
    // Exactly 1 (from Coriolis alone) — NOT 2 (which would double-count Civilian_Planetary_Outpost's
    // forwarding hop as an additional, separate weak-link giver for the same Refinery value).
    expect(militaryOutpost.marketLinks.find((m) => m.economy === "Refinery")).toEqual({
      economy: "Refinery",
      strongCount: 0,
      weakCount: 1,
    });
  });

  it("accumulates strong-link economy contributions up a T1->T2 chain — reproduces a user-reported real in-game example", () => {
    // Rocky + geologicals + pristine resources + volcanism -> Civilian Planetary Outpost's own
    // economy (Colony-default, per DaftMav-v3.4.1.ods) is Extraction 180%/Refinery 140%/
    // Industrial 140% (100% base + boosts). A Small Military Settlement (link-contribution tier
    // 1, from its own T2points=1) strong-links Military to it at the flat tier-1 rate (40%, since
    // Military has no strong-link boost/decrease rule at all) — confirmed in-game: the settlement's
    // own Military value is 100%, but only 40% of it lands on the Outpost. The Outpost (also
    // tier 1) then forwards EVERYTHING it carries — its own 3 economies plus the received
    // Military — onward to Coriolis, each at 40% + that economy's own per-link boost/decrease
    // delta on this body (Extraction has 2 applicable boosts = +80%; Refinery/Industrial have 1
    // = +40%; Military has none = +0%), landing exactly on the real observed totals.
    const body = makeBody(1, {
      planetClass: "Rocky body",
      landable: true,
      hasGeologicalSignals: true,
      hasBiologicalSignals: false,
      reserveLevel: "Pristine",
      raw: { Volcanism: "minor metallic magma volcanism" },
    });
    const placements: BuildingPlacement[] = [
      { building: "Small_Military_Settlement", bodyId: 1, count: 1 },
      { building: "Civilian_Planetary_Outpost", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
    ];
    const result = computeSystemLinks([body], placements, ["Civilian_Planetary_Outpost", "Coriolis"]);

    const civilianOutpost = result.ports.find((p) => p.building === "Civilian_Planetary_Outpost")!;
    const outpostRatio = (economy: string) => civilianOutpost.economyRatios.find((r) => r.economy === economy)!;
    expect(outpostRatio("Extraction").totalPercent).toBe(180);
    expect(outpostRatio("Refinery").totalPercent).toBe(140);
    expect(outpostRatio("Industrial").totalPercent).toBe(140);
    expect(outpostRatio("Military")).toEqual({ economy: "Military", ownPercent: 0, strongPercent: 40, weakPercent: 0, totalPercent: 40 });

    const coriolis = result.ports.find((p) => p.building === "Coriolis")!;
    const coriolisRatio = (economy: string) => coriolis.economyRatios.find((r) => r.economy === economy)!;
    expect(coriolisRatio("Extraction").totalPercent).toBe(300);
    expect(coriolisRatio("Refinery").totalPercent).toBe(220);
    expect(coriolisRatio("Industrial").totalPercent).toBe(220);
    expect(coriolisRatio("Military").totalPercent).toBe(40);
  });

  it("gives every strong-link giver a system-wide 5% weak link to every OTHER body's representative port", () => {
    // Body 1: Small Military Settlement strong-links Military to Coriolis (its only local port).
    // Body 2: Small Agricultural Settlement strong-links Agriculture to Planetary_Port likewise.
    // Per the user's rule, each settlement ALSO weak-links its economy to the OTHER body's
    // representative port at a flat 5% (no tier-scaling, no boost/decrease) — so Coriolis should
    // pick up a 5% Agriculture weak link from body 2, and Planetary_Port a 5% Military weak link
    // from body 1, alongside their own local 40% strong links (tier 1, no applicable boost/decrease
    // for either economy on a plain Rocky body). `marketLinks` counts the number of contributing
    // building instances (1 settlement each here), not a percentage — that's `economyRatios`'s job.
    const body1 = makeBody(1, { planetClass: "Rocky body" });
    const body2 = makeBody(2, { planetClass: "Rocky body" });
    const placements: BuildingPlacement[] = [
      { building: "Small_Military_Settlement", bodyId: 1, count: 1 },
      { building: "Coriolis", bodyId: 1, count: 1 },
      { building: "Small_Agricultural_Settlement", bodyId: 2, count: 1 },
      { building: "Planetary_Port", bodyId: 2, count: 1 },
    ];
    const result = computeSystemLinks([body1, body2], placements, ["Coriolis", "Planetary_Port"]);

    const coriolis = result.ports.find((p) => p.building === "Coriolis")!;
    const coriolisRatio = (economy: string) => coriolis.economyRatios.find((r) => r.economy === economy)!;
    expect(coriolisRatio("Military")).toEqual({ economy: "Military", ownPercent: 0, strongPercent: 40, weakPercent: 0, totalPercent: 40 });
    expect(coriolisRatio("Agriculture")).toEqual({ economy: "Agriculture", ownPercent: 0, strongPercent: 0, weakPercent: 5, totalPercent: 5 });

    const coriolisMarket = (economy: string) => coriolis.marketLinks.find((m) => m.economy === economy);
    expect(coriolisMarket("Military")).toEqual({ economy: "Military", strongCount: 1, weakCount: 0 });
    expect(coriolisMarket("Agriculture")).toEqual({ economy: "Agriculture", strongCount: 0, weakCount: 1 });
    // Refinery is Coriolis's own body-derived economy (Rocky), never contributed via any link —
    // it should not appear in marketLinks at all.
    expect(coriolisMarket("Refinery")).toBeUndefined();

    const planetaryPort = result.ports.find((p) => p.building === "Planetary_Port")!;
    const portMarket = (economy: string) => planetaryPort.marketLinks.find((m) => m.economy === economy);
    expect(portMarket("Agriculture")).toEqual({ economy: "Agriculture", strongCount: 1, weakCount: 0 });
    expect(portMarket("Military")).toEqual({ economy: "Military", strongCount: 0, weakCount: 1 });
  });
});
