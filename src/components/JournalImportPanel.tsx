import { type Dispatch, useEffect, useRef, useState } from "react";
import { ALL_SLOTS, type SlotKind } from "../data/buildings";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import { estimateBodySlots } from "../journal/eligibility";
import {
  compareBodyNames,
  computeSystemSlotTotals,
  parseJournalScans,
  type JournalBody,
  type JournalSystem,
} from "../journal/parser";
import { getLastUsedSystemAddress, listSavedSystems, saveSystem, setLastUsedSystemAddress } from "../persistence/journalSystems";
import { applyRavenColonialOverlay } from "../ravenColonial/adapter";
import type { RcSystemSkeleton } from "../ravenColonial/types";
import { spanshDumpToJournalSystem } from "../spansh/adapter";
import { fetchSpanshSystemDump, searchSystemNames } from "../spansh/api";
import type { PlannerAction } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

type ImportTab = "journal" | "spansh";

interface JournalImportPanelProps {
  dispatch: Dispatch<PlannerAction>;
  /** Bumped by App.tsx whenever SystemPortabilityBar's Save/Import writes a system into the shared
   * localStorage store — this panel loads its own `systems` list once at mount, so it otherwise
   * never notices a sibling component's write (e.g. importing a JSON file wouldn't update this
   * panel's slot-count table for that system without this). */
  refreshToken?: number;
  /** Called whenever a system is actually applied to `formState` (button click OR the mount-time
   * auto-apply) — lets App.tsx clear its stale solved result, which is keyed to the PREVIOUS
   * system's bodies and would otherwise keep showing through against the newly-applied one. */
  onSystemChanged?: () => void;
  /** `formState.systemAddress` — read-only, purely so this panel can notice when SOMETHING ELSE
   * changed the active system (SystemPortabilityBar's toolbar switcher dispatches straight to
   * `formState`, bypassing this panel's own `selectedAddress`/`systems` state entirely, unlike
   * this panel's own Apply flow). Without this, switching systems via the toolbar would leave this
   * panel's body/slot table showing the PREVIOUS system. See the dedicated effect below. */
  activeSystemAddress?: number | null;
}

const SLOT_KINDS = Object.keys(ALL_SLOTS) as SlotKind[];

const EMPTY_SLOTS: Record<SlotKind, number> = { space: 0, ground: 0, asteroid: 0 };

/** Bodies from a fresh parse (or an older saved system, from before per-body slots existed) have
 * no `slots` yet — seed them with eligibility.ts's best-effort guess so the inputs start somewhere
 * sensible instead of blank. */
function withDefaultSlots(body: JournalBody): JournalBody {
  return body.slots ? body : { ...body, slots: estimateBodySlots(body).slots };
}

function normalizeSystem(system: JournalSystem): JournalSystem {
  return { ...system, bodies: system.bodies.map(withDefaultSlots) };
}

/** Merges freshly-parsed bodies into any previously-known system, preserving the user's manually
 * entered slots for bodies already seen (a re-uploaded/updated journal shouldn't wipe out work
 * already done), and only seeding heuristic defaults for genuinely new bodies. */
