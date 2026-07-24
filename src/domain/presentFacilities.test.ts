import { describe, expect, it } from "vitest";
import {
  computeHardNonPortSeed,
  computePresentPortsSeed,
  derivePresentCounts,
  normalizeFacilitySlots,
  splitPresentFacilities,
  type PresentFacilitiesBody,
} from "./presentFacilities";

describe("normalizeFacilitySlots", () => {
  it("pads a short/undefined array with null up to count", () => {
    expect(normalizeFacilitySlots(undefined, 3)).toEqual([null, null, null]);
    expect(normalizeFacilitySlots([{ building: "Government", demolishable: false }], 3)).toEqual([
      { building: "Government", demolishable: false },
      null,
      null,
    ]);
  });

  it("truncates a too-long array down to count", () => {
    const slots = [
      { building: "Government", demolishable: false },
      { building: "Medical", demolishable: true },
    ];
    expect(normalizeFacilitySlots(slots, 1)).toEqual([{ building: "Government", demolishable: false }]);
  });
});

describe("splitPresentFacilities / derivePresentCounts", () => {
  it("splits non-port facilities into hard vs demolishable per their flag", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Government", demolishable: false }, null],
        ground: [{ building: "Small_Military_Settlement", demolishable: true }],
      },
    ];
    const { hard, demolishable } = splitPresentFacilities(bodies);
    expect(hard).toEqual([{ bodyId: 1, kind: "space", index: 0, building: "Government" }]);
    expect(demolishable).toEqual([
      { bodyId: 1, kind: "ground", index: 0, building: "Small_Military_Settlement" },
    ]);
    expect(derivePresentCounts(bodies)).toEqual({ Government: 1, Small_Military_Settlement: 1 });
  });

  it("always treats a present port as hard, even if marked demolishable", () => {
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: true }], ground: [] },
    ];
    const { hard, demolishable } = splitPresentFacilities(bodies);
    expect(hard).toEqual([{ bodyId: 1, kind: "space", index: 0, building: "Coriolis" }]);
    expect(demolishable).toEqual([]);
  });
});

describe("computeHardNonPortSeed", () => {
  it("sums T2/T3 stats of hard non-port facilities, ignoring ports", () => {
    // Large_Military_Settlement: t2 -1, t3 2. Small_Agricultural_Settlement: t2 1.
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 1,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [
          { building: "Large_Military_Settlement", demolishable: false },
          { building: "Small_Agricultural_Settlement", demolishable: false },
        ],
      },
    ];
    const { hard } = splitPresentFacilities(bodies);
    expect(computeHardNonPortSeed(hard)).toEqual({ t2: 0, t3: 2 });
  });
});

describe("computePresentPortsSeed", () => {
  it("charges a single present port the first-slot escalating cost (k=0)", () => {
    // Coriolis: T2points "port", T3points 1 (fixed generation, not escalating).
    const bodies: PresentFacilitiesBody[] = [
      { bodyId: 1, space: [{ building: "Coriolis", demolishable: false }], ground: [] },
    ];
    const { hard } = splitPresentFacilities(bodies);
    // getT2PortCost(0) = max(3, 1) = 3; Coriolis's T3points is a fixed 1, not "port", so it adds
    // a flat +1 generation rather than an escalating cost.
    expect(computePresentPortsSeed(hard)).toEqual({ t2: 3, t3: 1 });
  });

  it("charges escalating cost per present port in deterministic (bodyId, space-before-ground, index) order", () => {
    const bodies: PresentFacilitiesBody[] = [
      {
        bodyId: 2,
        space: [{ building: "Coriolis", demolishable: false }],
        ground: [{ building: "Planetary_Port", demolishable: false }],
      },
      { bodyId: 1, space: [{ building: "Asteroid_Base", demolishable: false }], ground: [] },
    ];
    const { hard } = splitPresentFacilities(bodies);
    // Deterministic order: bodyId 1 (Asteroid_Base) -> k=0, then bodyId 2 space (Coriolis) -> k=1,
    // then bodyId 2 ground (Planetary_Port) -> k=2.
    // Asteroid_Base: T2 "port" -> getT2PortCost(0)=3; T3 1 (fixed) -> +1.
    // Coriolis: T2 "port" -> getT2PortCost(1)=3; T3 1 (fixed) -> +1.
    // Planetary_Port: T2 0 (not "port", contributes nothing to t2); T3 "port" -> getT3PortCost(2)=12.
    expect(computePresentPortsSeed(hard)).toEqual({ t2: 6, t3: 14 });
  });
});
