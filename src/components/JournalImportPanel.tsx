import { type Dispatch, useEffect, useRef, useState } from "react";
import { ALL_SLOTS, type SlotKind } from "../data/buildings";
import { estimateBodySlots } from "../journal/eligibility";
import {
  compareBodyNames,
  computeSystemSlotTotals,
  parseJournalScans,
  type JournalBody,
  type JournalSystem,
} from "../journal/parser";
import { getLastUsedSystemAddress, listSavedSystems, saveSystem, setLastUsedSystemAddress } from "../persistence/journalSystems";
import type { PlannerAction } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

interface JournalImportPanelProps {
  dispatch: Dispatch<PlannerAction>;
  /** Bumped by App.tsx whenever SystemPortabilityBar's Save/Import writes a system into the shared
   * localStorage store — this panel loads its own `systems` list once at mount, so it otherwise
   * never notices a sibling component's write (e.g. importing a JSON file wouldn't update this
   * panel's slot-count table for that system without this). */
  refreshToken?: number;
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
      // the System facilities panel is the only place this gets edited, so a fresh journal parse
      // (which knows nothing about it) must not silently wipe it out.
      return priorBody?.presentFacilities
        ? { ...withSlots, presentFacilities: priorBody.presentFacilities }
        : withSlots;
    });
    // Same preservation for the saved primary station choice — a fresh journal parse never
    // carries one, so without this a re-upload would silently clear it.
    byAddress.set(system.systemAddress, {
      ...system,
      bodies,
      firstStationBuilding: prior?.firstStationBuilding ?? system.firstStationBuilding,
      firstStationBodyId: prior?.firstStationBodyId ?? system.firstStationBodyId,
    });
  }
  return Array.from(byAddress.values()).sort((a, b) => a.starSystem.localeCompare(b.starSystem));
}

export function JournalImportPanel({ dispatch, refreshToken }: JournalImportPanelProps) {
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
  const [collapsed, setCollapsed] = useState(false);

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
  // unlocks the System facilities, which starts locked/greyed until configured one way or another.
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
      },
    });
    setApplied(true);
    setSelectedAddress(system.systemAddress);
    saveSystem(system);
    setSavedAddresses((prev) => new Set(prev).add(system.systemAddress));
    setJustSaved(true);
    setLastUsedSystemAddress(system.systemAddress);
    setCollapsed(true);
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

  // On first load, silently re-apply whichever system was last used — if it has both bodies and a
  // saved primary station, the System facilities panel should already look "applied" (filled in,
  // Journal panel folded) without the user needing to click "Apply" again every session. A system
  // with no saved primary station yet is left alone (incomplete configuration, nothing useful to
  // auto-apply).
  useEffect(() => {
    const lastUsedAddress = getLastUsedSystemAddress();
    if (lastUsedAddress === null) return;
    const system = listSavedSystems().map(normalizeSystem).find((s) => s.systemAddress === lastUsedAddress);
    if (!system || system.bodies.length === 0 || !system.firstStationBuilding) return;
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
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">
          Import from journal
          {collapsed && applied && (
            <span className="panel-toggle-status">Applied to the System facilities and saved</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && (
        <>
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
          {error && <div className="status-banner">{error}</div>}

          {systems.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="row-grid">
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

              {selected && (
                <>
                  <table style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>Body</th>
                        {SLOT_KINDS.map((kind) => (
                          <th key={kind}>{ALL_SLOTS[kind]}</th>
                        ))}
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
                        Apply slots and body layout to System facilities
                      </button>
                      {applied && (
                        <span style={{ color: "var(--success)" }}>
                          Applied to the System facilities and saved
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
