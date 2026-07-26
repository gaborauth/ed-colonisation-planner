// Ported from data.py's SystemState class.

import {
  ALL_BUILDINGS,
  ALL_DEPENDENCIES,
  ALL_SCORES,
  BASE_SCORES,
  COMPOUND_SCORES,
  type Building,
  type Score,
  type SlotKind,
  computeCompoundScore,
  getT2PortCost,
  getT3PortCost,
  isPort,
} from "../data/buildings";

function depKey(deps: string[]): string {
  return JSON.stringify(deps);
}

export interface PlanResult {
  first_station?: string;
  already_present?: Record<string, number>;
  "already_present.ports"?: [string, number][];
  solution?: {
    first_station?: string;
    to_build?: Record<string, number>;
    port_order?: string[];
  };
}

export class SystemState {
  T2points = 0;
  T3points = 0;
  scores: Record<Score, number> = Object.fromEntries(ALL_SCORES.map((s) => [s, 0])) as Record<Score, number>;
  facilities = new Map<string, number>();
  ports: string[] = [];
  slotsUsed: Record<SlotKind, number> = { space: 0, ground: 0, asteroid: 0 };
  firstStation: string | null = null;
  dependenciesLocked: Set<string> = new Set(ALL_DEPENDENCIES.map(depKey));

  constructor(startingPoint?: PlanResult) {
    if (startingPoint) {
      this.addResult(startingPoint);
    }
  }

  addResult(result: PlanResult): this {
    if (result.first_station && result.first_station in ALL_BUILDINGS) {
      this.addFirstStation(result.first_station);
    }
    for (const [name, nb] of Object.entries(result.already_present ?? {})) {
      this.addBuilding(name, nb);
    }
    for (const [name, nb] of result["already_present.ports"] ?? []) {
      this.addBuilding(name, nb);
    }
    // `already_present.ports` credits each already-standing port via the SAME escalating-cost
    // formula as a brand-new build (this.addBuilding -> constructionPoints), computed against a
    // deterministic STAND-IN build order (see presentFacilities.ts's computePresentPortsSeed doc
    // comment) since this app has no record of the true historical order/timing. With few or no
    // OTHER already-present facilities left to "explain" how those ports were actually affordable
    // (e.g. after heavy demolition removes them), that stand-in order can compute a NEGATIVE net
    // T2/T3 total here — but a real player's true current balance can never actually be negative
    // (the game would never have let construction proceed past 0). A negative result here is
    // purely a bookkeeping artifact of the stand-in order being pessimistic about unknown history,
    // not a real deficit, so floor it at 0 — this represents "at least what you visibly have,"
    // never a manufactured debt. Deliberately NOT applied inside `addBuilding` itself: that method
    // is also used for NEW construction going forward, where `canBuild`'s per-step non-negativity
    // gate must keep working exactly as before (see ordering.ts's computeFeasibleOrder) — only the
    // "seed my starting state from already-present/historical data" entry point gets this floor.
    // Real bug this fixes: `getOrderingFromResult`'s solution-side `computeFeasibleOrder` pass
    // (used by every real caller — see ordering.test.ts's dedicated regression test) could throw
    // "Could not finish ordering" under extreme demolition purely because this starting seed was
    // negative before a single new building was even attempted, with no amount of reordering able
    // to recover from a deficit that exists before the search loop starts.
    if (this.T2points < 0) this.T2points = 0;
    if (this.T3points < 0) this.T3points = 0;
    return this;
  }

  addSolution(result: PlanResult): this {
    const solution = result.solution ?? {};
    if (solution.first_station && solution.first_station in ALL_BUILDINGS) {
      this.addFirstStation(solution.first_station);
    }
    const portOrder = solution.port_order ?? [];
    for (const [name, nb] of Object.entries(solution.to_build ?? {})) {
      if (portOrder.length === 0 || !isPort(ALL_BUILDINGS[name])) {
        this.addBuilding(name, nb);
      }
    }
    for (const name of portOrder) {
      this.addBuilding(name, 1);
    }
    return this;
  }

  addFirstStation(buildingName: string): this {
    const building = ALL_BUILDINGS[buildingName];
    if (this.firstStation !== null) {
      throw new Error("first station already set");
    }
    if (building.T2points !== "port" && building.T2points > 0) {
      this.T2points += building.T2points;
    }
    if (building.T3points !== "port" && building.T3points > 0) {
      this.T3points += building.T3points;
    }
    this.updateScores(building, 1);
    this.updateDependencies(buildingName);
    this.firstStation = buildingName;
    return this;
  }

  addBuilding(buildingName: string, nb: number): this {
    const building = ALL_BUILDINGS[buildingName];
    const [T2, T3] = this.constructionPoints(building, nb);
    this.T2points += T2;
    this.T3points += T3;
    if (isPort(building)) {
      for (let i = 0; i < nb; i++) this.ports.push(buildingName);
    }
    this.facilities.set(buildingName, (this.facilities.get(buildingName) ?? 0) + nb);
    this.updateScores(building, nb);
    this.updateDependencies(buildingName);
    this.updateSlots(buildingName, building, nb);
    return this;
  }

