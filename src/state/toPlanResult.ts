import { ALL_BUILDINGS, isPort } from "../data/buildings";
import type { PlanResult } from "../domain/systemState";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "./plannerState";

/** Adapts the planner's flat alreadyPresent map + solver result into the PlanResult shape
 * ordering.ts expects — critically, splitting already-present PORT buildings into
 * "already_present.ports" (a list ordering.ts can sequence), since compute_feasible_order only
 * looks for tier-3 buildings inside the ports list, not the plain facilities dict. */
export function toPlanResult(formState: PlannerFormState, result: SolverResult | null): PlanResult {
  const alreadyPresentFacilities: Record<string, number> = {};
  const alreadyPresentPorts: [string, number][] = [];
  for (const [name, nb] of Object.entries(formState.alreadyPresent)) {
    if (nb <= 0) continue;
    if (isPort(ALL_BUILDINGS[name])) {
      alreadyPresentPorts.push([name, nb]);
    } else {
      alreadyPresentFacilities[name] = nb;
    }
  }

  const firstStation = formState.chooseFirstStation
    ? (result?.firstStation ?? undefined)
    : formState.firstStationBuilding || undefined;

  return {
    first_station: firstStation,
    already_present: alreadyPresentFacilities,
    "already_present.ports": alreadyPresentPorts,
    solution: result
      ? {
          to_build: result.toBuild,
          port_order: result.portOrder,
        }
      : undefined,
  };
}
