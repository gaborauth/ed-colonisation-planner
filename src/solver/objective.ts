// Compiles a parsed custom-objective expression (see expressionParser.ts) into an exact-at-integers
// LP linearization, replacing the original Python tool's approach of building a genuine nonlinear
// SCIP expression tree and handing it to a MINLP solver. HiGHS is LP/MIP only (no native nonlinear
// support), so nonlinear terms are compiled to auxiliary variables bounded by supporting tangent
// lines — the standard trick for exactly representing a concave function being maximized (or a
// convex function being minimized) as a linear program, sampled at every integer in the argument's
// possible range so the result is exact for the integer-valued scores this domain always produces.
//
// A term like `sqrt(i)` is only linearizable this way when increasing it is what the optimizer
// wants (concave + maximized, or convex + minimized) — the opposite direction has no LP-exact
// formulation and is rejected with a clear error. Every preset objective in the original tool
// (`sqrt(i)+sqrt(m)+...`, `i^0.2+...`, `ln(i)+...`, `2*w+t-abs(w-2*t)`) fits this pattern.
//
// Known limitation: nested function calls (e.g. `ln(ln(e))`) are not supported — a function's
// argument must itself be a linear expression over the score letters.

import { type Expr, type ScoreLetter, parseExpression } from "./expressionParser";
import { type LPExpr, addExpr, exprConst, exprVar, scaleExpr, subExpr, sumExpr } from "./lpExpr";

export type Direction = "maximize" | "minimize";

export interface ScoreBounds {
  min: number;
  max: number;
}

export interface AuxConstraint {
  name: string;
  expr: LPExpr; // sense: expr <= 0 (upper) or expr >= 0 (lower), see `sense`
  sense: "<=" | ">=";
}

export interface CompiledObjective {
  /** The fully linear part of the objective (in terms of decision variables, after substituting
   * each score letter with its LPExpr and folding in any auxiliary variables from nonlinear terms). */
  linear: LPExpr;
  /** Auxiliary continuous free variables introduced for nonlinear terms; must be added to the model. */
  auxVars: string[];
  /** Supporting tangent-line / epigraph constraints tying auxiliary variables to the true nonlinear value. */
  auxConstraints: AuxConstraint[];
}

interface UnaryFunctionSpec {
  concave: boolean; // concave (sqrt, ln, fractional pow) vs convex (abs, exp)
  domainPositive: boolean; // must clamp breakpoint grid to x >= 1
  f: (x: number) => number;
  fPrime: (x: number) => number;
}

function fractionalPowerSpec(p: number): UnaryFunctionSpec {
  return {
    concave: p > 0 && p < 1,
    domainPositive: true,
    f: (x) => x ** p,
    fPrime: (x) => p * x ** (p - 1),
  };
}

const FUNCTION_SPECS: Record<string, UnaryFunctionSpec> = {
  sqrt: fractionalPowerSpec(0.5),
  ln: { concave: true, domainPositive: true, f: Math.log, fPrime: (x) => 1 / x },
  log: { concave: true, domainPositive: true, f: Math.log, fPrime: (x) => 1 / x },
  exp: { concave: false, domainPositive: false, f: Math.exp, fPrime: Math.exp },
  abs: { concave: false, domainPositive: false, f: Math.abs, fPrime: (x) => (x >= 0 ? 1 : -1) },
};

const MAX_BREAKPOINTS = 400;

function pickBreakpoints(lo: number, hi: number, domainPositive: boolean): number[] {
  const clampedLo = domainPositive ? Math.max(lo, 1) : lo;
  const clampedHi = Math.max(hi, clampedLo + 1);
  const loInt = Math.floor(clampedLo);
  const hiInt = Math.ceil(clampedHi);
  const span = hiInt - loInt;
  if (span <= MAX_BREAKPOINTS) {
    const points: number[] = [];
    for (let x = loInt; x <= hiInt; x++) points.push(x);
    return points;
  }
  const step = span / MAX_BREAKPOINTS;
  const points: number[] = [];
  for (let k = 0; k <= MAX_BREAKPOINTS; k++) points.push(loInt + k * step);
  return points;
}

