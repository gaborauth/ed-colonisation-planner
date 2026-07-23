// Ported from solver.py's Solver.setup()/get_result(). Builds the same MILP structure (building
// counts, escalating-cost sequential port slots, dependency unlocking, first-station choice,
// slot capacity, min/max constraints) but targets HiGHS via LP-format text instead of SCIP,
// since this now runs client-side in the browser via WASM instead of a desktop Python process.
//
// Deviations from the original Python, made deliberately while porting (not left as silent bugs):
//  - Dependency constraints used SCIP's native indicator constraints; HiGHS's LP-text interface
//    has no equivalent, so they're reformulated as big-M constraints here (see DEPENDENCY_BIG_M).
//    The underlying trick (indicator vars the solver may freely leave at 0, only forced to 1 —
//    and thus obligated to actually satisfy the guarded constraint — when beneficial to the
//    objective) is preserved exactly, just expressed with a big-M pair instead of a native
//    indicator constraint.
//  - The original's first-station T2/T3 point bonus only wired up whichever building happened to
//    be last in a Python dict-iteration order (effectively always "Military_Outpost", a loop-
//    variable leak bug), instead of applying each candidate's own bonus. Fixed here to match what
//    SystemState.addFirstStation already does correctly elsewhere in the same original codebase.
//  - Custom objective expressions no longer go through eval() (flagged in the original source as
//    a security risk); see objective.ts for the safe parser + LP-linearization replacement.

import {
  ALL_BUILDINGS,
  ALL_CATEGORIES,
  ALL_SCORES,
  type Score,
  computeCompoundScore,
  getT2PortCost,
  getT3PortCost,
  isPort,
} from "../data/buildings";
import { addExpr, exprConst, exprVar, type LPExpr, scaleExpr, subExpr } from "./lpExpr";
import { boundExpr, evalExprAt, INFINITY, LPModel } from "./lpModel";
import { compileObjective, type Direction, type ScoreBounds } from "./objective";
import type { ScoreLetter } from "./expressionParser";

export type { Direction } from "./objective";

const DEPENDENCY_BIG_M = 1000;
const DEFAULT_BUILDING_COUNT_CAP = 300;
const DEFAULT_MAX_NEW_PORTS = 20;

// UNVERIFIED, best-known figures — no official source with exact current numbers was locatable
// (forums/official docs block automated fetching). Confirmed mechanic: only the claim/first
// station contributes its full stat weight to these five system scores; every other facility
// (already-present or newly built) contributes at a reduced weight. Values below are the
// originally-reported reductions, except wealth, where one report mentioned a later correction
// from -70% to -25% that's reflected here. Retune these against your own game experience if
// they're off — they're the only place this mechanic's numbers live.
// Population increase and construction cost are not known to be affected and stay full-weight.
const SUBSEQUENT_FACILITY_WEIGHT: Partial<Record<Score, number>> = {
  development_level: 0.4, // -60%
  security: 0.8, // -20%
  standard_of_living: 0.48, // -52%
  tech_level: 0.34, // -66%
  wealth: 0.75, // -25% (corrected down from an initially-reported -70%)
};

export interface SlotAvailability {
  space: number;
  ground: number;
  asteroid: number;
}

export interface FirstStationOptions {
  allowCoriolis: boolean;
  allowAsteroidBase: boolean;
  allowOrbisOrOcellus: boolean;
  allowDodecahedron: boolean;
}

export type ObjectiveInput =
  | { kind: "simple"; score: Score }
  | { kind: "custom"; expression: string; direction: Direction };

export interface SolverInput {
  slots: SlotAvailability;
  objective: ObjectiveInput;
  initialT2Points: number;
  initialT3Points: number;
  chooseFirstStation: boolean;
  /** Required when chooseFirstStation is false. */
  firstStationBuilding?: string;
  /** Used when chooseFirstStation is true; defaults to allowing all three. */
  firstStationOptions?: FirstStationOptions;
  allowCriminal: boolean;
  /** Building name -> count already present, excluding whatever was picked as the first station. */
  alreadyPresent: Record<string, number>;
  constraints?: { atLeast?: Record<string, number>; atMost?: Record<string, number> };
  scoreConstraints?: { min?: Partial<Record<Score, number>>; max?: Partial<Record<Score, number>> };
}