function mergeBySystemAddress(existing: JournalSystem[], incoming: JournalSystem[]): JournalSystem[] {
  const byAddress = new Map(existing.map((s) => [s.systemAddress, s]));
  for (const system of incoming) {
    const prior = byAddress.get(system.systemAddress);
    const bodies = system.bodies.map((body) => {
      const priorBody = prior?.bodies.find((b) => b.bodyId === body.bodyId);
      const withSlots = priorBody?.slots ? { ...body, slots: priorBody.slots } : withDefaultSlots(body);
      // Preserve already-built facility tracking across re-uploads too, same as `slots` above —
      // the "Actual facilities in the system" panel is the only place this gets edited, so a fresh
      // journal parse (which knows nothing about it) must not silently wipe it out.
      const withPresent = priorBody?.presentFacilities
        ? { ...withSlots, presentFacilities: priorBody.presentFacilities }
        : withSlots;
      // Same precedence as presentFacilities above — a "leave empty" marker is manually entered by
      // the user in the System facilities panel, and a fresh journal/Spansh parse knows nothing
      // about it either.
      const withBlocked = priorBody?.blockedSlots ? { ...withPresent, blockedSlots: priorBody.blockedSlots } : withPresent;
      // Same idea as slots/presentFacilities above, but the OPPOSITE precedence: unlike a slot
      // count (always a rough guess needing human judgment), a confident true/false here came from
      // real `FSSBodySignals` event data in THIS upload's journal (see journal/parser.ts) — that's
      // more authoritative than whatever's already stored, so it should win outright, even when a
      // body's signals arrived split across multiple journal events that need merging. Only fall
      // back to the prior stored value (a manual correction, or an earlier upload's finding) when
      // THIS upload's journal doesn't cover that body's signals at all (`undefined` — genuinely no
      // FSSBodySignals event for it here).
      return {
        ...withBlocked,
        hasBiologicalSignals: body.hasBiologicalSignals ?? priorBody?.hasBiologicalSignals,
        hasGeologicalSignals: body.hasGeologicalSignals ?? priorBody?.hasGeologicalSignals,
      };
    });
    // Same preservation for the saved primary station choice (and its cosmetic variant/nickname)
    // — a fresh journal parse never carries any of these, so without this a re-upload would
    // silently clear them.
    byAddress.set(system.systemAddress, {
      ...system,
      bodies,
      firstStationBuilding: prior?.firstStationBuilding ?? system.firstStationBuilding,
      firstStationBodyId: prior?.firstStationBodyId ?? system.firstStationBodyId,
      firstStationVariant: prior?.firstStationVariant ?? system.firstStationVariant,
      firstStationCustomName: prior?.firstStationCustomName ?? system.firstStationCustomName,
    });
  }
  return Array.from(byAddress.values()).sort((a, b) => a.starSystem.localeCompare(b.starSystem));
}

