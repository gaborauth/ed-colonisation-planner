import { ALL_SCORES, toPrintable } from "../data/buildings";
import type { SolverResult } from "../solver/solve";

interface ResultsPanelProps {
  result: SolverResult;
}

function valueClass(value: number): string {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

export function ResultsPanel({ result }: ResultsPanelProps) {
  return (
    <section className="hud-panel">
      <h2>Result</h2>
      <div className="stat-grid">
        {ALL_SCORES.map((score) => (
          <div className="stat-tile" key={score}>
            <span className="label">{toPrintable(score)}</span>
            {/* construction_cost is a magnitude, not a good/bad direction — no color coding. */}
            <span className={`value ${score === "construction_cost" ? "" : valueClass(result.scores[score])}`}>
              {result.scores[score]}
            </span>
          </div>
        ))}
        <div className="stat-tile">
          <span className="label">Orbital slots left</span>
          <span className="value">{result.slotsRemaining.space}</span>
        </div>
        <div className="stat-tile">
          <span className="label">Ground slots left</span>
          <span className="value">{result.slotsRemaining.ground}</span>
        </div>
        <div className="stat-tile">
          <span className="label">Asteroid slots left</span>
          <span className="value">{result.slotsRemaining.asteroid}</span>
        </div>
        <div className="stat-tile">
          <span className="label">T2 points left</span>
          <span className={`value ${valueClass(result.finalT2Points)}`}>{result.finalT2Points}</span>
        </div>
        <div className="stat-tile">
          <span className="label">T3 points left</span>
          <span className={`value ${valueClass(result.finalT3Points)}`}>{result.finalT3Points}</span>
        </div>
        {result.firstStation && (
          <div className="stat-tile">
            <span className="label">First station</span>
            <span className="value">{toPrintable(result.firstStation)}</span>
          </div>
        )}
        {result.objectiveValue !== null && (
          <div className="stat-tile">
            <span className="label">Objective value</span>
            <span className="value">{Math.round(result.objectiveValue * 1000) / 1000}</span>
          </div>
        )}
      </div>
    </section>
  );
}
