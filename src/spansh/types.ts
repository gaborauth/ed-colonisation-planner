// Minimal typed shapes for what's actually consumed from Spansh's public API (proxied through a
// self-hosted CORS proxy — see CLAUDE.md's "no backend" exception note). Deliberately not typing
// every field these responses actually carry (materials, atmosphere/solid composition percentages,
// market/station data, faction influence, etc.) — see adapter.ts for what's mapped and why the rest
// is left out entirely rather than carried around unused.

/** `GET /systems/field_values/name?q=...` — the real typeahead endpoint (NOT `/search`, which is a
 * full-text search returning full system records instead of name suggestions). */
export interface SpanshFieldValuesResponse {
  min_max: { id64: number; name: string }[];
}

export interface SpanshDumpRing {
  name: string;
  type: string;
  mass: number;
}

export interface SpanshDumpBody {
  bodyId: number;
  id64: number;
  name: string;
  type: "Star" | "Planet" | "Barycentre" | string;
  mainStar?: boolean;
  subType?: string;
  /** Same shape as Journal's raw `Parents` field: an array of single-key objects, key = parent
   * type ("Star"/"Planet"/"Null"), value = that parent's own `bodyId`. */
  parents?: Record<string, number>[];
  isLandable?: boolean;
  /** Same "g" units as Journal's `SurfaceGravity` — confirmed against real fixture values. */
  gravity?: number;
  surfaceTemperature?: number;
  /** Kilometers — Journal's `Radius` is in meters, needs `* 1000` (see adapter.ts). */
  radius?: number;
  atmosphereType?: string | null;
  rotationalPeriodTidallyLocked?: boolean;
  terraformingState?: string;
  volcanismType?: string | null;
  reserveLevel?: string;
  rings?: SpanshDumpRing[];
  /** Keys are the exact same `$SAA_SignalType_*;` strings Journal's `FSSBodySignals` event uses. */
  signals?: { signals: Record<string, number> };
}

/** `GET /dump/{id64}` response envelope — top-level key is `system`, not `record` (a different
 * shape than the now-unused `/system/{id64}` endpoint). */
export interface SpanshDumpRecord {
  name: string;
  id64: number;
  bodies: SpanshDumpBody[];
}