/** Interval (min/max) arithmetic over a pure-linear expression, used to bound a nonlinear term's
 * argument so we know what range of integers to place tangent breakpoints across. */
function linearInterval(expr: Expr, bounds: Record<ScoreLetter, ScoreBounds>): ScoreBounds {
  switch (expr.kind) {
    case "num":
      return { min: expr.value, max: expr.value };
    case "var":
      return bounds[expr.name];
    case "neg": {
      const inner = linearInterval(expr.expr, bounds);
      return { min: -inner.max, max: -inner.min };
    }
    case "add": {
      const l = linearInterval(expr.left, bounds);
      const r = linearInterval(expr.right, bounds);
      return { min: l.min + r.min, max: l.max + r.max };
    }
    case "sub": {
      const l = linearInterval(expr.left, bounds);
      const r = linearInterval(expr.right, bounds);
      return { min: l.min - r.max, max: l.max - r.min };
    }
    case "mul": {
      const constSide = expr.left.kind === "num" ? expr.left : expr.right.kind === "num" ? expr.right : null;
      const otherSide = expr.left.kind === "num" ? expr.right : expr.left;
      if (!constSide) throw new Error("Non-linear multiplication (variable * variable) is not supported");
      const inner = linearInterval(otherSide, bounds);
      const k = constSide.value;
      const a = inner.min * k;
      const b = inner.max * k;
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    case "call":
    case "pow":
      throw new Error("Nested function calls are not supported in custom objectives");
  }
}

function isLinear(expr: Expr): boolean {
  switch (expr.kind) {
    case "num":
    case "var":
      return true;
    case "neg":
      return isLinear(expr.expr);
    case "add":
    case "sub":
      return isLinear(expr.left) && isLinear(expr.right);
    case "mul":
      return (
        (expr.left.kind === "num" && isLinear(expr.right)) ||
        (expr.right.kind === "num" && isLinear(expr.left))
      );
    case "call":
    case "pow":
      return false;
  }
}

function evalLinear(expr: Expr, scoreExprs: Record<ScoreLetter, LPExpr>): LPExpr {
  switch (expr.kind) {
    case "num":
      return exprConst(expr.value);
    case "var":
      return scoreExprs[expr.name];
    case "neg":
      return scaleExpr(evalLinear(expr.expr, scoreExprs), -1);
    case "add":
      return addExpr(evalLinear(expr.left, scoreExprs), evalLinear(expr.right, scoreExprs));
    case "sub":
      return subExpr(evalLinear(expr.left, scoreExprs), evalLinear(expr.right, scoreExprs));
    case "mul": {
      const constSide = expr.left.kind === "num" ? expr.left : expr.right.kind === "num" ? expr.right : null;
      const otherSide = expr.left.kind === "num" ? expr.right : expr.left;
      if (!constSide) throw new Error("evalLinear: multiplication requires a constant operand");
      return scaleExpr(evalLinear(otherSide, scoreExprs), constSide.value);
    }
    case "call":
    case "pow":
      throw new Error("evalLinear called on a non-linear expression");
  }
}

/** Flattens top-level +/- into a list of signed terms, e.g. `a - (b + c)` -> [+a, -b, -c]. */
function flattenSignedTerms(expr: Expr, sign: 1 | -1 = 1): { sign: 1 | -1; expr: Expr }[] {
  if (expr.kind === "add") {
    return [...flattenSignedTerms(expr.left, sign), ...flattenSignedTerms(expr.right, sign)];
  }
  if (expr.kind === "sub") {
    return [...flattenSignedTerms(expr.left, sign), ...flattenSignedTerms(expr.right, (-sign) as 1 | -1)];
  }
  if (expr.kind === "neg") {
    return flattenSignedTerms(expr.expr, (-sign) as 1 | -1);
  }
  return [{ sign, expr }];
}

let auxCounter = 0;

function linearizeUnaryTerm(
  fnName: string,
  arg: Expr,
  sign: 1 | -1,
  direction: Direction,
  scoreExprs: Record<ScoreLetter, LPExpr>,
  scoreBounds: Record<ScoreLetter, ScoreBounds>,
): { auxVar: string; contribution: LPExpr; constraints: AuxConstraint[] } {
  const spec = FUNCTION_SPECS[fnName];
  if (!spec) throw new Error(`Unknown function "${fnName}"`);
  if (!isLinear(arg)) {
    throw new Error(`${fnName}(...) argument must be a linear expression of score letters`);
  }

  const beneficialToIncrease =
    (sign === 1 && direction === "maximize") || (sign === -1 && direction === "minimize");
  if (spec.concave && !beneficialToIncrease) {
    throw new Error(
      `${fnName}(...) is concave and can only be used in a way that benefits ${direction === "maximize" ? "maximization" : "minimization"} (e.g. add it when maximizing, or negate it when minimizing)`,
    );
  }
  if (!spec.concave && beneficialToIncrease) {
    throw new Error(
      `${fnName}(...) is convex and can only be used in a way that is penalized by ${direction === "maximize" ? "maximization" : "minimization"} (e.g. subtract it when maximizing, or add it when minimizing)`,
    );
  }

  const bounds = linearInterval(arg, scoreBounds);
  const argLP = evalLinear(arg, scoreExprs);
  const breakpoints = pickBreakpoints(bounds.min, bounds.max, spec.domainPositive);

  const auxVar = `_obj_aux_${auxCounter++}_${fnName}`;
  const constraints: AuxConstraint[] = breakpoints.map((x0, idx) => {
    const fx0 = spec.f(x0);
    const slope = spec.fPrime(x0);
    // tangent: y {<=|>=} f(x0) + slope*(arg - x0)  =>  y - slope*arg {<=|>=} f(x0) - slope*x0
    const expr = subExpr(exprVar(auxVar, 1), scaleExpr(argLP, slope));
    const rhsConst = fx0 - slope * x0;
    return {
      name: `${auxVar}_bp${idx}`,
      expr: subExpr(expr, exprConst(rhsConst)), // expr - rhs {<=|>=} 0
      sense: spec.concave ? "<=" : ">=",
    };
  });

  return { auxVar, contribution: exprVar(auxVar, sign), constraints };
}

export function compileObjective(
  expression: string,
  direction: Direction,
  scoreExprs: Record<ScoreLetter, LPExpr>,
  scoreBounds: Record<ScoreLetter, ScoreBounds>,
): CompiledObjective {
  const ast = parseExpression(expression);
  const terms = flattenSignedTerms(ast);

  let linear = exprConst(0);
  const auxVars: string[] = [];
  const auxConstraints: AuxConstraint[] = [];

  for (const { sign, expr } of terms) {
    if (isLinear(expr)) {
      linear = addExpr(linear, scaleExpr(evalLinear(expr, scoreExprs), sign));
      continue;
    }
    if (expr.kind === "call") {
      const { auxVar, contribution, constraints } = linearizeUnaryTerm(
        expr.fn,
        expr.arg,
        sign,
        direction,
        scoreExprs,
        scoreBounds,
      );
      auxVars.push(auxVar);
      linear = addExpr(linear, contribution);
      auxConstraints.push(...constraints);
      continue;
    }
    if (expr.kind === "pow") {
      if (expr.exponent <= 0 || expr.exponent >= 1) {
        throw new Error("Only fractional exponents strictly between 0 and 1 are supported (e.g. i^0.2)");
      }
      const fnName = `pow${expr.exponent}`;
      FUNCTION_SPECS[fnName] = fractionalPowerSpec(expr.exponent);
      const { auxVar, contribution, constraints } = linearizeUnaryTerm(
        fnName,
        expr.base,
        sign,
        direction,
        scoreExprs,
        scoreBounds,
      );
      auxVars.push(auxVar);
      linear = addExpr(linear, contribution);
      auxConstraints.push(...constraints);
      continue;
    }
    throw new Error("Unsupported expression shape in custom objective");
  }

  return { linear, auxVars, auxConstraints };
}

export function sumOfExprs(exprs: LPExpr[]): LPExpr {
  return sumExpr(exprs);
}
