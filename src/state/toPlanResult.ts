import { ALL_BUILDINGS, isPort } from "../data/buildings";
import { derivePresentCounts } from "../domain/presentFacilities";
import type { PlanResult } from "../domain/systemState";
import type { SolverResult } from "../solver/solve";
import type { PlannerFormState } from "./plannerState";

/** Adapts the planner's already-present accounting + solver result into the PlanResult shape
 * ordering.ts expects — critically, splitting already-present PORT buildings into
 * "already_present.ports" (a list ordering.ts can sequence), since compute_feasible_order only
 * looks for tier-3 buildings inside the ports list, not the plain facilities dict.
 *
 * Already-present counts come from `formState.bodies`' per-slot facility tree when it's in use
 * (per-body placement mode), or the flat `formState.alreadyPresent` map otherwise (aggregate
 * mode) — mirrors solve.ts's own `alreadyPresent`-is-ignored-when-bodies-present rule. Anything
 * the solver actually demolished (`result.demolished`) is excluded — it's not "still there" for
 * build-order purposes once a fresh solve says otherwise. */
export function toPlanResult(formState: PlannerFormState, result: SolverResult | null): PlanResult {
  const hasBodies = formState.bodies.length > 0;
  // `excludePrimary`: the primary's own contribution is already handled separately below via
  // `first_station` (-> `SystemState.addFirstStation`'s own cost exemption) — including its synced
  // `presentFacilities` entry here too would double-count it as an ordinary already-present port
  // (see PresentFacilitySlot.primary's doc comment).
  const presentCounts = hasBodies
    ? derivePresentCounts(
        formState.bodies.map((b) => ({
          bodyId: b.bodyId,
          space: b.presentFacilities?.space ?? [],
          ground: b.presentFacilities?.ground ?? [],
        })),
        { excludePrimary: true },
      )
    : formState.alreadyPresent;
  const demolishedCounts: Record<string, number> = {};
  for (const d of result?.demolished ?? []) {
    demolishedCounts[d.building] = (demolishedCounts[d.building] ?? 0) + 1;
  }

  const alreadyPresentFacilities: Record<string, number> = {};
  const alreadyPresentPorts: [string, number][] = [];
  for (const [name, rawNb] of Object.entries(presentCounts)) {
    const nb = rawNb - (demolishedCounts[name] ?? 0);
    if (nb <= 0) continue;
    if (isPort(ALL_BUILDINGS[name])) {
      alreadyPresentPorts.push([name, nb]);
    } else {
      alreadyPresentFacilities[name] = nb;
    }
  }

  const firstStation = result?.firstStation ?? (formState.firstStationBuilding || undefined);

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
