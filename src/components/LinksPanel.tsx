import { useMemo } from "react";
import { toPrintable } from "../data/buildings";
import type { PortSummary } from "../domain/links";
import { computeSolvedSystemLinks } from "../domain/solvedLinks";
import { computePortServices } from "../domain/stationServices";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "../state/plannerState";

interface LinksPanelProps {
  formState: PlannerFormState;
  result: SolverResult;
}

function bodyName(formState: PlannerFormState, bodyId: number): string {
  return formState.bodies.find((b) => b.bodyId === bodyId)?.bodyName ?? `Body ${bodyId}`;
}

export function LinksPanel({ formState, result }: LinksPanelProps) {
  const linksResult = useMemo(() => {
    if (formState.bodies.length === 0) return null;
    return computeSolvedSystemLinks(formState.bodies, result);
  }, [formState.bodies, result]);

  const systemBuildingNames = useMemo(() => new Set(result.placements.map((p) => p.building)), [result.placements]);

  return (
    <section className="panel">
      <h2>Links &amp; economy (Update 3)</h2>
      {formState.bodies.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Import a journal and click "Apply slots and body layout to Actual facilities in the system" to see per-body
          links, economy types, and station services here — this needs a per-body layout, not just
          aggregate slot counts.
        </p>
      )}
      {linksResult && (
        <>
          {linksResult.warnings.length > 0 && (
            // Informational, not a failure — the solve itself succeeded; these just call out
            // facilities that can't strong-link locally (no port on their body). Deliberately not
            // styled like the red infeasible/error banners elsewhere on the page.
            <div className="status-banner hint">
              {linksResult.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
          {linksResult.ports.length === 0 && formState.bodies.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
              Solve first — this fills in once the solver has placed buildings on your bodies.
            </p>
          )}
          {Array.from(new Set(linksResult.ports.map((p) => p.bodyId))).map((bodyId) => {
            const portsHere = linksResult.ports.filter((p) => p.bodyId === bodyId);
            const dominantPorts = portsHere.filter((p) => p.isDominantOnBody);
            return (
              <div key={bodyId} style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: 13 }}>{bodyName(formState, bodyId)}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Port</th>
                      <th>Tier</th>
                      <th>Dominant</th>
                      <th>Economies</th>
                      <th>Services</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portsHere.map((port: PortSummary) => {
                      const stronglyLinked = linksResult.strongLinks
                        .filter((l) => l.toPortBuilding === port.building && l.bodyId === port.bodyId)
                        .map((l) => l.fromBuilding);
                      const services = computePortServices(
                        port,
                        stronglyLinked,
                        systemBuildingNames,
                        result.scores.tech_level,
                      );
                      return (
                        <tr key={port.building}>
                          <td>{toPrintable(port.building)}</td>
                          <td>{port.tier}</td>
                          <td>{port.isDominantOnBody ? "Yes" : "No"}</td>
                          <td title={port.appliedOverrideRules.join("; ") || "Default Colony economy"}>
                            {port.economies.length > 0 ? port.economies.join(", ") : "Colony (default)"}
                          </td>
                          <td>
                            {services.available.join(", ") || "—"}
                            {services.missingForTechGate.length > 0 && (
                              <span style={{ color: "var(--text-dim)" }}>
                                {" "}
                                (blocked by system tech level: {services.missingForTechGate.join(", ")})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {dominantPorts.some((p) => p.unevaluatedOverrideRules.length > 0) && (
                  <p style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {dominantPorts
                      .flatMap((p) => p.unevaluatedOverrideRules)
                      .filter((r, i, arr) => arr.indexOf(r) === i)
                      .join(" ")}
                  </p>
                )}
                <ul style={{ fontSize: 12 }}>
                  {linksResult.strongLinks
                    .filter((l) => l.bodyId === bodyId)
                    .map((l, i) => (
                      <li key={i}>
                        Strong link: {toPrintable(l.fromBuilding)} → {toPrintable(l.toPortBuilding)}
                        {l.boostedEconomies.length > 0 && ` (boosted: ${l.boostedEconomies.join(", ")})`}
                        {l.decreasedEconomies.length > 0 && ` (decreased: ${l.decreasedEconomies.join(", ")})`}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
          {linksResult.weakLinks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 13 }}>Weak links (cross-body)</h3>
              <ul style={{ fontSize: 12 }}>
                {linksResult.weakLinks.map((l, i) => (
                  <li key={i}>
                    {bodyName(formState, l.fromBodyId)} ({toPrintable(l.fromBuilding)}) → {bodyName(formState, l.toPortBodyId)} (
                    {toPrintable(l.toPortBuilding)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
