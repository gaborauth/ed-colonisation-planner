import { estimateIllustrativePopulationCurve } from "../domain/populationEstimate";
import type { SolverResult } from "../solver/solve";

interface PopulationEstimatePanelProps {
  result: SolverResult;
}

const DISPLAY_WEEKS = [0, 1, 2, 4, 8, 12];

export function PopulationEstimatePanel({ result }: PopulationEstimatePanelProps) {
  const curve = estimateIllustrativePopulationCurve(
    result.scores.initial_population_increase,
    result.scores.max_population_increase,
    12,
  );
  const byWeek = new Map(curve.map((c) => [c.week, c.estimatedPopulation]));

  return (
    <section className="panel">
      <h2>Population growth (illustrative)</h2>
      <div className="status-banner">
        <strong>Not a real prediction.</strong> No official population-growth formula has been
        published — this is a shaped curve (fast for the first month, then slowing, per the patch
        notes' own qualitative description) fitted only to the solver's own initial/max population
        scores. Treat it as a rough illustration of the growth <em>pattern</em>, never as a real
        number.
      </div>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            {DISPLAY_WEEKS.map((week) => (
              <th key={week}>Week {week}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {DISPLAY_WEEKS.map((week) => (
              <td key={week}>{byWeek.get(week)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