export interface SolverResult {
  status: "optimal" | "infeasible" | "error";
  message?: string;
  toBuild: Record<string, number>;
  portOrder: string[];
  firstStation: string | null;
  scores: Record<Score, number>;
  finalT2Points: number;
  finalT3Points: number;
  slotsRemaining: SlotAvailability;
  objectiveValue: number | null;
}

const SCORE_LETTER_TO_SCORE: Record<ScoreLetter, Score> = {
  i: "initial_population_increase",
  m: "max_population_increase",
  e: "security",
  t: "tech_level",
  w: "wealth",
  n: "standard_of_living",
  d: "development_level",
  c: "construction_cost",
};

function errorResult(message: string): SolverResult {
  return {
    status: "error",
    message,
    toBuild: {},
    portOrder: [],
    firstStation: null,
    scores: Object.fromEntries(ALL_SCORES.map((s) => [s, 0])) as Record<Score, number>,
    finalT2Points: 0,
    finalT3Points: 0,
    slotsRemaining: { space: 0, ground: 0, asteroid: 0 },
    objectiveValue: null,
  };
}

export async function solve(input: SolverInput): Promise<SolverResult> {
  if (!input.chooseFirstStation && !(input.firstStationBuilding && input.firstStationBuilding in ALL_BUILDINGS)) {
    return errorResult("Error: pick your first station");
  }

  const nbPortsAlreadyPresent = Object.entries(input.alreadyPresent)
    .filter(([name]) => isPort(ALL_BUILDINGS[name]))
    .reduce((sum, [, nb]) => sum + nb, 0);
  const maxNbPorts = DEFAULT_MAX_NEW_PORTS + nbPortsAlreadyPresent;

  const model = new LPModel();

  // --- Decision variables --------------------------------------------------------------
  const allVars: Record<string, LPExpr> = {}; // newly-built count, per building
  const portVars: Record<string, string[]> = {}; // port name -> [slot var names], length maxNbPorts
  const firstStationVars: Record<string, string> = {}; // First-Station category name -> binary var name

  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    if (!isPort(building)) {
      const v = model.addVar(name, "integer", 0, DEFAULT_BUILDING_COUNT_CAP);
      allVars[name] = exprVar(v, 1);
    } else {
      const slots: string[] = [];
      for (let k = 0; k < maxNbPorts; k++) {
        slots.push(model.addVar(`${name}__port_${k}`, "binary"));
      }
      portVars[name] = slots;
      allVars[name] = slots.reduce((acc, v) => addExpr(acc, exprVar(v, 1)), exprConst(0));
    }
  }

  const allValues: Record<string, LPExpr> = { ...allVars };

  let initialT2Points: LPExpr = exprConst(input.initialT2Points);
  let initialT3Points: LPExpr = exprConst(input.initialT3Points);

  if (input.chooseFirstStation) {
    const options: FirstStationOptions = input.firstStationOptions ?? {
      allowCoriolis: true,
      allowAsteroidBase: true,
      allowOrbisOrOcellus: true,
      allowDodecahedron: true,
    };
    for (const name of ALL_CATEGORIES["First Station"]) {
      const v = model.addVar(`${name}__first_station`, "binary");
      firstStationVars[name] = v;
      allValues[name] = addExpr(allValues[name], exprVar(v, 1));

      const building = ALL_BUILDINGS[name];
      if (building.T2points !== "port" && building.T2points > 0) {
        initialT2Points = addExpr(initialT2Points, exprVar(v, building.T2points));
      }
      if (building.T3points !== "port" && building.T3points > 0) {
        initialT3Points = addExpr(initialT3Points, exprVar(v, building.T3points));
      }
    }
    if (!options.allowCoriolis && firstStationVars.Coriolis) {
      model.addConstraint(exprVar(firstStationVars.Coriolis), "==", 0);
    }
    if (!options.allowAsteroidBase && firstStationVars.Asteroid_Base) {
      model.addConstraint(exprVar(firstStationVars.Asteroid_Base), "==", 0);
    }
    if (!options.allowOrbisOrOcellus && firstStationVars.Orbis_or_Ocellus) {
      model.addConstraint(exprVar(firstStationVars.Orbis_or_Ocellus), "==", 0);
    }
    if (!options.allowDodecahedron && firstStationVars.Dodecahedron) {
      model.addConstraint(exprVar(firstStationVars.Dodecahedron), "==", 0);
    }
    if (!input.allowCriminal && firstStationVars.Criminal_Outpost) {
      model.addConstraint(exprVar(firstStationVars.Criminal_Outpost), "==", 0);
    }
    model.addConstraint(
      Object.values(firstStationVars).reduce((acc, v) => addExpr(acc, exprVar(v, 1)), exprConst(0)),
      "==",
      1,
    );
  } else if (input.firstStationBuilding && input.firstStationBuilding in ALL_BUILDINGS) {
    // Bug fix vs. an earlier version of this port: a manually-specified first station's stats
    // must still count toward system scores (the original Python did this implicitly, since its
    // UI treated the manual first-station row as just another "already present" entry). T2/T3
    // points are deliberately NOT bonused here, matching the original: in manual mode the user's
    // `initialT2Points`/`initialT3Points` inputs already represent their real current balance.
    allValues[input.firstStationBuilding] = addExpr(allValues[input.firstStationBuilding], exprConst(1));
  }

  if (!input.allowCriminal) {
    model.addConstraint(allVars.Pirate_Base, "==", 0);
    model.addConstraint(allVars.Criminal_Outpost, "==", 0);
  }

  // --- Slot capacity ---------------------------------------------------------------------
  const usedSlots = {
    space: Object.entries(ALL_BUILDINGS)
      .filter(([, b]) => b.slot === "space")
      .reduce((acc, [name]) => addExpr(acc, allVars[name]), exprConst(0)),
    ground: Object.entries(ALL_BUILDINGS)
      .filter(([, b]) => b.slot === "ground")
      .reduce((acc, [name]) => addExpr(acc, allVars[name]), exprConst(0)),
  };
  model.addConstraint(allVars.Asteroid_Base, "<=", input.slots.asteroid);
  model.addConstraint(usedSlots.space, "<=", input.slots.space);
  model.addConstraint(usedSlots.ground, "<=", input.slots.ground);

  // --- Already-present buildings, folded into allValues as constants ---------------------
  for (const [name, nb] of Object.entries(input.alreadyPresent)) {
    if (nb === 0) continue;
    if (!(name in ALL_BUILDINGS)) continue;
    allValues[name] = addExpr(allValues[name], exprConst(nb));
    if ((name === "Pirate_Base" || name === "Criminal_Outpost") && !input.allowCriminal) {
      return errorResult(
        "Error: criminal outpost or pirate base already present, but you do not want criminal outposts to be built",
      );
    }
  }

  // Already-present ports occupy the first `nbPortsAlreadyPresent` sequential slots.
  for (const slots of Object.values(portVars)) {
    for (let k = 0; k < nbPortsAlreadyPresent; k++) {
      model.addConstraint(exprVar(slots[k]), "==", 0);
    }
  }

  // --- At-least / at-most per-building constraints ----------------------------------------
  for (const [name, atLeast] of Object.entries(input.constraints?.atLeast ?? {})) {
    if (name in allValues) model.addConstraint(allValues[name], ">=", atLeast);
  }
  for (const [name, atMost] of Object.entries(input.constraints?.atMost ?? {})) {
    if (name in allValues) model.addConstraint(allValues[name], "<=", atMost);
  }

  // --- Port slot consistency: at most one port type per slot, filled sequentially --------
  for (let k = 0; k < maxNbPorts; k++) {
    const slotSum = Object.values(portVars).reduce((acc, slots) => addExpr(acc, exprVar(slots[k])), exprConst(0));
    model.addConstraint(slotSum, "<=", 1);
    if (k > nbPortsAlreadyPresent) {
      const prevSlotSum = Object.values(portVars).reduce(
        (acc, slots) => addExpr(acc, exprVar(slots[k - 1])),
        exprConst(0),
      );
      model.addConstraint(subExpr(slotSum, prevSlotSum), "<=", 0);
    }
  }

  // --- System scores -----------------------------------------------------------------------
  const systemScores: Record<Score, LPExpr> = {} as Record<Score, LPExpr>;
  const firstStationContribution: Partial<Record<Score, LPExpr>> = {};
  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    for (const score of ALL_SCORES) {
      if (score === "system_score_beta") continue;
      const statValue = building[score as keyof typeof building];
      if (typeof statValue !== "number" || statValue === 0) continue;
      const source = score === "construction_cost" ? allVars[name] : allValues[name];
      systemScores[score] = addExpr(systemScores[score] ?? exprConst(0), scaleExpr(source, statValue));

      if (score in SUBSEQUENT_FACILITY_WEIGHT) {
        if (input.chooseFirstStation && name in firstStationVars) {
          firstStationContribution[score] = addExpr(
            firstStationContribution[score] ?? exprConst(0),
            exprVar(firstStationVars[name], statValue),
          );
        } else if (!input.chooseFirstStation && name === input.firstStationBuilding) {
          firstStationContribution[score] = addExpr(
            firstStationContribution[score] ?? exprConst(0),
            exprConst(statValue),
          );
        }
      }
    }
  }
  for (const score of ALL_SCORES) {
    if (!(score in systemScores)) systemScores[score] = exprConst(0);
  }

  // Reweight: full weight for the claim/first station's share, reduced weight for everything else.
  for (const entry of Object.entries(SUBSEQUENT_FACILITY_WEIGHT)) {
    const [score, weight] = entry as [Score, number];
    const firstStationPart = firstStationContribution[score] ?? exprConst(0);
    const subsequentPart = subExpr(systemScores[score], firstStationPart);
    systemScores[score] = addExpr(firstStationPart, scaleExpr(subsequentPart, weight));
  }

  if (input.chooseFirstStation) {
    let firstStationCost = exprConst(0);
    for (const [name, v] of Object.entries(firstStationVars)) {
      const building = ALL_BUILDINGS[name];
      if (building.construction_cost !== 0) {
        firstStationCost = addExpr(
          firstStationCost,
          exprVar(v, building.construction_cost * (1 + building.first_station_offset)),
        );
      }
    }
    systemScores.construction_cost = addExpr(systemScores.construction_cost, firstStationCost);
  }
  systemScores.system_score_beta = addExpr(
    addExpr(systemScores.security, systemScores.tech_level),
    addExpr(systemScores.wealth, systemScores.standard_of_living),
  );

  // --- Objective -----------------------------------------------------------------------------
  const objectiveVar = model.addVar("objective", "continuous", -INFINITY, INFINITY);
  let direction: Direction;
  let objectiveExpr: LPExpr;
  let auxVarsFromObjective: string[] = [];
  if (input.objective.kind === "custom") {
    direction = input.objective.direction;
    const scoreExprs = Object.fromEntries(
      (Object.keys(SCORE_LETTER_TO_SCORE) as ScoreLetter[]).map((letter) => [
        letter,
        systemScores[SCORE_LETTER_TO_SCORE[letter]],
      ]),
    ) as Record<ScoreLetter, LPExpr>;
    const varBounds = model.varBounds();
    const scoreBounds = Object.fromEntries(
      (Object.keys(SCORE_LETTER_TO_SCORE) as ScoreLetter[]).map((letter) => [
        letter,
        boundExpr(scoreExprs[letter], varBounds) as ScoreBounds,
      ]),
    ) as Record<ScoreLetter, ScoreBounds>;
    let compiled: ReturnType<typeof compileObjective>;
    try {
      compiled = compileObjective(input.objective.expression, direction, scoreExprs, scoreBounds);
    } catch (e) {
      return errorResult(`Error when computing objective: ${(e as Error).message}`);
    }
    objectiveExpr = compiled.linear;
    auxVarsFromObjective = compiled.auxVars;
    for (const v of compiled.auxVars) model.addVar(v, "continuous", -INFINITY, INFINITY);
    for (const c of compiled.auxConstraints) {
      model.addConstraint(c.expr, c.sense, 0, c.name);
    }
  } else {
    direction = input.objective.score === "construction_cost" ? "minimize" : "maximize";
    objectiveExpr = systemScores[input.objective.score];
  }
  model.addConstraint(subExpr(exprVar(objectiveVar, 1), objectiveExpr), "==", 0, "objective_link");
  model.setObjective(exprVar(objectiveVar, 1), direction);

  // --- Min/max score constraints --------------------------------------------------------------
  for (const score of ALL_SCORES) {
    const min = input.scoreConstraints?.min?.[score];
    const max = input.scoreConstraints?.max?.[score];
    if (min !== undefined) model.addConstraint(systemScores[score], ">=", min);
    if (max !== undefined) model.addConstraint(systemScores[score], "<=", max);
  }

  // --- Construction-point constraints (escalating port cost) ---------------------------------
  let nonPortT2Cp = initialT2Points;
  let nonPortT3Cp = initialT3Points;
  for (const [name, building] of Object.entries(ALL_BUILDINGS)) {
    if (isPort(building)) continue;
    const t2 = building.T2points;
    const t3 = building.T3points;
    if (typeof t2 === "number" && t2 !== 0) nonPortT2Cp = addExpr(nonPortT2Cp, exprVar(name, t2));
    if (typeof t3 === "number" && t3 !== 0) nonPortT3Cp = addExpr(nonPortT3Cp, exprVar(name, t3));
  }

  let portsT2Running: LPExpr = exprConst(0);
  let portsT3Running: LPExpr = exprConst(0);
  let t3FromT2PortsRunning: LPExpr = exprConst(0);
  let finalT2Expr: LPExpr = exprConst(0);
  let finalT3Expr: LPExpr = exprConst(0);
  for (let k = 0; k < maxNbPorts; k++) {
    let t2PortSlotSum: LPExpr = exprConst(0);
    let t3PortSlotSum: LPExpr = exprConst(0);
    let t3FromT2PortSlotSum: LPExpr = exprConst(0);
    for (const [name, slots] of Object.entries(portVars)) {
      const building = ALL_BUILDINGS[name];
      if (building.T2points === "port") t2PortSlotSum = addExpr(t2PortSlotSum, exprVar(slots[k], 1));
      if (building.T3points === "port") t3PortSlotSum = addExpr(t3PortSlotSum, exprVar(slots[k], 1));
      if (building.T3points !== "port" && building.T3points !== 0) {
        t3FromT2PortSlotSum = addExpr(t3FromT2PortSlotSum, exprVar(slots[k], building.T3points));
      }
    }
    portsT2Running = addExpr(portsT2Running, scaleExpr(t2PortSlotSum, getT2PortCost(k)));
    portsT3Running = addExpr(portsT3Running, scaleExpr(t3PortSlotSum, getT3PortCost(k)));
    t3FromT2PortsRunning = addExpr(t3FromT2PortsRunning, t3FromT2PortSlotSum);

    finalT2Expr = subExpr(nonPortT2Cp, portsT2Running);
    finalT3Expr = subExpr(addExpr(t3FromT2PortsRunning, nonPortT3Cp), portsT3Running);
    model.addConstraint(finalT2Expr, ">=", 0, `t2cp_${k}`);
    model.addConstraint(finalT3Expr, ">=", 0, `t3cp_${k}`);
  }

  // --- Dependencies, as big-M reformulations of the original's indicator constraints --------
  const uniqueDependencies = new Set<string>();
  for (const building of Object.values(ALL_BUILDINGS)) {
    if (building.dependencies.length > 0) uniqueDependencies.add(JSON.stringify(building.dependencies));
  }
  const anyPositiveByDeps = new Map<string, LPExpr>();
  let indicatorCounter = 0;
  for (const depsJson of uniqueDependencies) {
    const deps = JSON.parse(depsJson) as string[];
    const individualVars = deps.map((name) => {
      const indicName = model.addVar(`indic_${indicatorCounter++}_${name}`, "binary");
      // indic=1 => allValues[name] >= 1  (big-M: allValues[name] - M*indic >= 1 - M)
      model.addConstraint(subExpr(allValues[name], exprVar(indicName, DEPENDENCY_BIG_M)), ">=", 1 - DEPENDENCY_BIG_M);
      return { name, indicName };
    });
    let anyPositive: LPExpr;
    if (individualVars.length === 1) {
      anyPositive = exprVar(individualVars[0].indicName, 1);
    } else {
      const anyPositiveVar = model.addVar(`any_positive_${indicatorCounter++}`, "binary");
      for (const { indicName } of individualVars) {
        model.addConstraint(subExpr(exprVar(anyPositiveVar, 1), exprVar(indicName, 1)), ">=", 0);
      }
      const sumIndic = individualVars.reduce((acc, { indicName }) => addExpr(acc, exprVar(indicName, 1)), exprConst(0));
      // anyPositive=1 => sum(indic) >= 1  (M=1 is exact here: sum ranges over [0, count])
      model.addConstraint(subExpr(sumIndic, exprVar(anyPositiveVar, 1)), ">=", 0);
      anyPositive = exprVar(anyPositiveVar, 1);
    }
    anyPositiveByDeps.set(depsJson, anyPositive);
  }
  for (const [targetName, targetBuilding] of Object.entries(ALL_BUILDINGS)) {
    if (targetBuilding.dependencies.length === 0) continue;
    const depsJson = JSON.stringify(targetBuilding.dependencies);
    const anyPositive = anyPositiveByDeps.get(depsJson)!;
    const indicator2 = model.addVar(`indic2_${targetName}`, "binary");
    // indicator2 == 1 - anyPositive
    model.addConstraint(addExpr(exprVar(indicator2, 1), anyPositive), "==", 1);
    // indicator2=1 => allValues[target] <= 0  (big-M: allValues[target] + M*indicator2 <= M)
    model.addConstraint(
      addExpr(allValues[targetName], exprVar(indicator2, DEPENDENCY_BIG_M)),
      "<=",
      DEPENDENCY_BIG_M,
    );
  }

  // --- Solve -----------------------------------------------------------------------------------
  // The `highs` package ships its ~3.4MB WASM binary as a separate file (subpath export
  // "highs/runtime"); in the browser it has no way to find it on its own (the bundled highs.js is
  // a raw Emscripten build, not authored for bundlers), so locateFile points it at the URL Vite
  // resolves for the fingerprinted asset. Under a real Node process (plain tests, or component
  // tests running under jsdom — jsdom polyfills `window` but still runs inside real Node) skip this
  // and let the Emscripten loader use its own default same-directory filesystem lookup instead: a
  // "?url" import resolves to a dev-server-relative path there, not a real filesystem path, and
  // Emscripten's own Node-vs-browser detection (not `typeof window`) decides whether it reads the
  // file via fs or fetches it, so a jsdom check on `window` alone picks the wrong branch here.
  const { default: loadHighs } = await import("highs");
  const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  let highs: Awaited<ReturnType<typeof loadHighs>>;
  if (nodeProcess?.versions?.node) {
    highs = await loadHighs();
  } else {
    const { default: highsWasmUrl } = await import("highs/runtime?url");
    highs = await loadHighs({ locateFile: () => highsWasmUrl });
  }
  const lpText = model.toLPFormat();
  const solved = highs.solve(lpText, { output_flag: false });

  if (solved.Status === "Infeasible") {
    return {
      ...errorResult("Error: There is no possible system arrangement that can fit the conditions you have specified"),
      status: "infeasible",
    };
  }
  if (solved.Status !== "Optimal") {
    return errorResult(`Error: solver returned status "${solved.Status}"`);
  }

  const colValues: Record<string, number> = {};
  for (const [name, col] of Object.entries(solved.Columns)) {
    colValues[name] = (col as { Primal: number }).Primal;
  }

  const toBuild: Record<string, number> = {};
  for (const name of Object.keys(ALL_BUILDINGS)) {
    const value = Math.round(evalExprAt(allVars[name], colValues));
    if (value > 0) toBuild[name] = value;
  }

  const portOrder: string[] = [];
  for (let k = nbPortsAlreadyPresent; k < maxNbPorts; k++) {
    for (const [name, slots] of Object.entries(portVars)) {
      if (Math.round(colValues[slots[k]] ?? 0) >= 1) portOrder.push(name);
    }
  }

  let firstStation: string | null = null;
  if (input.chooseFirstStation) {
    for (const [name, v] of Object.entries(firstStationVars)) {
      if (Math.round(colValues[v] ?? 0) === 1) firstStation = name;
    }
  } else {
    firstStation = input.firstStationBuilding ?? null;
  }

  const scores = Object.fromEntries(
    ALL_SCORES.map((score) => [score, Math.round(evalExprAt(systemScores[score], colValues))]),
  ) as Record<Score, number>;
  // Recompute the compound score from the rounded base scores for display consistency.
  scores.system_score_beta = computeCompoundScore("system_score_beta", scores);

  void auxVarsFromObjective; // present in the model for completeness; not surfaced individually

  return {
    status: "optimal",
    toBuild,
    portOrder,
    firstStation,
    scores,
    finalT2Points: Math.round(evalExprAt(finalT2Expr, colValues)),
    finalT3Points: Math.round(evalExprAt(finalT3Expr, colValues)),
    slotsRemaining: {
      space: input.slots.space - Math.round(evalExprAt(usedSlots.space, colValues)),
      ground: input.slots.ground - Math.round(evalExprAt(usedSlots.ground, colValues)),
      asteroid: input.slots.asteroid - Math.round(evalExprAt(allVars.Asteroid_Base, colValues)),
    },
    objectiveValue: evalExprAt(exprVar(objectiveVar, 1), colValues),
  };
}
