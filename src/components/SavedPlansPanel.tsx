import { useEffect, useRef, useState } from "react";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import {
  deletePlan,
  exportPlanToJSON,
  importPlanFromJSON,
  listPlans,
  savePlan,
  type SavedPlan,
} from "../persistence/plans";
import type { PlannerFormState } from "../state/plannerState";
import type { SolverResult } from "../solver/solve";

interface SavedPlansPanelProps {
  systemName: string;
  planName: string;
  onSystemNameChange: (value: string) => void;
  onPlanNameChange: (value: string) => void;
  formState: PlannerFormState;
  result: SolverResult | null;
  onLoad: (plan: SavedPlan) => void;
}

export function SavedPlansPanel({
  systemName,
  planName,
  onSystemNameChange,
  onPlanNameChange,
  formState,
  result,
  onLoad,
}: SavedPlansPanelProps) {
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Folded by default, same as BuildingsTable — saving/loading/importing/exporting plans is a
  // bookkeeping tool for later in a session, not needed for a first solve. Still genuinely
  // click-to-expand (no chevron, `panel-toggle-flat` styling — see index.css's comment there): this
  // panel is the only UI path to save/load/import/export a plan, so a fully non-interactive
  // "permanently collapsed" version would have removed that entirely.
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(true);

  useEffect(() => {
    setPlans(listPlans());
  }, []);

  function refresh(): void {
    setPlans(listPlans());
  }

  function handleSave(): void {
    if (!systemName || !planName) return;
    savePlan(systemName, planName, formState, result);
    refresh();
  }

  function handleDelete(plan: SavedPlan): void {
    deletePlan(plan.systemName, plan.planName);
    refresh();
  }

  function handleExport(plan: SavedPlan): void {
    const blob = new Blob([exportPlanToJSON(plan)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${plan.systemName}-${plan.planName}.edcp.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const plan = importPlanFromJSON(text);
      savePlan(plan.systemName, plan.planName, plan.formState, plan.result);
      setImportError(null);
      refresh();
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  return (
    <section className="panel">
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle panel-toggle-muted panel-toggle-flat"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">Saved plans</span>
      </button>
      {!collapsed && (
        <>
          <div className="row-grid">
            <div className="field">
              <label htmlFor="system-name">System</label>
              <input id="system-name" value={systemName} onChange={(e) => onSystemNameChange(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="plan-name">Plan</label>
              <input id="plan-name" value={planName} onChange={(e) => onPlanNameChange(e.target.value)} />
            </div>
            <button type="button" onClick={handleSave} disabled={!systemName || !planName}>
              Save
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
          </div>
          {importError && <div className="status-banner">{importError}</div>}

          {plans.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>System</th>
                  <th>Plan</th>
                  <th>Saved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={`${plan.systemName}/${plan.planName}`}>
                    <td>{plan.systemName}</td>
                    <td>{plan.planName}</td>
                    <td>{new Date(plan.savedAt).toLocaleString()}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => onLoad(plan)}>
                        Load
                      </button>
                      <button type="button" onClick={() => handleExport(plan)}>
                        Export
                      </button>
                      <button type="button" onClick={() => handleDelete(plan)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
