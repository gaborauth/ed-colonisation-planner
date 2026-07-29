// Minimal typed shape for what's actually consumed from a Raven Colonial project's exported backup
// JSON (Raven Colonial's own "Export backup" feature — the same shape as their `GET /api/v2/system/
// {id64}` API response; see adapter.ts's header comment for why this reads a file instead of
// calling that API directly) — not typing every field the real export carries (cmdr, architect,
// pos, revs, pop, etc.), see adapter.ts for what's mapped and why the rest is left out entirely
// rather than carried around unused.

export interface RcBody {
  name: string;
  /** This system's own small, real Frontier `bodyId` — same convention as this app's Spansh
   * adapter's `id64`/`bodyId` (the main star is always `num: 0`, matching a real Journal upload of
   * the same system). */
  num: number;
  type: string;
  subType?: string;
  features: string[];
  /** Kilometers; `-1` when unknown (always the case for the system's own star). */
  radius: number;
  temp: number;
  /** In m/s², not G, despite lining up numerically with Spansh's own same-named field
   * (`SpanshDumpBody.gravity`) — `-1` when unknown. Not currently read anywhere (see adapter.ts's
   * header comment on why body physical data is out of scope), documented for whenever it is. */
  gravity: number;
}

export interface RcSite {
  id: string;
  name: string;
  bodyNum: number;
  buildType: string;
  status: string;
  marketId?: number;
}

/** A Raven Colonial project's exported backup JSON (same shape as their live API response). */
export interface RcSystem {
  name: string;
  id64: number;
  reserveLevel?: string;
  bodies: RcBody[];
  sites: RcSite[];
  /** Per-bodyNum `[space, ground]` slot counts, `-1` meaning "not applicable" (a star/gas giant has
   * no ground slots; a moon/planet's ground count doesn't apply to a body with none). Manually
   * entered by whoever tracks the system in Raven Colonial — a pre-fill suggestion, not
   * infallible ground truth (confirmed: can contain the same kind of human error as this app's own
   * editable slot fields). */
  slots: Record<string, [number, number]>;
}

/** The FULL Raven Colonial "Export backup" JSON, kept verbatim — a superset of `RcSystem` above,
 * which only types the narrow subset `adapter.ts`'s import actually reads. `export.ts` (the
 * opposite direction: turning a solved plan back into an importable Raven Colonial file) needs the
 * rest of these fields carried through unchanged, even though nothing here ever inspects them.
 * `JournalImportPanel.tsx` stores the whole parsed upload as one of these on `JournalSystem.
 * ravenColonialSkeleton` (typed there as a generic `Record<string, unknown>`, same "opaque blob"
 * treatment as `JournalBody.raw` — this interface is the typed view used wherever that field is
 * actually read/written, i.e. adapter.ts and export.ts). All the extra fields are optional so a
 * hand-built `RcSystem` (e.g. in tests) still satisfies this type without needing them. */
export interface RcSystemSkeleton extends RcSystem {
  v?: number;
  rev?: number;
  architect?: string;
  pos?: number[];
  deleteIDs?: unknown[];
  updateIDs?: unknown[];
  pop?: unknown;
  open?: boolean;
  savedNames?: unknown[];
  idxCalcLimit?: number | null;
}
