import { useMemo } from "react";
import { ALL_SCORES, toPrintable } from "../data/buildings";
import { computeBuildOrderTable, type BuildOrderRow, type BuildOrderRowState } from "../domain/buildOrderTable";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";

interface BuildOrderPanelProps {
  formState: PlannerFormState;
  result: SolverResult;
}

const STATE_LABELS: Record<BuildOrderRowState, string> = { built: "Built", demolish: "Demolish", planned: "Planned" };
const STATE_CLASSES: Record<BuildOrderRowState, string> = {
  built: "build-order-state-built",
  demolish: "build-order-state-demolish",
  planned: "build-order-state-planned",
};
const ROW_CLASSES: Record<BuildOrderRowState, string> = {
  built: "build-order-row-built",
  demolish: "build-order-row-demolish",
  planned: "build-order-row-planned",
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function PointDeltas({ row }: { row: BuildOrderRow }) {
  if (row.pointDeltas.length === 0) return <span className="build-order-points-empty">—</span>;
  return (
    <>
      {row.pointDeltas.map((d) => (
        <div key={d.score}>
          {toPrintable(d.score)}: {signed(d.delta)}
        </div>
      ))}
    </>
  );
}

function FacilityCell({ row }: { row: BuildOrderRow }) {
  const meta = [row.variant, row.nickname].filter((v): v is string => Boolean(v)).join(" — ");
  return (
    <>
      <div className="build-order-facility-name">{toPrintable(row.building)}</div>
      {meta && <div className="build-order-facility-meta">{meta}</div>}
    </>
  );
}

/** Full per-row build-order ledger — see `domain/buildOrderTable.ts`'s header comment for how the
 * Built/Demolish/Planned rows and their T2/T3 running totals are computed (deliberately via
 * `ordering.ts`'s per-tier-correct, never-negative-guaranteeing math, not `solve.ts`'s own more
 * conservative new-port formula). Every physical facility instance (already built, marked for
 * demolition, or newly planned) gets one numbered row, colored by state; the primary/claim
 * station's own row is additionally marked with `.primary-badge`'s own ★ (the same marker
 * `SystemConfigPanel.tsx` uses for the primary elsewhere) and a distinct background, since it's
 * always the very first row but otherwise easy to miss. The Total row's T2/T3 Σ mirrors the last
 * row's own running total directly rather than `result.finalT2Points`/`finalT3Points` (the
 * solver's own separate, more conservative estimate); the score columns still come from
 * `result.scores` (weighted with the first-station bonus/subsequent-facility reduction/economy
 * synergy — not something this table's own row-by-row replay reproduces). `SolvedSystemPanel.tsx`'s
 * own "T2/T3 points left" summary reuses this SAME `computeBuildOrderTable` call (not
 * `result.finalT2Points`/`finalT3Points` directly, and not a second independent re-derivation) so
 * the two panels can never show two disagreeing "final" T2/T3 numbers to the player — a real,
 * player-reported point of confusion (2026-08-10) before this fix, since every OTHER number on the
 * page is a real in-game figure and the solver's own conservative one looked like it should be too. */
export function BuildOrderPanel({ formState, result }: BuildOrderPanelProps) {
  const { rows, error } = useMemo(() => computeBuildOrderTable(formState, result), [formState, result]);
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;

  return (
    <section className="panel">
      <h2>Build order</h2>
      {error && <div className="status-banner">Could not compute a build order: {error}</div>}
      {!error && rows.length === 0 && <p>Nothing to build.</p>}
      {!error && rows.length > 0 && (
        <>
          <div className="build-order-table-wrap">
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>Nr.</th>
                  <th rowSpan={2}>State</th>
                  <th rowSpan={2}>Body</th>
                  <th rowSpan={2}>Slot</th>
                  <th rowSpan={2}>Facility</th>
                  <th rowSpan={2}>Generated points</th>
                  <th className="build-order-group-header" colSpan={2}>
                    Δ
                  </th>
                  <th className="build-order-group-header" colSpan={2}>
                    Σ
                  </th>
                </tr>
                <tr>
                  <th>T2</th>
                  <th>T3</th>
                  <th>T2</th>
                  <th>T3</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.nr}
                    className={row.isPrimary ? `${ROW_CLASSES[row.state]} build-order-row-primary` : ROW_CLASSES[row.state]}
                  >
                    <td>
                      {row.nr}
                      {row.isPrimary && (
                        <span className="primary-badge" aria-hidden="true" title="Primary/claim station">
                          {" "}
                          ★
                        </span>
                      )}
                    </td>
                    <td className={STATE_CLASSES[row.state]}>{STATE_LABELS[row.state]}</td>
                    <td>{row.bodyName ?? "—"}</td>
                    <td>{row.slotLabel ?? "—"}</td>
                    <td>
                      <FacilityCell row={row} />
                    </td>
                    <td className="build-order-points">
                      <PointDeltas row={row} />
                    </td>
                    <td>{signed(row.t2Delta)}</td>
                    <td>{signed(row.t3Delta)}</td>
                    <td>{row.t2Total}</td>
                    <td>{row.t3Total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="build-order-total-row">
                  <td colSpan={5}>Total</td>
                  <td className="build-order-points">
                    {ALL_SCORES.filter((score) => score !== "construction_cost" && result.scores[score] !== 0).map((score) => (
                      <div key={score}>
                        {toPrintable(score)}: {result.scores[score]}
                      </div>
                    ))}
                  </td>
                  <td />
                  <td />
                  <td>{lastRow?.t2Total ?? 0}</td>
                  <td>{lastRow?.t3Total ?? 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="panel-hint">
            The Total row's T2/T3 Σ mirrors the last row above it. The other Total figures come from the solver's own
            final scores (including the first-station bonus, subsequent-facility reduction, and economy synergy) — not
            a plain sum of the "Generated points" column, which shows each row's raw, unweighted contribution.
          </p>
        </>
      )}
    </section>
  );
}
