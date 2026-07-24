// Parses an Elite Dangerous Journal file (newline-delimited JSON) client-side and extracts the
// per-system, per-body data needed for eligibility.ts's slot estimate. Only `Scan` events are used
// — per the project plan, there's no construction-progress tracking here, just body/system data.

import type { SlotKind } from "../data/buildings";

export interface JournalRing {
  name: string;
  ringClass: string;
  reserveLevel?: string;
  massMT: number;
}

/** One link in a body's parent hierarchy (e.g. a moon's immediate parent planet, that planet's
 * parent star). `type` is usually "Star"/"Planet"/"Ring"/"Null" but kept as a string fallback
 * since the Journal occasionally adds new parent types. Used by economyOverrides.ts to walk a
 * moon's tidal-lock chain up to its star. */
export interface JournalParent {
  type: string;
  bodyId: number;
}

/** One already-built facility occupying a specific orbital/ground slot on a body, entered by the
 * user in the System facilities panel — never derived from journal Scan data (the Journal has no
 * construction-progress events, see CLAUDE.md's scope boundaries). `demolishable` flags it as a
 * candidate the solver may choose to remove (refunding its stat/T2/T3 contribution and freeing its
 * slot) if replacing it scores better — always `false`/ignored for the 5 escalating-cost-curve port
 * buildings (`isPort()` in data/buildings.ts), which are never demolishable in this app. */
export interface PresentFacilitySlot {
  building: string;
  demolishable: boolean;
}

export interface JournalBody {
  bodyName: string;
  bodyId: number;
  kind: "star" | "planet";
  starType?: string;
  planetClass?: string;
  landable: boolean;
  surfaceGravity?: number;
  surfaceTemperature?: number;
  radius?: number;
  atmosphere?: string;
  terraformState?: string;
  tidalLocked?: boolean;
  parents: JournalParent[];
  rings: JournalRing[];
  /** Manually entered slot counts. The Journal doesn't report real per-body slot counts (they
   * vary and aren't derivable from Scan data) — this stays undefined until the user fills it in
   * via JournalImportPanel, which pre-fills it with eligibility.ts's best-effort guess. */
  slots?: Record<SlotKind, number>;
  /** What's already built in this body's slots today, entered by the user in the System
   * facilities panel — index-aligned with `slots.space`/`slots.ground` (a `null` entry or an
   * array shorter than the slot count means that slot is empty). Undefined until the user starts
   * marking facilities. See `domain/presentFacilities.ts` for the normalization/derivation logic
   * that reads this. */
  presentFacilities?: {
    space: (PresentFacilitySlot | null)[];
    ground: (PresentFacilitySlot | null)[];
  };
  /** The full raw Scan event JSON, kept verbatim alongside the typed fields above so future slot
   * heuristics can use fields we don't parse today without needing the user to re-upload the
   * journal. */
  raw: Record<string, unknown>;
}

export interface JournalSystem {
  starSystem: string;
  systemAddress: number;
  bodies: JournalBody[];
  /** The primary/claim station choice for this system, set by the System facilities panel's
   * "Save" button — never derived from journal Scan data. Undefined until saved once; restored
   * into form state when this saved system is selected and applied again (see
   * `JournalImportPanel.apply()`), so picking a primary station doesn't need to be redone every
   * time a saved system is reloaded. */
  firstStationBuilding?: string;
  firstStationBodyId?: number;
}

/** Natural/numeric name comparator, so "System A 2" sorts before "System A 10" — used everywhere
 * bodies are listed for the user (JournalImportPanel's table, SystemConfigPanel's primary-station
 * body picker) so the ordering matches the journal's own body list, not a plain string sort. */
export function compareBodyNames(a: JournalBody, b: JournalBody): number {
  return a.bodyName.localeCompare(b.bodyName, undefined, { numeric: true });
}

