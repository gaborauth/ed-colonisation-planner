// Converts a Spansh `/dump/{id64}` response into this app's own `JournalSystem`/`JournalBody[]`
// shape, so the exact same downstream pipeline (solver, economyOverrides.ts, eligibility.ts,
// presentFacilities.ts, the Actual-facilities tree, Build order table) works completely unchanged
// regardless of whether a system came from a real Journal upload or from Spansh. See CLAUDE.md's
// gap-analysis notes for the full field-by-field comparison this was built from.
//
// Deliberately does NOT persist the whole Spansh body object into `JournalBody.raw` the way the
// real Journal parser keeps the whole `Scan` event — a Spansh dump body carries a lot of incidental
// data (commodity/market info, faction influence, composition percentages) that would needlessly
// bloat every saved/exported system. `raw` here only ever carries the one field anything in the
// codebase actually reads out of it (`economyOverrides.ts`'s `hasVolcanism` reads `raw.Volcanism`).
import { parseParents, SIGNAL_TYPE_BIOLOGICAL, SIGNAL_TYPE_GEOLOGICAL, withRingBodies, type JournalBody, type JournalSystem } from "../journal/parser";
import type { SpanshDumpBody, SpanshDumpRecord } from "./types";

/** Spansh's `subType` wording -> Journal's exact `PlanetClass` string. Needed because several
 * `economyOverrides.ts` predicates (`isRockyIce`, `isWaterWorld`, `isAmmoniaWorld`, etc.) match
 * exactly rather than by substring — confirmed real mismatch: Spansh's "Rocky Ice world" must
 * become "Rocky ice body" or `isRockyIce` silently never fires. Built from general Elite Dangerous
 * domain knowledge covering every known planet class, NOT verified against a real Spansh sample for
 * every entry (only the classes actually present in `spansh-jsons/swoilz-aw-c-d52-dump.json` are
 * confirmed) — flagged the same way as every other entry in CLAUDE.md's "Explicitly
 * unverified/best-effort constants" section. Keys are matched case-insensitively; anything not
 * found here falls back to the raw subtype string with hyphens normalized to spaces (see
 * `mapPlanetClass` below), which still works for every predicate that only substring-matches.
 */
const SPANSH_PLANET_CLASS_MAP: Record<string, string> = {
  "metal-rich body": "Metal rich body",
  "metal rich world": "Metal rich body",
  "high metal content world": "High metal content body", // confirmed
  "rocky body": "Rocky body", // confirmed
  "rocky ice world": "Rocky ice body", // confirmed (real mismatch vs. Journal's own wording)
  "icy body": "Icy body", // confirmed
  "earth-like world": "Earthlike body",
  "water world": "Water world",
  "ammonia world": "Ammonia world",
  "water giant": "Water giant",
  "water giant with life": "Water giant with life",
  "gas giant with water-based life": "Gas giant with water based life",
  "gas giant with ammonia-based life": "Gas giant with ammonia based life",
  "class i gas giant": "Sudarsky class I gas giant",
  "class ii gas giant": "Sudarsky class II gas giant",
  "class iii gas giant": "Sudarsky class III gas giant", // confirmed
  "class iv gas giant": "Sudarsky class IV gas giant",
  "class v gas giant": "Sudarsky class V gas giant",
  "helium-rich gas giant": "Helium rich gas giant",
  "helium gas giant": "Helium gas giant",
};

function mapPlanetClass(subType: string | undefined): string | undefined {
  if (!subType) return undefined;
  const mapped = SPANSH_PLANET_CLASS_MAP[subType.toLowerCase()];
  if (mapped) return mapped;
  // Fallback for anything not in the table above: normalize hyphens to spaces so substring-based
  // predicates (isELW, isHighMetalContent, isGasGiant) still have a fighting chance of matching.
  return subType.replace(/-/g, " ");
}

/** Spansh's `subType` -> Journal's `StarType` code, precise enough for `economyOverrides.ts`'s
 * `starTypeOf()` 4-way bucket (blackhole/neutronstar/whitedwarf/other) — its "other" bucket display
 * label uses the raw string verbatim regardless of exact code, so a full ~30-code translation table
 * isn't needed, just these 3 special cases plus a best-effort leading-code extraction for the rest.
 * Best-effort/unverified beyond the one confirmed real sample ("F (White) Star" -> "F"). */
