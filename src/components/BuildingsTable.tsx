import { useEffect, type Dispatch } from "react";
import { ALL_BUILDINGS, ALL_CATEGORIES, BASE_SCORES, toPrintable, type Building } from "../data/buildings";
import { derivePresentCounts } from "../domain/presentFacilities";
import { useScrollAnchoredCollapse } from "../hooks/useScrollAnchoredCollapse";
import { getStoredPanelCollapsed, setStoredPanelCollapsed } from "../persistence/panelCollapse";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import type { SolverResult } from "../solver/solve";
import { NumberInput } from "./NumberInput";
import { Tooltip } from "./Tooltip";

const PORTS_FACILITIES_PANEL_ID = "objective-ports-facilities";

// Column header says "Construction" — the umbrella term Frontier's own patch notes use ("All
// constructions are divided into two types... Ports and Supporting Facilities"), picked
// specifically because "Facilities" is already the OFFICIAL, narrower term for the non-port half of
// this table (see `isPortRole`/`PORT_ROLE_BUILDINGS` in data/buildings.ts) — calling the whole table
// (ports included) "Facilities" would misuse that term. The panel's own title instead names both
// halves explicitly ("Ports & Facilities numbers") rather than reusing the single umbrella term,
// sidestepping the same "Facilities" ambiguity concern since it isn't relying on "Facilities" alone
// to cover ports too. Deliberately UI-copy-only either way: `Building`/`ALL_BUILDINGS`/`data/buildings.ts`
// and every other internal identifier are untouched, including the `building` field name inside
// already-exported/saved JSON (`PresentFacilitySlot.building`, `firstStationBuilding`,
// `SolverResult.placements[].building`) — renaming those would break every already-saved plan and
// already-exported system JSON a real user has sitting in localStorage/on disk today.
interface BuildingsTableProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
  result: SolverResult | null;
}

// A display partition of all 54 buildings into non-overlapping groups (ALL_CATEGORIES entries
// overlap by design, since they're UI filters in the original tool, not a table grouping).
function buildDisplayGroups(): { label: string; names: string[] }[] {
  const starGroundPort = new Set(ALL_CATEGORIES["Star/Ground Port"]);
  const installation = new Set(ALL_CATEGORIES.Installation);
  const orbitalOutpost = ALL_CATEGORIES.Space.filter(
    (name) => !starGroundPort.has(name) && !installation.has(name),
  );
  return [
    { label: "Star / Ground Port", names: ALL_CATEGORIES["Star/Ground Port"] },
    { label: "Orbital Outpost", names: orbitalOutpost },
    { label: "Installation", names: ALL_CATEGORIES.Installation },
    { label: "Hub", names: ALL_CATEGORIES.Hub },
    { label: "Small Settlement", names: ALL_CATEGORIES["Small Settlement"] },
    { label: "Medium Settlement", names: ALL_CATEGORIES["Medium Settlement"] },
    { label: "Large Settlement", names: ALL_CATEGORIES["Large Settlement"] },
  ];
}

const DISPLAY_GROUPS = buildDisplayGroups();

// Shared across every category's own <table> below so their columns land at the same width no
// matter how long that category's own building names happen to be (e.g. "Large Industrial
// Settlement" vs. "Coriolis") — table-layout:auto (the default) sizes each <table> independently
// from its own content, which would otherwise let columns drift out of alignment from one category
// to the next. Paired with `.buildings-table`'s `table-layout: fixed` in index.css, which makes
// these percentages authoritative instead of advisory.
function BuildingTableColumns() {
  return (
    <colgroup>
      <col style={{ width: "34%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "12%" }} />
      <col style={{ width: "14%" }} />
    </colgroup>
  );
}

function contributionTooltip(building: Building, total: number) {
  const lines = BASE_SCORES.filter((score) => building[score] !== 0).map((score) => (
    <div key={score}>
      {toPrintable(score)}: {building[score] * total >= 0 ? "+" : ""}
      {building[score] * total}
    </div>
  ));
  if (lines.length === 0) return <div>No stat contribution</div>;
  return <>{lines}</>;
}

// Rendered as a nested sub-section of ObjectivePanel (alongside "Score constraints"/"Economy
// preferences"), not its own top-level panel — At least/At most really do reach the LP as
// constraints (see `setMapEntry`/`atMost` handling in plannerState.ts), the same kind of
// "bounds what the solver's free to pick" control those two sibling sections are. Folded by
// default, same as Economy preferences, and remembered across sessions the same way.
export function BuildingsTable({ formState, dispatch, result }: BuildingsTableProps) {
  const { collapsed, setCollapsed, buttonRef } = useScrollAnchoredCollapse<HTMLButtonElement>(
    getStoredPanelCollapsed(PORTS_FACILITIES_PANEL_ID) ?? true,
  );
  useEffect(() => {
    setStoredPanelCollapsed(PORTS_FACILITIES_PANEL_ID, collapsed);
  }, [collapsed]);
  // Once a body layout is applied, already-present counts come from the System facilities panel's
  // per-slot tree instead of this flat map (see solve.ts's alreadyPresent doc comment) — shown here
  // read-only so the two sources of truth can't drift apart.
  const hasBodies = formState.bodies.length > 0;
  const presentCounts = hasBodies
    ? derivePresentCounts(
        formState.bodies.map((b) => ({
          bodyId: b.bodyId,
          space: b.presentFacilities?.space ?? [],
          ground: b.presentFacilities?.ground ?? [],
        })),
      )
    : formState.alreadyPresent;

  return (
    <div style={{ marginTop: 14 }}>
      <button
        ref={buttonRef}
        type="button"
        className="panel-toggle panel-toggle-nested"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="panel-toggle-title">Ports & Facilities numbers</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed &&
        DISPLAY_GROUPS.map(({ label, names }) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <div className="category-heading">{label}</div>
            <table className="buildings-table">
              <BuildingTableColumns />
              <thead>
                <tr>
                  <th>Construction</th>
                  <th>Already present</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Built</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {names.map((name) => {
                  const building = ALL_BUILDINGS[name];
                  const built = result?.toBuild[name] ?? 0;
                  const total = (presentCounts[name] ?? 0) + built;
                  return (
                    <tr key={name}>
                      <td>{toPrintable(name)}</td>
                      <td>
                        {hasBodies ? (
                          presentCounts[name] ?? 0
                        ) : (
                          <NumberInput
                            ariaLabel={`${toPrintable(name)} already present`}
                            value={formState.alreadyPresent[name]}
                            onChange={(value) =>
                              dispatch({ type: "setMapEntry", map: "alreadyPresent", name, value })
                            }
                          />
                        )}
                      </td>
                      <td>
                        <NumberInput
                          ariaLabel={`Minimum ${toPrintable(name)}`}
                          value={formState.atLeast[name]}
                          onChange={(value) => dispatch({ type: "setMapEntry", map: "atLeast", name, value })}
                        />
                      </td>
                      <td>
                        <NumberInput
                          ariaLabel={`Maximum ${toPrintable(name)}`}
                          value={formState.atMost[name]}
                          onChange={(value) => dispatch({ type: "setMapEntry", map: "atMost", name, value })}
                        />
                      </td>
                      <td>{built > 0 ? built : ""}</td>
                      <td>
                        {total > 0 ? (
                          <Tooltip content={contributionTooltip(building, total)}>{total}</Tooltip>
                        ) : (
                          0
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
