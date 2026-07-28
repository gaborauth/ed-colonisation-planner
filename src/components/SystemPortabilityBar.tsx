import { type Dispatch, useEffect, useRef, useState } from "react";
import { deriveCurrentPoints, deriveSlotUsage, toSlotUsageBodies } from "../domain/presentFacilities";
import { computeSystemSlotTotals, type JournalSystem } from "../journal/parser";
import {
  deleteSystem,
  getLastUsedSystemAddress,
  listSavedSystems,
  saveSystem,
  setLastUsedSystemAddress,
} from "../persistence/journalSystems";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { SlotBar } from "./SlotBar";
import { TierIcon } from "./TierIcon";

interface SystemPortabilityBarProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
  /** Called after Save/Import/Delete write to (or remove from) the shared localStorage store, so
   * App.tsx can bump JournalImportPanel's refresh token — that panel keeps its own local copy of
   * the saved-systems list and otherwise never notices a sibling component's write. */
  onImported?: () => void;
  /** Called whenever "Import system"/"Live Demo"/the switcher/mount-time restore actually applies a
   * different system to `formState`, or "Delete" clears it back to blank — lets App.tsx clear its
   * stale solved result, which is keyed to the PREVIOUS system's bodies and would otherwise keep
   * showing through against the new (or now-empty) one (same fix as JournalImportPanel's own
   * `onSystemChanged`). Not fired by Save/Export, which don't change `formState` at all. */
  onSystemChanged?: () => void;
}

/** Minimal structural check, not a full schema validation — same risk tolerance as
 * persistence/journalSystems.ts's readStore(), which also trusts localStorage/import content
 * rather than validating it field-by-field. Catches the common mistake (wrong file, truncated
 * paste) without pretending to guarantee a well-formed JournalSystem. */
function looksLikeJournalSystem(value: unknown): value is JournalSystem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.starSystem === "string" && typeof v.systemAddress === "number" && Array.isArray(v.bodies);
}

/** Reconstructs the `JournalSystem` shape from form state — same fields the Save and Export
 * buttons below both need. */
function systemFromFormState(formState: PlannerFormState): JournalSystem | null {
  if (formState.systemAddress === null) return null;
  return {
    starSystem: formState.starSystem,
    systemAddress: formState.systemAddress,
    bodies: formState.bodies,
    firstStationBuilding: formState.firstStationBuilding || undefined,
    firstStationBodyId: formState.firstStationBodyId,
    firstStationVariant: formState.firstStationVariant,
    firstStationCustomName: formState.firstStationCustomName,
  };
}

/** Local-time "yyyymmdd-hhmm" stamp for the export filename, so re-exporting the same system later
 * doesn't silently overwrite an earlier download (browsers dedupe same-name downloads with a
 * "(1)" suffix, but a timestamp makes each export's recency obvious without opening it). */
function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Save/Export/Import for a single system's full configuration — raw journal scan data, per-body
 * slots, and manually-marked already-built facilities. "Save" persists it to the same store
 * JournalImportPanel writes to; living in this sticky top bar keeps it reachable without scrolling.
 * Export/Import serialize that same shape to/from a standalone JSON file, so an imported file slots
 * into the store and the
 * System facilities panel exactly like an applied journal upload does (see
 * JournalImportPanel.applySystem). All three act on whichever system is currently applied to the
 * System facilities panel (`formState`), not JournalImportPanel's own dropdown selection — those
 * can differ once a system's been applied and the panel folded. Rendered pinned to the viewport
 * top via `.sticky-toolbar` (index.css) so it stays reachable as the page scrolls. */