function mapStarType(subType: string | undefined): string | undefined {
  if (!subType) return undefined;
  const lower = subType.toLowerCase();
  if (lower.includes("supermassive black hole")) return "SupermassiveBlackHole";
  if (lower.includes("black hole")) return "H";
  if (lower.includes("neutron star")) return "N";
  if (lower.includes("white dwarf")) return "D";
  const match = subType.match(/^(\S+)\s*\(/);
  return match ? match[1] : subType;
}

function toJournalBody(body: SpanshDumpBody): JournalBody {
  const isStar = body.type === "Star";
  // A body can lack the `signals` key entirely (genuinely never scanned by anyone in Spansh's
  // database — confirmed against the real fixture: 18 of 31 planets have no `signals` key at all),
  // which must map to `undefined` ("unknown", matching Journal's own convention for an un-FSS'd
  // body) rather than `false` ("confirmed absent") — the latter would silently suppress
  // economyOverrides.ts's "unevaluated" disclosure for a body Spansh simply has no data for.
  const signalKeys = body.signals ? Object.keys(body.signals.signals) : undefined;
  return {
    bodyName: body.name,
    bodyId: body.bodyId,
    kind: isStar ? "star" : "planet",
    starType: isStar ? mapStarType(body.subType) : undefined,
    planetClass: isStar ? undefined : mapPlanetClass(body.subType),
    landable: body.isLandable ?? false,
    // Spansh's `gravity` is in G; this app's OWN `surfaceGravity` convention is m/s² (inherited
    // from real Journal `Scan` events' raw `SurfaceGravity` field, which `journal/parser.ts` keeps
    // unconverted — see FacilityInfo.tsx's `METERS_PER_SECOND_SQUARED_PER_G`-based "g" display
    // conversion and eligibility.ts's `GROUND_SLOT_MAX_GRAVITY_G` check, both of which assume this).
    // Confirmed exactly against the real committed fixture: `spansh.gravity * 9.80665` matches
    // `jsons/swoilz-aw-c-d52.json`'s real Journal-derived `surfaceGravity` for every one of its 36
    // bodies (worst-case relative error ~0.004%, pure Spansh-side rounding).
    surfaceGravity: body.gravity !== undefined ? body.gravity * 9.80665 : undefined,
    surfaceTemperature: body.surfaceTemperature,
    // Spansh reports radius in km, Journal (and eligibility.ts's thresholds) expect meters.
    radius: body.radius !== undefined ? body.radius * 1000 : undefined,
    atmosphere: body.atmosphereType || undefined,
    terraformState: body.terraformingState === "Terraformable" ? "Terraformable" : undefined,
    tidalLocked: body.rotationalPeriodTidallyLocked,
    parents: parseParents(body.parents),
    // A star's belts arrive under `belts`, not `rings` (see SpanshDumpBody.belts's doc comment) —
    // fall back to it so a star's asteroid eligibility isn't silently dropped.
    rings: (body.rings ?? body.belts ?? []).map((r) => ({ name: r.name, ringClass: r.type, massMT: r.mass })),
    reserveLevel: body.reserveLevel,
    hasBiologicalSignals: signalKeys?.includes(SIGNAL_TYPE_BIOLOGICAL),
    hasGeologicalSignals: signalKeys?.includes(SIGNAL_TYPE_GEOLOGICAL),
    // Deliberately minimal — see this file's header comment.
    raw: body.volcanismType ? { Volcanism: body.volcanismType } : {},
  };
}

/** Converts a Spansh `/dump/{id64}` record into this app's `JournalSystem` shape. Skips any body
 * whose `type` is `"Barycentre"` — binary-pair centers, not real scannable bodies (the same concept
 * Journal's `"Null"` parent-type entries represent). */
export function spanshDumpToJournalSystem(record: SpanshDumpRecord): JournalSystem {
  return {
    starSystem: record.name,
    // A system's `id64` and Frontier's `SystemAddress` are the same value scheme (confirmed: the
    // main star's own `id64` equals the system-level `id64`) — a later real Journal upload of the
    // same system lands under this identical key and merges correctly via
    // `JournalImportPanel.tsx`'s existing `mergeBySystemAddress`.
    systemAddress: record.id64,
    bodies: withRingBodies(record.bodies.filter((b) => b.type !== "Barycentre").map(toJournalBody)),
  };
}
