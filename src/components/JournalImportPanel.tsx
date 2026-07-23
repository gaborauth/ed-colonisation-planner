import { type Dispatch, useState } from "react";
import { estimateSlots, type SlotEstimate } from "../journal/eligibility";
import { parseJournalScans, type JournalSystem } from "../journal/parser";
import type { PlannerAction } from "../state/plannerState";

interface JournalImportPanelProps {
  dispatch: Dispatch<PlannerAction>;
}

export function JournalImportPanel({ dispatch }: JournalImportPanelProps) {
  const [systems, setSystems] = useState<JournalSystem[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function handleFile(file: File): Promise<void> {
    setApplied(false);
    try {
      const text = await file.text();
      const parsed = parseJournalScans(text);
      if (parsed.length === 0) {
        setError("No scanned systems found in that file.");
        setSystems([]);
        return;
      }
      setSystems(parsed);
      setSelectedAddress(parsed[0].systemAddress);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selected = systems.find((s) => s.systemAddress === selectedAddress) ?? null;
  const estimate: SlotEstimate | null = selected ? estimateSlots(selected) : null;

  function apply(): void {
    if (!estimate) return;
    dispatch({
      type: "patch",
      patch: { slots: { space: estimate.space, ground: estimate.ground, asteroid: estimate.asteroid } },
    });
    setApplied(true);
  }

  return (
    <section className="panel">
      <h2>Import from journal</h2>
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 0 }}>
        Best-effort slot estimate from scanned system data (<code>Scan</code> events in a Journal
        file) — <strong>unverified</strong>, no confirmed formula exists for how body data maps to
        slot counts. Compare it against your in-game System Map and adjust the System panel's slot
        fields directly if it's off.
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
          <div className="field">
            <label htmlFor="journal-system">System</label>
            <select
              id="journal-system"
              value={selectedAddress ?? ""}
              onChange={(e) => {
                setSelectedAddress(Number(e.target.value));
                setApplied(false);
              }}
            >
              {systems.map((s) => (
                <option key={s.systemAddress} value={s.systemAddress}>
                  {s.starSystem} ({s.bodies.length} bodies scanned)
                </option>
              ))}
            </select>
          </div>

          {estimate && (
            <>
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Body</th>
                    <th>Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.breakdown.map((b) => (
                    <tr key={b.bodyName}>
                      <td>{b.bodyName}</td>
                      <td>{b.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row-grid" style={{ marginTop: 10 }}>
                <span>
                  Estimated: {estimate.space} orbital / {estimate.ground} ground / {estimate.asteroid}{" "}
                  asteroid
                </span>
                <button type="button" onClick={apply}>
                  Apply estimated slots
                </button>
                {applied && <span style={{ color: "var(--success)" }}>Applied to the System panel</span>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