  canBuild(buildingName: string): boolean {
    const building = ALL_BUILDINGS[buildingName];
    const [T2, T3] = this.constructionPoints(building, 1);
    if (T2 + this.T2points < 0 || T3 + this.T3points < 0) {
      return false;
    }
    if (building.dependencies.length === 0) {
      return true;
    }
    return !this.dependenciesLocked.has(depKey(building.dependencies));
  }

  /** The demolish-side counterpart to `canBuild`/`addBuilding` — deliberately minimal, unlike
   * `constructionPoints`'s escalating-port-cost handling, because ports are never demolishable in
   * this app (see CLAUDE.md's scope-boundary note): a flat, non-escalating T2/T3 subtraction is
   * always correct here. Used by `buildOrderTable.ts`'s scheduler to decide whether a pending
   * demolish is safe *right now* (never letting the running total go negative) versus needing to
   * be postponed until a Planned (rebuild) row has grown the balance back up — see that file's
   * `scheduleDemolishAndPlanned`. `removeBuilding` deliberately does NOT touch `scores`/
   * `slotsUsed`/`facilities` — matching what demolish rows have always tracked (T2/T3 only); not
   * a new gap introduced here. */
  canDemolish(buildingName: string): boolean {
    const building = ALL_BUILDINGS[buildingName];
    const t2 = typeof building.T2points === "number" ? building.T2points : 0;
    const t3 = typeof building.T3points === "number" ? building.T3points : 0;
    return this.T2points - t2 >= 0 && this.T3points - t3 >= 0;
  }

  removeBuilding(buildingName: string): this {
    const building = ALL_BUILDINGS[buildingName];
    const t2 = typeof building.T2points === "number" ? building.T2points : 0;
    const t3 = typeof building.T3points === "number" ? building.T3points : 0;
    this.T2points -= t2;
    this.T3points -= t3;
    return this;
  }

  /** Tier-2-cost ports (Coriolis, Asteroid_Base) and Tier-3-cost ports (Orbis_or_Ocellus,
   * Dodecahedron, Planetary_Port) each escalate along their OWN sequence, exactly like
   * `presentFacilities.ts`'s already-verified `computePresentPortsSeed` (t2Index/t3Index) — real-
   * game-confirmed there: a T2-cost port built before a T3-cost port doesn't push the T3-cost
   * port's price past its own first-of-type rate. An earlier version of this method used one
   * shared `this.ports.length` counter for both, which over-escalates whichever tier's port is
   * built after a port of the OTHER tier — real bug (not just an approximation mismatch), caught
   * via a real system with both an already-present Coriolis and Orbis_or_Ocellus: the shared
   * counter charged a subsequent new Dodecahedron as if it were the *4th* Tier-3-cost port
   * (getT3PortCost(3), counting the unrelated Coriolis too) instead of the actual 3rd
   * (getT3PortCost(2)), which was enough to make `computeFeasibleOrder` (ordering.ts) wrongly
   * throw "Could not finish ordering" for a plan solve.ts had already confirmed was T2/T3-feasible. */
  private constructionPoints(building: Building, nb: number): [number, number] {
    let T2: number;
    if (building.T2points === "port") {
      const nbT2Ports = this.ports.filter((name) => ALL_BUILDINGS[name].T2points === "port").length;
      T2 = 0;
      for (let i = 0; i < nb; i++) T2 -= getT2PortCost(nbT2Ports + i);
    } else {
      T2 = nb * building.T2points;
    }
    let T3: number;
    if (building.T3points === "port") {
      const nbT3Ports = this.ports.filter((name) => ALL_BUILDINGS[name].T3points === "port").length;
      T3 = 0;
      for (let i = 0; i < nb; i++) T3 -= getT3PortCost(nbT3Ports + i);
    } else {
      T3 = nb * building.T3points;
    }
    return [T2, T3];
  }

  private updateScores(building: Building, nb: number): void {
    for (const score of BASE_SCORES) {
      this.scores[score] += building[score] * nb;
    }
    for (const score of COMPOUND_SCORES) {
      this.scores[score] = computeCompoundScore(score, this.scores);
    }
  }

  private updateDependencies(buildingName: string): void {
    const newDeps = new Set<string>();
    for (const dep of this.dependenciesLocked) {
      if (!(JSON.parse(dep) as string[]).includes(buildingName)) {
        newDeps.add(dep);
      }
    }
    this.dependenciesLocked = newDeps;
  }

  private updateSlots(buildingName: string, building: Building, nb: number): void {
    this.slotsUsed[building.slot] += nb;
    if (buildingName === "Asteroid_Base") {
      this.slotsUsed.asteroid += nb;
    }
  }
}
