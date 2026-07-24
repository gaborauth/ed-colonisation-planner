import { describe, expect, it } from "vitest";
import { computePortServices } from "./stationServices";

describe("computePortServices", () => {
  it("gives a bare T1 Commercial Outpost no Commodities Market", () => {
    const result = computePortServices({ building: "Commercial_Outpost", bodyId: 1 }, [], new Set(), 20);
    expect(result.available).not.toContain("Commodities Market");
  });

  it("unlocks Commodities Market for a T1 Commercial Outpost with a strong link to a Relay Station", () => {
    const result = computePortServices(
      { building: "Commercial_Outpost", bodyId: 1 },
      ["Relay_Station"],
      new Set(),
      20,
    );
    expect(result.available).toContain("Commodities Market");
  });

  it("unlocks Commodities Market for a T1 Commercial Outpost via a Tourist installation merely present in system (no strong link needed)", () => {
    const result = computePortServices(
      { building: "Commercial_Outpost", bodyId: 1 },
      [],
      new Set(["Tourist"]),
      20,
    );
    expect(result.available).toContain("Commodities Market");
  });

  it("requires a strong link (not just system presence) for a Criminal/Scientific/Military Outpost's Commodities Market", () => {
    const notLinked = computePortServices(
      { building: "Military_Outpost", bodyId: 1 },
      [],
      new Set(["Tourist"]),
      20,
    );
    expect(notLinked.available).not.toContain("Commodities Market");

    const linked = computePortServices({ building: "Military_Outpost", bodyId: 1 }, ["Tourist"], new Set(), 20);
    expect(linked.available).toContain("Commodities Market");
  });

  it("always gives Coriolis (tier 2) Commodities Market unconditionally", () => {
    const result = computePortServices({ building: "Coriolis", bodyId: 1 }, [], new Set(), 20);
    expect(result.available).toContain("Commodities Market");
  });

  it("gates Shipyard and Outfitting on system tech level 35 independent of port tier", () => {
    const belowGate = computePortServices({ building: "Coriolis", bodyId: 1 }, [], new Set(), 34);
    expect(belowGate.available).not.toContain("Shipyard");
    expect(belowGate.missingForTechGate).toContain("Shipyard");

    const atGate = computePortServices({ building: "Coriolis", bodyId: 1 }, [], new Set(), 35);
    expect(atGate.available).toContain("Shipyard");
    expect(atGate.missingForTechGate).not.toContain("Shipyard");
  });

  it("never grants Shipyard to a bare tier-1 outpost even above the tech gate", () => {
    const result = computePortServices({ building: "Commercial_Outpost", bodyId: 1 }, [], new Set(), 100);
    expect(result.available).not.toContain("Shipyard");
    expect(result.missingForTechGate).not.toContain("Shipyard");
  });

  it("grants Pioneer Supplies unconditionally to every port", () => {
    const outpost = computePortServices({ building: "Commercial_Outpost", bodyId: 1 }, [], new Set(), 0);
    const bigPort = computePortServices({ building: "Dodecahedron", bodyId: 1 }, [], new Set(), 0);
    expect(outpost.available).toContain("Pioneer Supplies");
    expect(bigPort.available).toContain("Pioneer Supplies");
  });

  it("maps 'Pirate Outpost' to Criminal_Outpost for Black Market, and honors a Pirate Installation strong link for any port", () => {
    const criminal = computePortServices({ building: "Criminal_Outpost", bodyId: 1 }, [], new Set(), 0);
    expect(criminal.available).toContain("Black Market");

    const viaLink = computePortServices({ building: "Coriolis", bodyId: 1 }, ["Pirate_Base"], new Set(), 0);
    expect(viaLink.available).toContain("Black Market");

    const neither = computePortServices({ building: "Coriolis", bodyId: 1 }, [], new Set(), 0);
    expect(neither.available).not.toContain("Black Market");
  });

  it("throws for a building that isn't Port-role", () => {
    expect(() => computePortServices({ building: "Government", bodyId: 1 }, [], new Set(), 0)).toThrow();
  });
});
