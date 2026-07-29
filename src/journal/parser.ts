// Parses an Elite Dangerous Journal file (newline-delimited JSON) client-side and extracts the
// per-system, per-body data needed for eligibility.ts's slot estimate. Consumes `Scan` events (body
// data) and `FSSBodySignals` events (bio/geo signal presence) — there's no construction-progress
// tracking here, just body/system data.

import type { SlotKind } from "../data/buildings";

export interface JournalRing {
  name: string;
  ringClass: string;
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
  /** Purely cosmetic real-world design variant (e.g. Coriolis "Two truss", Orbis "Apollo") — see
   * `data/buildings.ts`'s `BUILDING_VARIANTS`. Never affects stats/costs/solver behavior, only
   * display; undefined when the building has no known named variants or none was picked. */
  variant?: string;
  /** Purely cosmetic user-typed nickname for this specific facility (e.g. "Jacob's hydroponics").
   * Never affects stats/costs/solver behavior, only display. */
  customName?: string;
  /** True for exactly one synthetic entry: the primary/claim station's own copy of
   * `PlannerFormState.firstStationBuilding`/`firstStationBodyId`/`firstStationVariant`/
   * `firstStationCustomName`, kept at that body's Orbital 1 slot. Those flat fields are the actual
   * source of truth; this entry mirrors them (`domain/presentFacilities.ts`'s
   * `applyPrimaryReservation`/`syncPrimaryIntoBodies`, applied by `state/plannerState.ts`'s reducer
   * after every action, and independently by `solve.ts` for callers that don't go through that
   * reducer) so the primary participates in ordinary capacity/count/display computations (the
   * Constructions table, build order table, etc.) without each needing its own separate
   * bookkeeping for it. Always `demolishable: false`, and excluded from
   * `computeHardNonPortSeed`/`computePresentPortsSeed`'s T2/T3 point accounting — the primary's own
   * point contribution and cost exemption are handled entirely by `deriveCurrentPoints`/`solve.ts`'s
   * own separate logic, so counting it again here would double- or triple-count it. */
  primary?: boolean;
}

export interface JournalBody {
  bodyName: string;
  bodyId: number;
  /** `"ring"` is a synthetic body — a named ring/belt on a real star/planet, synthesized by
   * `withRingBodies` below into its own separate `JournalBody` (never present in raw Journal/Spansh
   * data itself) — see that function's doc comment for why. */
  kind: "star" | "planet" | "ring";
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
  /** The reserve level ("PristineResources"/"MajorResources"/etc.) of this body's own ring system
   * as a whole — a real, top-level field on the body's own `Scan` event (sitting alongside `Rings`,
   * confirmed against a real journal line), *not* nested per-ring as an earlier version of this
   * parser incorrectly assumed (that field was never actually populated — in observed real
   * exports, every ring had it unset). Only ever present on a body that actually has rings.
   * `domain/economyOverrides.ts`'s `systemResourceLevel` treats this as a system-wide fact despite
   * living on one specific body — any ringed body's reserve level IS the system's, there's no
   * separate system-level field for it. */
  reserveLevel?: string;
  /** Whether this body has Biological/Geological surface signals, per the Journal's
   * `FSSBodySignals` event (fired for a body once its system has been FSS ("honk") scanned — no
   * DSS/surface scan needed, unlike the SAASignalsFound-derived per-signal-TYPE breakdown some
   * other tools use). Confidently `true`/`false` when that event was seen for this body (its
   * `Signals` array lists every nonzero signal type present, so a type's absence from a present
   * event means confidently zero) — `undefined` (genuinely unknown) if the body was never
   * FSS-signal-scanned at all. Manually correctable in `JournalImportPanel`, same as `slots`,
   * since a re-uploaded/incomplete journal may not have this for every body. Used by
   * `domain/economyOverrides.ts` (organics/geologicals boost conditions) and, for geologicals,
   * `eligibility.ts`'s ground-slot guess. */
  hasBiologicalSignals?: boolean;
  hasGeologicalSignals?: boolean;
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
  /** Per-slot-index "leave empty" markers: tells the solver to never place a new building at this
   * index, independent of `presentFacilities` (what's actually built). Same index-alignment/padding
   * convention as `presentFacilities` above. Only meaningful where `presentFacilities[kind][index]`
   * is empty — the UI only offers the toggle there, and `solve.ts` only counts a blocked index when
   * it's also empty, so the two structures can never conflict. */
  blockedSlots?: {
    space: boolean[];
    ground: boolean[];
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
  /** Purely cosmetic design variant / user nickname for the primary station, same fields as
   * `PresentFacilitySlot`'s (see `domain/presentFacilities.ts`) but stored alongside
   * `firstStationBuilding` instead of in a body's `presentFacilities` — the primary station isn't
   * an ordinary slot entry, it's tracked as its own flat field. Never affects stats/costs/solver
   * behavior, only display. */
  firstStationVariant?: string;
  firstStationCustomName?: string;
  /** The full parsed Raven Colonial "Export backup" JSON, kept verbatim, set whenever a Raven
   * Colonial file is overlaid onto this system (`ravenColonial/adapter.ts`'s
   * `applyRavenColonialOverlay`) — undefined for a system that's never had one imported. Kept
   * opaque here (same "raw blob" treatment as `JournalBody.raw` below) rather than importing
   * `ravenColonial/types.ts`'s `RcSystemSkeleton` type directly, so this generic parsing module
   * doesn't need to know about that feature-specific shape; `ravenColonial/adapter.ts` and
   * `ravenColonial/export.ts` are the two places that actually read/write it typed as
   * `RcSystemSkeleton`. Exists so `ravenColonial/export.ts` can later turn a solved plan back into
   * a re-importable Raven Colonial file — see CLAUDE.md's "Raven Colonial import"/export notes. */
  ravenColonialSkeleton?: Record<string, unknown>;
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
  Rings?: { Name: string; RingClass: string; MassMT: number }[];
  ReserveLevel?: string;
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

interface RawFSSBodySignalsEvent {
  event: "FSSBodySignals";
  SystemAddress: number;
  BodyID: number;
  Signals: { Type: string; Count: number }[];
}

function isFSSBodySignals(value: unknown): value is RawFSSBodySignalsEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.event === "FSSBodySignals" &&
    typeof record.SystemAddress === "number" &&
    typeof record.BodyID === "number" &&
    Array.isArray(record.Signals)
  );
}

