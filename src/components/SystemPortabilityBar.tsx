import { type Dispatch, useRef, useState } from "react";
import { computeSystemSlotTotals, type JournalSystem } from "../journal/parser";
import { saveSystem, setLastUsedSystemAddress } from "../persistence/journalSystems";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";

interface SystemPortabilityBarProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
  /** Called after Save/Import write a system into the shared localStorage store, so App.tsx can
   * bump JournalImportPanel's refresh token — that panel keeps its own local copy of the saved-
   * systems list (loaded once at mount) and otherwise never notices a sibling component's write. */
  onImported?: () => void;
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
  };
}

/** Save/Export/Import for a single system's full configuration — raw journal scan data, per-body
 * slots, and manually-marked already-built facilities. "Save" persists it to the same store
 * JournalImportPanel writes to (this used to be SystemConfigPanel's own "Save" button — moved
 * here so it's reachable from the sticky top bar without scrolling). Export/Import serialize that
 * same shape to/from a standalone JSON file, so an imported file slots into the store and the
 * System facilities panel exactly like an applied journal upload does (see
 * JournalImportPanel.applySystem). All three act on whichever system is currently applied to the
 * System facilities panel (`formState`), not JournalImportPanel's own dropdown selection — those
 * can differ once a system's been applied and the panel folded. Rendered pinned to the viewport
 * top via `.sticky-toolbar` (index.css) so it stays reachable as the page scrolls. */
export function SystemPortabilityBar({ formState, dispatch, onImported }: SystemPortabilityBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Same precondition as the old SystemConfigPanel "Save" button: a per-body layout must have
  // been applied (from a journal import) before there's a `systemAddress` to key the saved-system
  // store by — aggregate-only ("enter slots manually") configurations have nothing to save/export.
  const canSaveOrExport = formState.systemAddress !== null && formState.bodies.length > 0;

  function handleSave(): void {
    const system = systemFromFormState(formState);
    if (!system) return;
    saveSystem(system);
    onImported?.();
  }

  function handleExport(): void {
    const system = systemFromFormState(formState);
    if (!system) return;
    const blob = new Blob([JSON.stringify(system, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formState.starSystem || "system"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!looksLikeJournalSystem(parsed)) {
        setError("That file doesn't look like an exported system (missing starSystem/systemAddress/bodies).");
        return;
      }
      // Same store + form-state wiring as JournalImportPanel.applySystem — an imported system
      // should behave exactly like applying a saved/uploaded one, not a separate code path.
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
        },
      });
      setError(null);
      onImported?.();
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
          title={!canSaveOrExport ? "Apply a system to System facilities first" : undefined}
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={!canSaveOrExport}
          title={!canSaveOrExport ? "Apply a system to System facilities first" : undefined}
        >
          Export system
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Import system
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
      </div>
      {error && <div className="status-banner">{error}</div>}
    </div>
  );
}
