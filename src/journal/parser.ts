// Parses an Elite Dangerous Journal file (newline-delimited JSON) client-side and extracts the
// per-system, per-body data needed for eligibility.ts's slot estimate. Only `Scan` events are used
// — per the project plan, there's no construction-progress tracking here, just body/system data.

export interface JournalRing {
  name: string;
  ringClass: string;
  reserveLevel?: string;
  massMT: number;
}

export interface JournalBody {
  bodyName: string;
  bodyId: number;
  kind: "star" | "planet";
  starType?: string;
  planetClass?: string;
  landable: boolean;
  surfaceGravity?: number;
  radius?: number;
  atmosphere?: string;
  terraformState?: string;
  rings: JournalRing[];
}

export interface JournalSystem {
  starSystem: string;
  systemAddress: number;
  bodies: JournalBody[];
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
  Radius?: number;
  Atmosphere?: string;
  TerraformState?: string;
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

function toJournalBody(raw: RawScanEvent): JournalBody {
  return {
    bodyName: raw.BodyName,
    bodyId: raw.BodyID,
    kind: raw.StarType !== undefined ? "star" : "planet",
    starType: raw.StarType,
    planetClass: raw.PlanetClass,
    landable: raw.Landable ?? false,
    surfaceGravity: raw.SurfaceGravity,
    radius: raw.Radius,
    atmosphere: raw.Atmosphere || undefined,
    terraformState: raw.TerraformState || undefined,
    rings: (raw.Rings ?? []).map((r) => ({
      name: r.Name,
      ringClass: r.RingClass,
      reserveLevel: r.ReserveLevel,
      massMT: r.MassMT,
    })),
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
    const body = toJournalBody(parsed);
    const existingIndex = system.bodies.findIndex((b) => b.bodyId === body.bodyId);
    if (existingIndex === -1) {
      system.bodies.push(body);
    } else {
      system.bodies[existingIndex] = body;
    }
  }

  return Array.from(systems.values());
}
