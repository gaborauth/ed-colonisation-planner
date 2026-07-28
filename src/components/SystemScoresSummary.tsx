// The "Result" panel's content, moved into "Actual facilities in the system" (current, not-yet-
// solved totals) and "Solved system" (a completed solve's totals) at the user's request
// (2026-07-26: "I want to see the actual sum of values of the system... same style as the Orbital
// slots" — a `.field`/`.row-grid` layout, not the old standalone panel's `.stat-tile` grid). One
// shared component so both call sites render identically; they differ only in which scores/extra
// numbers they pass in.

import { ALL_SCORES, toPrintable, type Score } from "../data/buildings";

export interface SystemScoresSummaryField {
  label: string;
  value: number | string;
  /** Skip the auto positive/negative (green/red) coloring — for a magnitude/count where "high"
   * isn't inherently good or bad (a slot count, construction cost). */
  neutral?: boolean;
}

interface SystemScoresSummaryProps {
  scores: Record<Score, number>;
  /** `economy_synergy` is a placement-preference signal that only exists for a solve — see
   * `domain/currentSystemScores.ts`'s header comment. `SolvedSystemPanel` shows it (default);
   * `SystemConfigPanel`'s current-totals view passes `false`. */
  includeEconomySynergy?: boolean;
  /** Non-score numbers shown after the score fields, in order — slots remaining, T2/T3 points,
   * first station, objective value, etc.; each caller decides which apply. */
  extraFields?: SystemScoresSummaryField[];
  /** Wraps the block in a highlighted card (2026-07-28 user request) — only `SolvedSystemPanel`
   * opts in, since a solved plan's own totals are the actual payoff of running the solver, unlike
   * `SystemConfigPanel`'s pre-solve "current totals" view, which stays plain so the emphasis still
   * differentiates something instead of making every stat block look the same. */
  emphasized?: boolean;
}

function valueClass(value: number | string, neutral: boolean | undefined): string {
  if (neutral || typeof value !== "number") return "";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

export function SystemScoresSummary({
  scores,
  includeEconomySynergy = true,
  extraFields = [],
  emphasized = false,
}: SystemScoresSummaryProps) {
  const visibleScores = includeEconomySynergy ? ALL_SCORES : ALL_SCORES.filter((score) => score !== "economy_synergy");
  const grid = (
    <div className="row-grid" style={{ marginTop: 14 }}>
      {visibleScores.map((score) => (
        <div className="field" key={score}>
          <label>{toPrintable(score)}</label>
          {/* construction_cost is a magnitude, not a good/bad direction — no color coding. */}
          <div className={`field-value ${valueClass(scores[score], score === "construction_cost")}`}>{scores[score]}</div>
        </div>
      ))}
      {extraFields.map((f) => (
        <div className="field" key={f.label}>
          <label>{f.label}</label>
          <div className={`field-value ${valueClass(f.value, f.neutral)}`}>{f.value}</div>
        </div>
      ))}
    </div>
  );
  return emphasized ? <div className="system-scores-emphasized">{grid}</div> : grid;
}
