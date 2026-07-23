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

  private constructionPoints(building: Building, nb: number): [number, number] {
    const nbPorts = this.ports.length;
    let T2: number;
    if (building.T2points === "port") {
      T2 = 0;
      for (let i = 0; i < nb; i++) T2 -= getT2PortCost(nbPorts + i);
    } else {
      T2 = nb * building.T2points;
    }
    let T3: number;
    if (building.T3points === "port") {
      T3 = 0;
      for (let i = 0; i < nb; i++) T3 -= getT3PortCost(nbPorts + i);
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
