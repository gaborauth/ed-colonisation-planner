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
      // Same idea as slots/presentFacilities above, but the OPPOSITE precedence: unlike a slot
      // count (always a rough guess needing human judgment), a confident true/false here came from
      // real `FSSBodySignals` event data in THIS upload's journal (see journal/parser.ts) — that's
      // more authoritative than whatever's already stored, so it should win outright, including
      // over a stale value persisted from before a parser fix (e.g. the "combines in rare cases"
      // multi-event-merge correction). Only fall back to the prior stored value (a manual
      // correction, or an earlier upload's finding) when THIS upload's journal doesn't cover that
      // body's signals at all (`undefined` — genuinely no FSSBodySignals event for it here).
      return {
        ...withPresent,
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

export function JournalImportPanel({ dispatch, refreshToken, onSystemChanged }: JournalImportPanelProps) {
  const [systems, setSystems] = useState<JournalSystem[]>(() => listSavedSystems().map(normalizeSystem));
  const [savedAddresses, setSavedAddresses] = useState<Set<number>>(
    () => new Set(listSavedSystems().map((s) => s.systemAddress)),
  );
  const [selectedAddress, setSelectedAddress] = useState<number | null>(() => {
    const saved = listSavedSystems();
    const lastUsed = getLastUsedSystemAddress();
    if (lastUsed !== null && saved.some((s) => s.systemAddress === lastUsed)) return lastUsed;
    return saved[0]?.systemAddress ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(false);

  const [activeTab, setActiveTab] = useState<ImportTab>("journal");
  const [spanshQuery, setSpanshQuery] = useState("");
  const [spanshCandidates, setSpanshCandidates] = useState<{ id64: number; name: string }[]>([]);
  const [spanshSelected, setSpanshSelected] = useState<{ id64: number; name: string } | null>(null);
  const [spanshSearching, setSpanshSearching] = useState(false);
  const [spanshLoading, setSpanshLoading] = useState(false);
  const [spanshError, setSpanshError] = useState<string | null>(null);

  // Debounced typeahead against Spansh's name-suggestion endpoint — minimum 2 characters, ~300ms
  // after the user stops typing, so this doesn't fire a request per keystroke.
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
      setJustSaved(false);
    } catch (e) {
      setSpanshError((e as Error).message);
    } finally {
      setSpanshLoading(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    setApplied(false);
    setJustSaved(false);
    try {
      const text = await file.text();
      const parsed = parseJournalScans(text);
      if (parsed.length === 0) {
        setError("No scanned systems found in that file.");
        return;
      }
      setSystems((prev) => mergeBySystemAddress(prev, parsed));
      setSelectedAddress(parsed[0].systemAddress);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
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
    setJustSaved(false);
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
    setJustSaved(false);
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
    setJustSaved(false);
  }

  // Also pushes the full per-body list (not just the summed totals) — this is what switches the
  // solver from aggregate mode into per-body placement mode (see plannerState.ts/solve.ts) — and
  // unlocks "Actual facilities in the system," which starts locked/greyed until configured one way
  // or another.
  // Shared by the "Apply" button and the mount-time auto-apply effect below.
  function applySystem(system: JournalSystem): void {
    dispatch({
      type: "patch",
      patch: {
        slots: computeSystemSlotTotals(system),
        bodies: system.bodies,
        systemConfigured: true,
        systemAddress: system.systemAddress,
        starSystem: system.starSystem,
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
    setSavedAddresses((prev) => new Set(prev).add(system.systemAddress));
    setJustSaved(true);
    setLastUsedSystemAddress(system.systemAddress);
    setCollapsed(true);
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

  // On first load, silently re-apply whichever system was last used, as long as it has bodies —
  // "Actual facilities in the system" should already look "applied" (filled in, Journal panel
  // folded) without the user needing to click "Apply" again every session. Used to also require a
  // saved primary station (leaving a system with none "incomplete, nothing useful to auto-apply"),
  // but that created a real, user-reported inconsistency: this panel's own `systems`/
  // `selectedAddress` state (below) already defaults to the same last-used system regardless of
  // primary-station status, so the panel visually looked "loaded" while the rest of the app
  // (`formState`, the toolbar system switcher, "Actual facilities in the system") stayed blank —
  // two different parts of the UI disagreeing about whether a system was active. Not having a
  // primary station yet is a perfectly normal, valid intermediate state elsewhere in the app
  // (e.g. right after a brand-new system's first-ever Apply, before one's been chosen) — only
  // actually solving requires one — so there's nothing unsafe about auto-restoring here too.
  useEffect(() => {
    const lastUsedAddress = getLastUsedSystemAddress();
    if (lastUsedAddress === null) return;
    const system = listSavedSystems().map(normalizeSystem).find((s) => s.systemAddress === lastUsedAddress);
    if (!system || system.bodies.length === 0) return;
    applySystem(system);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

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
    setSavedAddresses(new Set(saved.map((s) => s.systemAddress)));
    const lastUsedAddress = getLastUsedSystemAddress();
    if (lastUsedAddress !== null && saved.some((s) => s.systemAddress === lastUsedAddress)) {
      setSelectedAddress(lastUsedAddress);
    }
    setApplied(true);
    setJustSaved(true);
  }, [refreshToken]);

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

              {systems.length > 0 && (
                <div className="row-grid" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label htmlFor="journal-system">System</label>
                    <select
                      id="journal-system"
                      value={selectedAddress ?? ""}
                      onChange={(e) => {
                        setSelectedAddress(Number(e.target.value));
                        setApplied(false);
                        setJustSaved(false);
                      }}
                    >
                      {systems.map((s) => (
                        <option key={s.systemAddress} value={s.systemAddress}>
                          {s.starSystem} ({s.bodies.length} bodies scanned)
                          {savedAddresses.has(s.systemAddress) ? " — saved" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {justSaved && (
                    <span style={{ color: "var(--success)" }}>
                      Saved — will still be here after a reload, no re-upload needed
                    </span>
                  )}
                  <button type="button" onClick={resetToGuess} disabled={!selected} style={{ marginLeft: "auto" }}>
                    Reset slots to guess
                  </button>
                </div>
              )}
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
                  <button type="button" onClick={apply}>
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