interface BodySignals {
  biological: boolean;
  geological: boolean;
}

/** The Journal's own signal-type strings, exported so `spansh/adapter.ts` can match against the
 * identical keys Spansh's `/dump/{id64}` uses for its `signals.signals` map — confirmed to be the
 * exact same strings, not just conceptually equivalent. */
export const SIGNAL_TYPE_BIOLOGICAL = "$SAA_SignalType_Biological;";
export const SIGNAL_TYPE_GEOLOGICAL = "$SAA_SignalType_Geological;";

/** Converts the Journal's raw `Parents` shape (an array of single-key objects, key = parent type,
 * value = that parent's own `BodyID`) into `JournalParent[]`. Exported so `spansh/adapter.ts` can
 * reuse it verbatim — Spansh's `/dump/{id64}` uses the byte-identical shape for its own `parents`
 * field. */
export function parseParents(parents: Record<string, number>[] | undefined): JournalParent[] {
  return (parents ?? []).map((p) => {
    const [type, bodyId] = Object.entries(p)[0];
    return { type, bodyId };
  });
}

const RING_BODY_ID_OFFSET = 1_000_000;

/** Deterministic synthetic bodyId for a body's Nth ring/belt — offset well above any real Frontier
 * bodyId (small sequential integers per system) so it can never collide, and derived from the
 * parent's own bodyId + ring index so it stays stable across re-imports (needed for
 * `JournalImportPanel`'s `mergeBySystemAddress`, which preserves a user's manually-edited slots by
 * matching `bodyId`). */
function ringBodyId(parentBodyId: number, ringIndex: number): number {
  return RING_BODY_ID_OFFSET + parentBodyId * 100 + ringIndex;
}

/** A STAR's own asteroid belt is, in-game, its own separate constructible location with its own
 * dedicated orbital slot — NOT extra capacity on the star's own slot(s); a named belt shows up as
 * its own distinct point in the system map, physically far from the star. A belt's dedicated slot
 * can ONLY ever hold an Asteroid_Base, not any other building (real-game-confirmed, 2026-07-28) —
 * see `solve.ts`'s `SolverBody.asteroidExclusive`, set from this synthetic body's `kind: "ring"`.
 * The star's OWN slot(s), unlike the belt, are never themselves asteroid-eligible. Synthesizes one
 * extra `JournalBody` (kind `"ring"`) per named belt on every
 * scanned STAR only — appended after the real bodies, so it shows up as its own row in
 * `JournalImportPanel`'s table and its own node in `domain/bodyHierarchy.ts`'s tree.
 *
 * **Deliberately star-only, not planets/moons**: a planet's or moon's own ring keeps making that
 * body's OWN orbital slot(s) asteroid-eligible instead, unchanged from this app's original
 * behavior — see `eligibility.ts`'s `estimateBodySlots`. This is an intentional asymmetry, not an
 * oversight: only a star's belt is far enough from the star itself to be its own separate location;
 * a planet's ring sits at the planet.
 *
 * `rings: [ring]` (self-referencing) so `economyOverrides.ts`'s `hasRings()` still fires for a port
 * built here — an Asteroid_Base built in a belt should still get the "Has rings" Extraction bonus,
 * same as a port built directly on a ringed planet gets it. The star's own `rings` field is left
 * untouched, so a port built directly on the star still gets that bonus too, independently.
 *
 * Best-effort, not exact: the real game can show multiple numbered "Cluster N" locations per named
 * belt (visible in the same screenshot), which Journal/Spansh scan data has no way to count — this
 * models exactly one slot per named belt, same as every other slot count in this app (editable in
 * the UI, never locked in).
 *
 * Exported so `spansh/adapter.ts` can apply the identical synthesis to its own bodies list. */