/** An Asteroid_Base is built on an ordinary orbital slot (see eligibility.ts), so "asteroid-eligible"
 * isn't its own slot pool — it's how many of the system's orbital slots sit on a ringed/belted body
 * and can therefore host one. Per-body `slots.asteroid` is just the yes/no eligibility flag, so this
 * sums that body's *orbital* slots wherever the flag is set, not the flags themselves. Shared by
 * JournalImportPanel (applying a selected system) and SystemPortabilityBar (importing an exported
 * one) — both need to derive the aggregate `PlannerFormState.slots` from a JournalSystem's bodies. */
export function computeSystemSlotTotals(system: JournalSystem): Record<SlotKind, number> {
  const totals: Record<SlotKind, number> = { space: 0, ground: 0, asteroid: 0 };
  for (const body of system.bodies) {
    const slots = body.slots ?? { space: 0, ground: 0, asteroid: 0 };
    totals.space += slots.space;
    totals.ground += slots.ground;
    if (slots.asteroid > 0) totals.asteroid += slots.space;
  }
  return totals;
}

interface RawScanEvent {
  event: "Scan";
  StarSystem: string;
  SystemAddress: number;
  BodyName: string;
  BodyID: number;
  StarType?: string;
  PlanetClass?: string;
  Landable?: boolean;
  SurfaceGravity?: number;
  SurfaceTemperature?: number;
  Radius?: number;
  Atmosphere?: string;
  TerraformState?: string;
  TidalLock?: boolean;
  Parents?: Record<string, number>[];
  Rings?: { Name: string; RingClass: string; ReserveLevel?: string; MassMT: number }[];
}

function isRealBodyScan(value: unknown): value is RawScanEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.event === "Scan" &&
    typeof record.StarSystem === "string" &&
    typeof record.SystemAddress === "number" &&
    typeof record.BodyName === "string" &&
    typeof record.BodyID === "number" &&
    (typeof record.StarType === "string" || typeof record.PlanetClass === "string")
  );
}

function toJournalBody(raw: RawScanEvent, rawJson: Record<string, unknown>): JournalBody {
  return {
    bodyName: raw.BodyName,
    bodyId: raw.BodyID,
    kind: raw.StarType !== undefined ? "star" : "planet",
    starType: raw.StarType,
    planetClass: raw.PlanetClass,
    landable: raw.Landable ?? false,
    surfaceGravity: raw.SurfaceGravity,
    surfaceTemperature: raw.SurfaceTemperature,
    radius: raw.Radius,
    atmosphere: raw.Atmosphere || undefined,
    terraformState: raw.TerraformState || undefined,
    tidalLocked: raw.TidalLock,
    parents: (raw.Parents ?? []).map((p) => {
      const [type, bodyId] = Object.entries(p)[0];
      return { type, bodyId };
    }),
    rings: (raw.Rings ?? []).map((r) => ({
      name: r.Name,
      ringClass: r.RingClass,
      reserveLevel: r.ReserveLevel,
      massMT: r.MassMT,
    })),
    raw: rawJson,
  };
}

/** Parses newline-delimited journal JSON into per-system body lists. Malformed lines and
 * non-Scan/non-body events are silently skipped — a journal file routinely has thousands of
 * unrelated events, and status/telemetry noise isn't an error condition here. */
export function parseJournalScans(text: string): JournalSystem[] {
  const systems = new Map<number, JournalSystem>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRealBodyScan(parsed)) continue;

    let system = systems.get(parsed.SystemAddress);
    if (!system) {
      system = { starSystem: parsed.StarSystem, systemAddress: parsed.SystemAddress, bodies: [] };
      systems.set(parsed.SystemAddress, system);
    }
    const body = toJournalBody(parsed, parsed as unknown as Record<string, unknown>);
    const existingIndex = system.bodies.findIndex((b) => b.bodyId === body.bodyId);
    if (existingIndex === -1) {
      system.bodies.push(body);
    } else {
      system.bodies[existingIndex] = body;
    }
  }

  return Array.from(systems.values());
}