export function JournalImportPanel({
  dispatch,
  refreshToken,
  onSystemChanged,
  activeSystemAddress,
}: JournalImportPanelProps) {
  // Purely backing data for the shared body/slot table below and `mergeBySystemAddress`'s
  // slot-preservation lookup — no longer seeded from `listSavedSystems()` at mount. It's
  // repopulated automatically by the `activeSystemAddress`-sync effect further down the moment a
  // real system becomes active (including the mount-time restore, which now lives in
  // SystemPortabilityBar — see that component). Switching to / browsing already-saved systems is
  // exclusively SystemPortabilityBar's toolbar switcher's job now, not this panel's.
  const [systems, setSystems] = useState<JournalSystem[]>([]);
  // Addresses parsed from the MOST RECENT Journal file upload — drives the Journal tab's own
  // candidate picker (`pickedAddress` below). `null` when nothing's been freshly uploaded this
  // session; distinct from `selectedAddress`, which is whatever's actually loaded into the shared
  // table — picking a candidate here doesn't touch the table until "Load" is clicked, mirroring
  // the Spansh tab's search -> pick -> Load pattern.
  const [pendingAddresses, setPendingAddresses] = useState<number[] | null>(null);
  const [pickedAddress, setPickedAddress] = useState<number | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(false);

  const [activeTab, setActiveTab] = useState<ImportTab>("journal");
  const [spanshQuery, setSpanshQuery] = useState("");
  const [spanshCandidates, setSpanshCandidates] = useState<{ id64: number; name: string }[]>([]);
  const [spanshSelected, setSpanshSelected] = useState<{ id64: number; name: string } | null>(null);
  const [spanshSearching, setSpanshSearching] = useState(false);
  const [spanshLoading, setSpanshLoading] = useState(false);
  const [spanshError, setSpanshError] = useState<string | null>(null);

  // Overlays a Raven Colonial export's slots + built facilities onto whichever system is currently
  // loaded (from either tab) — not itself a separate import source/tab, since Raven Colonial's own
  // data has no per-body physical/orbital data of its own (see ravenColonial/adapter.ts's header
  // comment); it only ever augments a system already loaded from a Journal file or Spansh.
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcWarnings, setRcWarnings] = useState<string[]>([]);
  const [rcImported, setRcImported] = useState(false);

  useEffect(() => {
    const query = spanshQuery.trim();
    if (query.length < 2) {
      setSpanshCandidates([]);
      return;
    }
    setSpanshSearching(true);
    const handle = setTimeout(() => {
      searchSystemNames(query)
        .then((results) => setSpanshCandidates(results))
        .catch((e) => setSpanshError((e as Error).message))
        .finally(() => setSpanshSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [spanshQuery]);

  async function handleSpanshLoad(): Promise<void> {
    if (!spanshSelected) return;
    setSpanshLoading(true);
    setSpanshError(null);
    try {
      const record = await fetchSpanshSystemDump(spanshSelected.id64);
      const system = spanshDumpToJournalSystem(record);
      setSystems((prev) => mergeBySystemAddress(prev, [system]));
      setSelectedAddress(system.systemAddress);
      setApplied(false);
    } catch (e) {
      setSpanshError((e as Error).message);
    } finally {
      setSpanshLoading(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = parseJournalScans(text);
      if (parsed.length === 0) {
        setError("No scanned systems found in that file.");
        return;
      }
      setSystems((prev) => mergeBySystemAddress(prev, parsed));
      setPendingAddresses(parsed.map((s) => s.systemAddress));
      setPickedAddress(parsed[0].systemAddress);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Brings the currently-picked Journal-tab candidate into the shared table — mirrors
  // `handleSpanshLoad`'s pick-then-Load pattern, just synchronous (the data's already local, no
  // fetch needed).
  function handleJournalLoad(): void {
    if (pickedAddress == null) return;
    setSelectedAddress(pickedAddress);
    setApplied(false);
  }

  const selected = systems.find((s) => s.systemAddress === selectedAddress) ?? null;

  function updateBodySlot(bodyId: number, kind: SlotKind, value: number): void {
    if (!selected) return;
    setSystems((prev) =>
      prev.map((s) =>
        s.systemAddress !== selected.systemAddress
          ? s
          : {
              ...s,
              bodies: s.bodies.map((b) =>
                b.bodyId !== bodyId ? b : { ...b, slots: { ...(b.slots ?? EMPTY_SLOTS), [kind]: value } },
              ),
            },
      ),
    );
    setApplied(false);
  }

  // Pre-filled from the Journal's FSSBodySignals event when present (see journal/parser.ts), but
  // freely correctable here — same reasoning as updateBodySlot above, just for real parsed data
  // instead of a heuristic guess.
  function updateBodySignal(bodyId: number, field: "hasBiologicalSignals" | "hasGeologicalSignals", value: boolean): void {
    if (!selected) return;
    setSystems((prev) =>
      prev.map((s) =>
        s.systemAddress !== selected.systemAddress
          ? s
          : { ...s, bodies: s.bodies.map((b) => (b.bodyId !== bodyId ? b : { ...b, [field]: value })) },
      ),
    );
    setApplied(false);
  }

  function resetToGuess(): void {
    if (!selected) return;
    setSystems((prev) =>
      prev.map((s) =>
        s.systemAddress !== selected.systemAddress
          ? s
          : { ...s, bodies: s.bodies.map((b) => ({ ...b, slots: estimateBodySlots(b).slots })) },
      ),
    );
    setApplied(false);
  }

  // Reads a user-uploaded Raven Colonial "Export backup" JSON file and overlays its slots + built
  // facilities onto the currently loaded system, same "edit in place, don't re-apply automatically"
  // pattern as updateBodySlot/resetToGuess above. Deliberately a file upload, not a live API call —
  // see ravenColonial/adapter.ts's header comment for why.
  async function handleRavenColonialFile(file: File): Promise<void> {
    if (!selected) return;
    setRcLoading(true);
    setRcError(null);
    setRcWarnings([]);
    setRcImported(false);
    try {
      const text = await file.text();
      let rc: RcSystemSkeleton;
      try {
        rc = JSON.parse(text) as RcSystemSkeleton;
      } catch {
        throw new Error("That doesn't look like a valid JSON file.");
      }
      const { system, warnings } = applyRavenColonialOverlay(selected, rc);
      setSystems((prev) => prev.map((s) => (s.systemAddress !== selected.systemAddress ? s : system)));
      setRcWarnings(warnings);
      setRcImported(true);
      setApplied(false);
    } catch (e) {
      setRcError((e as Error).message);
    } finally {
      setRcLoading(false);
    }
  }

  // Also pushes the full per-body list (not just the summed totals) — this is what switches the
  // solver from aggregate mode into per-body placement mode (see plannerState.ts/solve.ts) — and
  // unlocks "Actual facilities in the system," which starts locked/greyed until configured one way
  // or another.
  function applySystem(system: JournalSystem): void {
    dispatch({
      type: "patch",
      patch: {
        slots: computeSystemSlotTotals(system),
        bodies: system.bodies,
        systemConfigured: true,
        systemAddress: system.systemAddress,
        starSystem: system.starSystem,
        ravenColonialSkeleton: system.ravenColonialSkeleton,
        // Restores whatever primary station was saved for this system (see SystemConfigPanel's
        // "Save" button) — blank/undefined for a system that's never had one chosen yet, which
        // correctly resets the field rather than leaving a previous system's choice behind.
        firstStationBuilding: system.firstStationBuilding ?? "",
        firstStationBodyId: system.firstStationBodyId,
        firstStationVariant: system.firstStationVariant,
        firstStationCustomName: system.firstStationCustomName,
      },
    });
    setApplied(true);
    setSelectedAddress(system.systemAddress);
    saveSystem(system);
    setLastUsedSystemAddress(system.systemAddress);
    setCollapsed(true);
    // Clear each tab's own in-progress pick/search state — not `systems`/`selectedAddress`, which
    // just got applied and should stay — so reopening the panel later starts clean instead of
    // showing a stale candidate left over from before this Apply.
    setPendingAddresses(null);
    setPickedAddress(null);
    setSpanshQuery("");
    setSpanshCandidates([]);
    setSpanshSelected(null);
    setSpanshError(null);
    onSystemChanged?.();
  }

  function apply(): void {
    if (!selected) return;
    applySystem(selected);
    // Deferred one frame so the fold has already committed/laid out before we measure where to
    // scroll — doing this synchronously would scroll based on the pre-collapse layout.
    requestAnimationFrame(() => {
      document.getElementById("system-panel")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  // Re-reads the saved-systems store whenever `refreshToken` changes (see the prop's doc comment)
  // — SystemPortabilityBar's Save/Import write straight to localStorage, bypassing this panel's own
  // `systems` state entirely, so without this its slot-count table would keep showing stale data
  // (or miss a freshly-imported system) until a full page reload. Skips the very first run: the
  // initial `useState` calls above already loaded the store once at mount.
  const isFirstRefresh = useRef(true);
  useEffect(() => {
    if (isFirstRefresh.current) {
      isFirstRefresh.current = false;
      return;
    }
    const saved = listSavedSystems().map(normalizeSystem);
    setSystems(saved);
    const lastUsedAddress = getLastUsedSystemAddress();
    if (lastUsedAddress !== null && saved.some((s) => s.systemAddress === lastUsedAddress)) {
      setSelectedAddress(lastUsedAddress);
      setApplied(true);
    } else {
      // Nothing meaningful left to point at — e.g. SystemPortabilityBar's Delete button just
      // removed the currently-active system (which also clears the last-used pointer, see
      // journalSystems.ts's `deleteSystem`) — don't leave this panel showing a stale "applied"
      // system that no longer exists in storage.
      setSelectedAddress(null);
      setApplied(false);
    }
  }, [refreshToken]);

  // Mirrors this panel's own `selectedAddress` to `formState.systemAddress` whenever THAT changes
  // out from under it — i.e. the toolbar switcher case above, not this panel's own Apply (which
  // already sets both `selectedAddress` and `formState.systemAddress` together, so they're already
  // equal by the time this effect would run and it's a no-op). No `setApplied` here unlike the
  // refreshToken effect above — nothing was actually saved or applied FROM this panel, it's just
  // catching up to a change made elsewhere.
  //
  // This only treats `activeSystemAddress` as an EXTERNAL change (the toolbar switcher case this
  // effect exists for) when `activeSystemAddress` itself just changed — tracked via a ref — rather
  // than whenever it merely differs from this panel's own `selectedAddress`. The two deliberately
  // diverge for a while during an in-progress Load/Apply preview (e.g. the Spansh tab's "Load"
  // button sets `selectedAddress` to a not-yet-applied candidate before Apply syncs it into
  // `formState.systemAddress`); reacting to that divergence directly (instead of to
  // `activeSystemAddress` actually changing) would re-trigger this effect mid-preview, reload only
  // the already-persisted systems from localStorage (the freshly-loaded, not-yet-saved candidate
  // isn't among them), and reset `selectedAddress` straight back to `activeSystemAddress`, silently
  // undoing the in-progress Load.
  const prevActiveSystemAddress = useRef(activeSystemAddress);
  useEffect(() => {
    const previousActiveSystemAddress = prevActiveSystemAddress.current;
    prevActiveSystemAddress.current = activeSystemAddress;
    if (activeSystemAddress == null || activeSystemAddress === previousActiveSystemAddress) return;
    if (activeSystemAddress === selectedAddress) return;
    const saved = listSavedSystems().map(normalizeSystem);
    setSystems(saved);
    if (saved.some((s) => s.systemAddress === activeSystemAddress)) {
      setSelectedAddress(activeSystemAddress);
    }
  }, [activeSystemAddress, selectedAddress]);

  const totals = selected ? computeSystemSlotTotals(selected) : null;

  return (
    <section className="panel">
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">
          Import system
          {collapsed && applied && (
            <span className="panel-toggle-status">Applied to Actual facilities in the system and saved</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && (
        <>
          <div className="tablist" role="tablist" aria-label="Import source">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "journal"}
              className="tab"
              onClick={() => setActiveTab("journal")}
            >
              Journal file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "spansh"}
              className="tab"
              onClick={() => setActiveTab("spansh")}
            >
              Spansh
            </button>
          </div>

          {activeTab === "journal" && (
            <div role="tabpanel" aria-label="Journal file import">
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>
                In-game, the automatic Discovery Scan ("honk") alone isn't enough — open the Full
                Spectrum Scanner (throttle down to 0% in supercruise) and individually FSS-scan every
                body in the system first. The more bodies scanned this way, the better the slot-count
                guess below will be. Then upload your Journal file, which lives in your Saved Games
                folder, named by date/time, e.g.{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {"C:\\Users\\<you>\\Saved Games\\Frontier Developments\\Elite Dangerous\\Journal.2026-07-26T081047.01.log"}
                </code>{" "}
                — pick the most recent one from your current play session.
              </p>
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 0 }}>
                The Journal doesn't report real slot counts — they vary per body and can't be derived from
                scan data. Fields below are pre-filled with a <strong>best-effort, unverified</strong> guess;
                check your in-game System Map and correct each body's numbers as needed.
              </p>
              <div className="row-grid" style={{ marginTop: 10 }}>
                <input
                  type="file"
                  accept=".log,.jsonl,text/plain"
                  aria-label="Journal file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.target.value = "";
                  }}
                />
                {pendingAddresses !== null && pendingAddresses.length > 0 && (
                  <>
                    <div className="field">
                      <label htmlFor="journal-system">System</label>
                      <select
                        id="journal-system"
                        value={pickedAddress ?? ""}
                        onChange={(e) => setPickedAddress(Number(e.target.value))}
                      >
                        {pendingAddresses.map((address) => {
                          const candidate = systems.find((s) => s.systemAddress === address);
                          if (!candidate) return null;
                          return (
                            <option key={address} value={address}>
                              {candidate.starSystem} ({candidate.bodies.length} bodies scanned)
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleJournalLoad}
                      disabled={pickedAddress == null}
                      style={{ marginLeft: "auto" }}
                    >
                      Load
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === "spansh" && (
            <div role="tabpanel" aria-label="Spansh import">
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>
                Alternative to uploading a Journal file: search Spansh's public system database by
                name and load a starting point directly, no journal file needed — useful for a
                system you haven't personally scanned yet. Spansh's body data is generally close to
                a real Journal scan, but signal/genus data reflects whoever last scanned that body
                in Spansh's own database, not necessarily your own play session; cross-check against
                your in-game System Map the same as with a Journal import.
              </p>
              <div className="row-grid">
                <div className="field">
                  <label htmlFor="spansh-query">System name</label>
                  <input
                    id="spansh-query"
                    type="text"
                    value={spanshQuery}
                    placeholder="Start typing a system name…"
                    autoComplete="off"
                    onChange={(e) => {
                      setSpanshQuery(e.target.value);
                      setSpanshSelected(null);
                      setSpanshError(null);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSpanshLoad()}
                  disabled={!spanshSelected || spanshLoading}
                  style={{ marginLeft: "auto" }}
                >
                  {spanshLoading ? "Loading…" : "Load"}
                </button>
              </div>
              {spanshSearching && <div className="status-banner loading">Searching Spansh…</div>}
              {!spanshSelected && spanshCandidates.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Matching systems"
                  style={{
                    listStyle: "none",
                    margin: "4px 0",
                    padding: 0,
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                  }}
                >
                  {spanshCandidates.map((c) => (
                    <li key={c.id64}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setSpanshSelected(c);
                          setSpanshQuery(c.name);
                          setSpanshCandidates([]);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "4px 8px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {spanshError && <div className="status-banner">{spanshError}</div>}
            </div>
          )}

          {error && <div className="status-banner">{error}</div>}

          {selected && (
            <div style={{ marginTop: 10 }}>
              {/* Hidden once the currently loaded system has no unapplied changes left — most
               * notably right after "Apply slots and body layout" is clicked (`applied` flips back
               * to `false` on the next edit/import, which brings this back). Keeps the panel from
               * still prompting to import Raven Colonial data for a system that was just saved. */}
              {!applied && (
                <>
                  <div className="row-grid">
                    <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
                      Already tracking this system's construction in{" "}
                      <a href="https://ravencolonial.com/" target="_blank" rel="noreferrer">
                        Raven Colonial
                      </a>
                      ? Upload its "Export backup" JSON file to overlay its slot counts and built
                      facilities onto the system loaded above (its own body/orbital data is
                      untouched). Raven Colonial's slot counts are manually entered by whoever
                      tracks the project, same as this panel's own fields — check them the same way.
                    </p>
                    <input
                      type="file"
                      accept=".json,application/json"
                      aria-label="Raven Colonial export backup file"
                      disabled={rcLoading}
                      style={{ marginLeft: "auto" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleRavenColonialFile(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {rcError && <div className="status-banner">{rcError}</div>}
                  {rcImported && !rcError && (
                    <div className="status-banner" style={{ color: "var(--success)" }}>
                      Raven Colonial file processed successfully — check "Apply slots and body
                      layout" below to save it.
                    </div>
                  )}
                  {rcWarnings.length > 0 && (
                    <div className="status-banner">
                      {rcWarnings.map((w) => (
                        <div key={w}>{w}</div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Body</th>
                    {SLOT_KINDS.map((kind) => (
                      <th key={kind}>{ALL_SLOTS[kind]}</th>
                    ))}
                    <th title="From the Journal's FSSBodySignals event (an ordinary FSS/'honk' scan) when present — correct freely if it's missing or wrong.">
                      Bio signals
                    </th>
                    <th title="From the Journal's FSSBodySignals event (an ordinary FSS/'honk' scan) when present — correct freely if it's missing or wrong.">
                      Geo signals
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...selected.bodies].sort(compareBodyNames).map((body) => (
                    <tr key={body.bodyId}>
                      <td title={estimateBodySlots(body).reason}>{body.bodyName}</td>
                      {SLOT_KINDS.map((kind) =>
                        kind === "asteroid" ? (
                          <td key={kind}>
                            <input
                              type="checkbox"
                              aria-label={`${body.bodyName} asteroid base eligible`}
                              checked={(body.slots?.[kind] ?? 0) > 0}
                              onChange={(e) => updateBodySlot(body.bodyId, kind, e.target.checked ? 1 : 0)}
                            />
                          </td>
                        ) : (
                          <td key={kind}>
                            <NumberInput
                              ariaLabel={`${body.bodyName} ${ALL_SLOTS[kind]} slots`}
                              value={body.slots?.[kind] ?? 0}
                              blankMeans="zero"
                              onChange={(v) => updateBodySlot(body.bodyId, kind, v ?? 0)}
                            />
                          </td>
                        ),
                      )}
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${body.bodyName} biological signals`}
                          checked={body.hasBiologicalSignals ?? false}
                          onChange={(e) => updateBodySignal(body.bodyId, "hasBiologicalSignals", e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${body.bodyName} geological signals`}
                          checked={body.hasGeologicalSignals ?? false}
                          onChange={(e) => updateBodySignal(body.bodyId, "hasGeologicalSignals", e.target.checked)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totals && (
                <div className="row-grid" style={{ marginTop: 10 }}>
                  <span>
                    Total: {totals.space} orbital ({totals.asteroid} asteroid-eligible) / {totals.ground}{" "}
                    ground
                  </span>
                  <button type="button" onClick={resetToGuess} style={{ marginLeft: "auto" }}>
                    Reset slots to guess
                  </button>
                  <button
                    type="button"
                    className={!applied ? "primary" : undefined}
                    onClick={apply}
                    title={!applied ? "There are unapplied changes — click to save them." : undefined}
                  >
                    Apply slots and body layout to Actual facilities in the system
                  </button>
                  {applied && (
                    <span style={{ color: "var(--success)" }}>
                      Applied to Actual facilities in the system and saved
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