export function withRingBodies(bodies: JournalBody[]): JournalBody[] {
  const ringBodies: JournalBody[] = [];
  for (const body of bodies) {
    if (body.kind !== "star") continue;
    body.rings.forEach((ring, index) => {
      ringBodies.push({
        bodyName: ring.name,
        bodyId: ringBodyId(body.bodyId, index),
        kind: "ring",
        landable: false,
        parents: [{ type: "Star", bodyId: body.bodyId }, ...body.parents],
        rings: [ring],
        raw: {},
      });
    });
  }
  return ringBodies.length > 0 ? [...bodies, ...ringBodies] : bodies;
}

/** First pass over the file: collects every `FSSBodySignals` event into a `(SystemAddress, BodyID)`
 * lookup. Needed as a separate pass (rather than attaching inline while building bodies from `Scan`
 * events) because a body's `FSSBodySignals` event isn't guaranteed to appear after its `Scan` line
 * in the file — an FSS ("honk") scan and a body's own detailed scan happen independently.
 *
 * A single event's `Signals` array can list both Biological and Geological together (handled by
 * checking the whole array, not just its first entry) — but a journal spanning multiple play
 * sessions can also contain *two separate* `FSSBodySignals` events for the same body (e.g.
 * re-honked later, revealing a signal type the first pass didn't). Merges (OR) rather than
 * overwrites across repeated events for the same body, so a flag already confidently `true` never
 * flips back to `false` just because a later event for that body didn't happen to repeat it. */
function collectBodySignals(text: string): Map<string, BodySignals> {
  const signalsByBody = new Map<string, BodySignals>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isFSSBodySignals(parsed)) continue;
    const key = `${parsed.SystemAddress}:${parsed.BodyID}`;
    const existing = signalsByBody.get(key);
    signalsByBody.set(key, {
      biological: (existing?.biological ?? false) || parsed.Signals.some((s) => s.Type === SIGNAL_TYPE_BIOLOGICAL),
      geological: (existing?.geological ?? false) || parsed.Signals.some((s) => s.Type === SIGNAL_TYPE_GEOLOGICAL),
    });
  }
  return signalsByBody;
}

function toJournalBody(raw: RawScanEvent, rawJson: Record<string, unknown>, signals: BodySignals | undefined): JournalBody {
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
    parents: parseParents(raw.Parents),
    rings: (raw.Rings ?? []).map((r) => ({
      name: r.Name,
      ringClass: r.RingClass,
      massMT: r.MassMT,
    })),
    reserveLevel: raw.ReserveLevel,
    hasBiologicalSignals: signals?.biological,
    hasGeologicalSignals: signals?.geological,
    raw: rawJson,
  };
}

/** Parses newline-delimited journal JSON into per-system body lists. Malformed lines and
 * non-Scan/non-body events are silently skipped — a journal file routinely has thousands of
 * unrelated events, and status/telemetry noise isn't an error condition here. */
export function parseJournalScans(text: string): JournalSystem[] {
  const systems = new Map<number, JournalSystem>();
  const bodySignals = collectBodySignals(text);

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
    const signals = bodySignals.get(`${parsed.SystemAddress}:${parsed.BodyID}`);
    const body = toJournalBody(parsed, parsed as unknown as Record<string, unknown>, signals);
    const existingIndex = system.bodies.findIndex((b) => b.bodyId === body.bodyId);
    if (existingIndex === -1) {
      system.bodies.push(body);
    } else {
      system.bodies[existingIndex] = body;
    }
  }

  return Array.from(systems.values()).map((system) => ({ ...system, bodies: withRingBodies(system.bodies) }));
}
