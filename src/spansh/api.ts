// Thin fetch wrappers against a self-hosted CORS proxy in front of Spansh's public API — Spansh's
// own endpoints send no CORS headers at all (confirmed by curl during investigation: no
// Access-Control-Allow-Origin on /search, /system/{id64}, /systems/field_values/name, or /dump/{id64},
// including the OPTIONS preflight), so a browser call directly to spansh.co.uk from this app's
// origin is blocked. See CLAUDE.md's "no backend" exception note for why this proxy exists and what
// it does/doesn't change about this app's architecture.
import type { SpanshDumpRecord, SpanshFieldValuesResponse } from "./types";

const SPANSH_PROXY_BASE = "https://spansh-proxy.iotguru.dev";

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SPANSH_PROXY_BASE}${path}`);
  } catch {
    throw new Error("Couldn't reach the Spansh proxy — check your network connection.");
  }
  if (!response.ok) {
    throw new Error(`Spansh proxy request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

/** The real typeahead endpoint — `/search` is a different, full-text search endpoint that returns
 * complete system records, not name suggestions (see CLAUDE.md). Returns `[]` for a query with no
 * matches rather than throwing. */
export async function searchSystemNames(query: string): Promise<{ id64: number; name: string }[]> {
  const data = await getJson<SpanshFieldValuesResponse>(`/systems/field_values/name?q=${encodeURIComponent(query)}`);
  return data.min_max ?? [];
}

/** `/dump/{id64}` — a near-1:1 equivalent of real Journal Scan-event data per body (see CLAUDE.md's
 * gap-analysis notes). Unwraps the `{system: {...}}` envelope. */
export async function fetchSpanshSystemDump(id64: number): Promise<SpanshDumpRecord> {
  const data = await getJson<{ system: SpanshDumpRecord }>(`/dump/${id64}`);
  return data.system;
}
