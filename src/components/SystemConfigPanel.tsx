import type { Dispatch } from "react";
import { ALL_CATEGORIES, toPrintable } from "../data/buildings";
import type { PlannerAction, PlannerFormState } from "../state/plannerState";
import { NumberInput } from "./NumberInput";

interface SystemConfigPanelProps {
  formState: PlannerFormState;
  dispatch: Dispatch<PlannerAction>;
}

const FIRST_STATION_TOGGLES = [
  { key: "allowCoriolis", name: "Coriolis" },
  { key: "allowAsteroidBase", name: "Asteroid_Base" },
  { key: "allowOrbisOrOcellus", name: "Orbis_or_Ocellus" },
  { key: "allowDodecahedron", name: "Dodecahedron" },
] as const;

export function SystemConfigPanel({ formState, dispatch }: SystemConfigPanelProps) {
  return (
    <section className="panel">
      <h2>System</h2>
      <div className="row-grid">
        <div className="field">
          <label htmlFor="slot-space">Orbital slots</label>
          <NumberInput
            id="slot-space"
            value={formState.slots.space}
            blankMeans="zero"
            onChange={(v) => dispatch({ type: "patch", patch: { slots: { ...formState.slots, space: v ?? 0 } } })}
          />
        </div>
        <div className="field">
          <label htmlFor="slot-ground">Ground slots</label>
          <NumberInput
            id="slot-ground"
            value={formState.slots.ground}
            blankMeans="zero"
            onChange={(v) => dispatch({ type: "patch", patch: { slots: { ...formState.slots, ground: v ?? 0 } } })}
          />
        </div>
        <div className="field">
          <label htmlFor="slot-asteroid">Asteroid slots</label>
          <NumberInput
            id="slot-asteroid"
            value={formState.slots.asteroid}
            blankMeans="zero"
            onChange={(v) =>
              dispatch({ type: "patch", patch: { slots: { ...formState.slots, asteroid: v ?? 0 } } })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="t2-points">Initial T2 points</label>
          <NumberInput
            id="t2-points"
            value={formState.initialT2Points}
            blankMeans="zero"
            allowNegative
            onChange={(v) => dispatch({ type: "patch", patch: { initialT2Points: v ?? 0 } })}
          />
        </div>
        <div className="field">
          <label htmlFor="t3-points">Initial T3 points</label>
          <NumberInput
            id="t3-points"
            value={formState.initialT3Points}
            blankMeans="zero"
            allowNegative
            onChange={(v) => dispatch({ type: "patch", patch: { initialT3Points: v ?? 0 } })}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={formState.allowCriminal}
              onChange={(e) => dispatch({ type: "patch", patch: { allowCriminal: e.target.checked } })}
            />{" "}
            Allow criminal buildings
          </label>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label>
          <input
            type="checkbox"
            checked={formState.chooseFirstStation}
            onChange={(e) => dispatch({ type: "patch", patch: { chooseFirstStation: e.target.checked } })}
          />{" "}
          Let the solver choose my first station
        </label>

        {formState.chooseFirstStation ? (
          <div className="row-grid" style={{ marginTop: 8 }}>
            {FIRST_STATION_TOGGLES.map(({ key, name }) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={formState.firstStationOptions[key]}
                  onChange={(e) =>
                    dispatch({
                      type: "patch",
                      patch: {
                        firstStationOptions: { ...formState.firstStationOptions, [key]: e.target.checked },
                      },
                    })
                  }
                />{" "}
                {toPrintable(name)}
              </label>
            ))}
          </div>
        ) : (
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="first-station-building">First station</label>
            <select
              id="first-station-building"
              value={formState.firstStationBuilding}
              onChange={(e) => dispatch({ type: "patch", patch: { firstStationBuilding: e.target.value } })}
            >
              <option value="">— select —</option>
              {ALL_CATEGORIES["First Station"].map((name) => (
                <option key={name} value={name}>
                  {toPrintable(name)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </section>
  );
}
