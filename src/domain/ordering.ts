// Ported from ordering.py: computes a dependency- and construction-point-respecting build
// order for a bag of facilities plus an ordered list of ports.

import { ALL_BUILDINGS, isPort } from "../data/buildings";
import { type PlanResult, SystemState } from "./systemState";

function getTier(buildingName: string): 1 | 2 | 3 {
  const building = ALL_BUILDINGS[buildingName];
  if (building.T3points === "port" || building.T3points < 0) return 3;
  if (building.T2points === "port" || building.T2points < 0) return 2;
  return 1;
}

function findFirstIndex<T>(elts: T[], predicate: (e: T) => boolean): number | null {
  const idx = elts.findIndex(predicate);
  return idx === -1 ? null : idx;
}

function counterElements(facilities: Record<string, number>): string[] {
  const elements: string[] = [];
  for (const [name, nb] of Object.entries(facilities)) {
    for (let i = 0; i < nb; i++) elements.push(name);
  }
  return elements;
}

/**
 * facilities: building name -> count (non-port buildings only).
 * ports: ordered list of port building names to build, in the desired order (may contain repeats).
 * Returns the build order as a list of building names. Mutates `state` (an existing SystemState
 * to build on top of), but does not mutate the `facilities`/`ports` arguments.
 */
export function computeFeasibleOrder(
  state: SystemState,
  facilities: Record<string, number>,
  ports: string[],
  firstStation?: string | null,
  /** Building names to build as soon as they're individually affordable, jumping the normal
   * dependency-unlocker/port/tier precedence entirely (not just re-ordering within whichever list
   * they'd otherwise be found in) — see `domain/selfSufficiencyCombos.ts`'s
   * `computeForcedBuildingPriority`'s doc comment for why this exists: a checked self-sufficiency
   * goal should read as "first thing built," not merely "built a bit sooner than it otherwise
   * would've been." A port structurally being checked before ordinary facilities every iteration
   * (see the main loop below) would otherwise keep burying a priority FACILITY behind an unrelated,
   * merely-earlier-affordable port. Never overrides `state.canBuild`'s own feasibility gate, and
   * never skips a dependency a priority building itself needs (it's just one more candidate name
   * inside `dependencyUnlockers` too) — this can never make an otherwise-infeasible order feasible,
   * or reorder anything AROUND a priority building that isn't itself also priority. */
  priorityBuildings?: Set<string>,
): string[] {
  const result: string[] = [];
  if (firstStation) {
    state.addFirstStation(firstStation);
    result.push(firstStation);
  }

  let elements = counterElements(facilities);
  const remainingPorts = [...ports];

  const requiredDependencies = new Set<string>();
  for (const name of Object.keys(facilities)) {
    const deps = ALL_BUILDINGS[name].dependencies;
    if (deps.length > 0) requiredDependencies.add(JSON.stringify(deps));
  }

  let totalNbBuildings = elements.length + remainingPorts.length;
  const dependencyUnlockers: string[] = [];
  for (const depJson of requiredDependencies) {
    const dep = JSON.parse(depJson) as string[];
    const idx = findFirstIndex(elements, (name) => dep.includes(name));
    // Note: the original Python only treats a match at index > 0 as an unlocker (a
    // `if idx:` truthiness check that accidentally drops idx === 0); fixed here since it's
    // clearly unintentional — an unlocker at position 0 is still an unlocker.
    if (idx !== null) {
      dependencyUnlockers.push(elements[idx]);
      elements = [...elements.slice(0, idx), ...elements.slice(idx + 1)];
    }
  }

  const byTiers: Record<1 | 2, string[]> = { 1: [], 2: [] };
  for (const name of elements) {
    const tier = getTier(name);
    if (tier === 1 || tier === 2) byTiers[tier].push(name);
  }

  function insertBuilding(name: string): void {
    state.addBuilding(name, 1);
    result.push(name);
    totalNbBuildings -= 1;
  }

  function buildFirstFromList(buildingNames: string[]): boolean {
    const idx = findFirstIndex(buildingNames, (name) => state.canBuild(name));
    if (idx !== null) {
      insertBuilding(buildingNames[idx]);
      buildingNames.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Tries every remaining pool (dependency unlockers, ports, tier 1, tier 2 — this loop order
  // doesn't matter for feasibility, only for which priority candidate wins a same-iteration tie,
  // an edge case indistinguishable in outcome) for the first currently-buildable `priorityBuildings`
  // member, jumping the pool it's found in to the very front of this iteration — see
  // `priorityBuildings`'s own doc comment above for why this needs to bypass the normal
  // port-before-facility/tier structure, not just reorder within one list.
  function tryBuildPriority(): boolean {
    if (!priorityBuildings) return false;
    for (const pool of [dependencyUnlockers, remainingPorts, byTiers[1], byTiers[2]]) {
      const idx = findFirstIndex(pool, (name) => priorityBuildings.has(name) && state.canBuild(name));
      if (idx !== null) {
        insertBuilding(pool[idx]);
        pool.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  while (totalNbBuildings > 0) {
    if (tryBuildPriority()) continue;
    if (buildFirstFromList(dependencyUnlockers)) continue;

    let targetTier: 1 | 2;
    if (remainingPorts.length > 0) {
      // Search the WHOLE remaining-ports queue for anything currently buildable, not just the
      // head — the two escalating port-cost curves (Tier-2-cost: Coriolis/Asteroid_Base; Tier-3-
      // cost: Orbis_or_Ocellus/Dodecahedron/Planetary_Port) are tracked independently PER CLASS in
      // SystemState.constructionPoints, so building a different-class port earlier never perturbs
      // the other class's cost sequence, and same-class ports are cost-interchangeable regardless
      // of order. A real (but pre-existing, deferred) bug this fixes: with extreme demolition, the
      // old head-only check could throw "Could not finish ordering" even when the solver had
      // already confirmed a feasible solution exists, because a LATER port in the queue (e.g. a
      // Coriolis, which also grants a flat T3 point) was affordable and would have funded the
      // stuck head port, but was never even considered.
      if (buildFirstFromList(remainingPorts)) continue;
      targetTier = (getTier(remainingPorts[0]) - 1) as 1 | 2;
    } else {
      targetTier = 2;
    }
    if (buildFirstFromList(byTiers[targetTier])) continue;
    if (buildFirstFromList(byTiers[(3 - targetTier) as 1 | 2])) continue;
    throw new Error("Could not finish ordering");
  }

  return result;
}

interface AlreadyPresentParts {
  facilities: Record<string, number>;
  ports: string[];
  firstStation: string | null;
}

export function getAlreadyPresent(result: PlanResult): AlreadyPresentParts {
  let firstStation = result.first_station ?? null;
  if (firstStation && !(firstStation in ALL_BUILDINGS)) firstStation = null;
  const facilities = result.already_present ?? {};
  const ports: string[] = [];
  for (const [name, nb] of result["already_present.ports"] ?? []) {
    for (let i = 0; i < nb; i++) ports.push(name);
  }
  return { facilities, ports, firstStation };
}

export function getSolution(result: PlanResult): AlreadyPresentParts {
  const solution = result.solution ?? {};
  let firstStation = solution.first_station ?? null;
  if (firstStation && !(firstStation in ALL_BUILDINGS)) firstStation = null;
  const rawFacilities = solution.to_build ?? {};
  let ports = solution.port_order ?? [];
  if (ports.length === 0) {
    ports = [];
    for (const [name, nb] of Object.entries(rawFacilities)) {
      if (isPort(ALL_BUILDINGS[name])) {
        for (let i = 0; i < nb; i++) ports.push(name);
      }
    }
  }
  const facilities: Record<string, number> = {};
  for (const [name, nb] of Object.entries(rawFacilities)) {
    if (!isPort(ALL_BUILDINGS[name])) facilities[name] = nb;
  }
  return { facilities, ports, firstStation };
}

export function getOrderingFromResult(
  result: PlanResult,
  withSolution = true,
  withAlreadyPresent = true,
  /** Threaded straight through to every `computeFeasibleOrder` call here — see that function's own
   * `priorityBuildings` doc comment. */
  priorityBuildings?: Set<string>,
): string[] {
  const ordering: string[] = [];
  const state = new SystemState();
  if (withAlreadyPresent) {
    const { facilities, ports, firstStation } = getAlreadyPresent(result);
    ordering.push(...computeFeasibleOrder(state, facilities, ports, firstStation, priorityBuildings));
  } else {
    state.addResult(result);
  }

  if (withSolution) {
    const { facilities, ports, firstStation } = getSolution(result);
    ordering.push(...computeFeasibleOrder(state, facilities, ports, firstStation, priorityBuildings));
  }

  return ordering;
}

export function getMixedOrderingFromResult(result: PlanResult): string[] {
  const state = new SystemState();
  const ap = getAlreadyPresent(result);
  const sol = getSolution(result);
  const facilities: Record<string, number> = { ...ap.facilities };
  for (const [name, nb] of Object.entries(sol.facilities)) {
    facilities[name] = (facilities[name] ?? 0) + nb;
  }
  const ports = [...ap.ports, ...sol.ports];
  const firstStation = ap.firstStation || sol.firstStation;
  return computeFeasibleOrder(state, facilities, ports, firstStation);
}