export function SystemPortabilityBar({ formState, dispatch, onImported, onSystemChanged }: SystemPortabilityBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Same precondition as the old SystemConfigPanel "Save" button: a per-body layout must have
  // been applied (from a journal import) before there's a `systemAddress` to key the saved-system
  // store by — aggregate-only ("enter slots manually") configurations have nothing to save/export.
  const canSaveOrExport = formState.systemAddress !== null && formState.bodies.length > 0;

  // Same summary SystemConfigPanel shows (built/free slots, current T2/T3 points) — reused here so
  // it's visible without scrolling. Only meaningful once a body layout is applied, same gate as
  // `canSaveOrExport` above.
  const slotUsageBodies = toSlotUsageBodies(formState.bodies);
  const slotUsage = deriveSlotUsage(slotUsageBodies, formState.slots);
  const points = deriveCurrentPoints(slotUsageBodies, formState.firstStationBuilding);

  // Every saved system regardless of source (Journal upload or Spansh) — read fresh on every
  // render rather than cached in state, so a save from a sibling panel (JournalImportPanel) is
  // reflected immediately without needing a refresh-token plumbing scheme like that panel's own.
  const savedSystems = listSavedSystems();

  // Switches directly to an already-saved system with no separate "Apply" step — unlike
  // JournalImportPanel's own dropdown (which picks among freshly-parsed-but-not-yet-reviewed
  // systems still needing a slot-count check before Apply), everything here is already fully
  // configured, so switching can just re-dispatch its saved shape immediately. Same dispatch shape
  // as loadParsedSystem below, minus re-saving (it's already in the store) and onImported (nothing
  // new was imported).
  function switchToSavedSystem(systemAddress: number): void {
    const system = savedSystems.find((s) => s.systemAddress === systemAddress);
    if (!system) return;
    setLastUsedSystemAddress(system.systemAddress);
    dispatch({
      type: "patch",
      patch: {
        slots: computeSystemSlotTotals(system),
        bodies: system.bodies,
        systemConfigured: true,
        systemAddress: system.systemAddress,
        starSystem: system.starSystem,
        firstStationBuilding: system.firstStationBuilding ?? "",
        firstStationBodyId: system.firstStationBodyId,
        firstStationVariant: system.firstStationVariant,
        firstStationCustomName: system.firstStationCustomName,
      },
    });
    onSystemChanged?.();
  }

  // On first load, silently re-apply whichever system was last used, as long as it has bodies —
  // "Actual facilities in the system" should already look "applied" without the user needing to
  // pick it again every session. Switching to / restoring a known system is exclusively this
  // toolbar's job (JournalImportPanel's own Journal-tab dropdown no longer browses already-saved
  // systems at all), so the mount-time restore belongs here too, reusing `switchToSavedSystem` above
  // rather than re-implementing the same dispatch/persistence shape a second time. Guarded on
  // `formState.systemAddress` rather than running unconditionally, so it never clobbers a system
  // that's already active by the time this mounts (e.g. in a future scenario where `formState`
  // starts pre-filled).
  useEffect(() => {
    if (formState.systemAddress !== null) return;
    const lastUsedAddress = getLastUsedSystemAddress();
    if (lastUsedAddress === null) return;
    const system = savedSystems.find((s) => s.systemAddress === lastUsedAddress);
    if (!system || system.bodies.length === 0) return;
    switchToSavedSystem(system.systemAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  function handleSave(): void {
    const system = systemFromFormState(formState);
    if (!system) return;
    saveSystem(system);
    onImported?.();
  }

  // Direct, unrecoverable localStorage removal, no undo — confirm first. Always targets the
  // currently-active system: the switcher below already keeps its own selection synced to
  // `formState.systemAddress` whenever `canSaveOrExport` is true, so there's no separate
  // "highlighted but not switched to" state to resolve here (unlike JournalImportPanel's new
  // pick-then-Load flow, which does need that distinction).
  function handleDelete(): void {
    if (formState.systemAddress === null) return;
    if (!window.confirm(`Delete the saved system "${formState.starSystem}"? This can't be undone.`)) return;
    deleteSystem(formState.systemAddress);
    // Bumps App.tsx's journalStoreVersion so JournalImportPanel's own refreshToken effect notices
    // the deletion too (see that effect's own comment — it drops the stale system once it's no
    // longer in listSavedSystems()).
    onImported?.();
    dispatch({ type: "reset" });
    onSystemChanged?.();
  }

  function handleExport(): void {
    const system = systemFromFormState(formState);
    if (!system) return;
    const blob = new Blob([JSON.stringify(system, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formState.starSystem || "system"}-${timestampForFilename(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Shared by file-based Import and the Live Demo button below — an imported/demo system should
  // behave exactly like applying a saved/uploaded one, not a separate code path (same wiring as
  // JournalImportPanel.applySystem).
  function loadParsedSystem(parsed: unknown): void {
    if (!looksLikeJournalSystem(parsed)) {
      setError("That file doesn't look like an exported system (missing starSystem/systemAddress/bodies).");
      return;
    }
    saveSystem(parsed);
    setLastUsedSystemAddress(parsed.systemAddress);
    dispatch({
      type: "patch",
      patch: {
        slots: computeSystemSlotTotals(parsed),
        bodies: parsed.bodies,
        systemConfigured: true,
        systemAddress: parsed.systemAddress,
        starSystem: parsed.starSystem,
        firstStationBuilding: parsed.firstStationBuilding ?? "",
        firstStationBodyId: parsed.firstStationBodyId,
        firstStationVariant: parsed.firstStationVariant,
        firstStationCustomName: parsed.firstStationCustomName,
      },
    });
    setError(null);
    onImported?.();
    onSystemChanged?.();
  }

  async function handleImportFile(file: File): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      loadParsedSystem(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Loads the same real exported system committed at jsons/swoilz-aw-c-d52.json that the test
  // suite uses (see CLAUDE.md's "Testing conventions") — dynamically imported so it's only fetched
  // when this button is actually clicked, not bundled into the main chunk.
  async function handleLiveDemo(): Promise<void> {
    try {
      const module = await import("../../jsons/swoilz-aw-c-d52.json");
      const parsed: unknown = module.default;
      loadParsedSystem(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="sticky-toolbar">
      <div className="row-grid">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSaveOrExport}
          title={!canSaveOrExport ? "Apply a system to Actual facilities in the system first" : undefined}
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={!canSaveOrExport}
          title={!canSaveOrExport ? "Apply a system to Actual facilities in the system first" : undefined}
        >
          Export system
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!canSaveOrExport}
          title={!canSaveOrExport ? "Apply a system to Actual facilities in the system first" : undefined}
        >
          Delete
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Import system
        </button>
        <button
          type="button"
          onClick={() => void handleLiveDemo()}
          title="Load a real exported system to try the planner without your own journal data"
        >
          Live Demo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Import system JSON"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
        {(canSaveOrExport || savedSystems.length > 0) && (
          <div className="toolbar-summary">
            {savedSystems.length > 1 || (savedSystems.length === 1 && !canSaveOrExport) ? (
              <select
                className="toolbar-summary-system"
                aria-label="Switch system"
                // No system is "current" yet on a fresh page load whose last-used system didn't
                // have a primary station saved (JournalImportPanel's mount-effect only auto-
                // restores when one was) — a blank/placeholder selection here still lets the user
                // pick a saved system to get going again, instead of the whole toolbar summary
                // (and this switcher along with it) simply staying gone until they re-import.
                value={canSaveOrExport ? (formState.systemAddress ?? "") : ""}
                onChange={(e) => {
                  if (e.target.value) switchToSavedSystem(Number(e.target.value));
                }}
              >
                {!canSaveOrExport && (
                  <option value="" disabled>
                    Pick a saved system…
                  </option>
                )}
                {savedSystems.map((s) => (
                  <option key={s.systemAddress} value={s.systemAddress}>
                    {s.starSystem}
                  </option>
                ))}
              </select>
            ) : (
              canSaveOrExport && <span className="toolbar-summary-system">{formState.starSystem}</span>
            )}
            {canSaveOrExport && (
              <>
                <span className="toolbar-summary-item">
                  <SlotBar built={slotUsage.space.built} total={slotUsage.space.total} />
                  Orbital {slotUsage.space.built}/{slotUsage.space.total}
                </span>
                <span className="toolbar-summary-item">
                  <SlotBar built={slotUsage.ground.built} total={slotUsage.ground.total} />
                  Ground {slotUsage.ground.built}/{slotUsage.ground.total}
                </span>
                <span className="toolbar-summary-item">
                  <TierIcon tier={2} />
                  {points.t2}
                </span>
                <span className="toolbar-summary-item">
                  <TierIcon tier={3} />
                  {points.t3}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {error && <div className="status-banner">{error}</div>}
    </div>
  );
}
