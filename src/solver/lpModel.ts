// A minimal CPLEX-LP-format model builder, targeting the `highs` package's text-based
// `highs.solve(lpText, options)` API (see highsSmoke.test.ts for a verified round trip).

import { type LPExpr, exprConst } from "./lpExpr";

export type VarType = "continuous" | "integer" | "binary";
export type Direction = "maximize" | "minimize";

export const INFINITY = 1e30;

interface VarDef {
  name: string;
  type: VarType;
  lb: number;
  ub: number;
}

interface ConstraintDef {
  name: string;
  expr: LPExpr;
  sense: "<=" | ">=" | "==";
  rhs: number;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
}

export class LPModel {
  private vars = new Map<string, VarDef>();
  private constraints: ConstraintDef[] = [];
  private objectiveExpr: LPExpr = exprConst(0);
  private direction: Direction = "maximize";
  private constraintCounter = 0;

  addVar(name: string, type: VarType, lb = 0, ub = INFINITY): string {
    if (this.vars.has(name)) throw new Error(`duplicate variable "${name}"`);
    this.vars.set(name, { name, type, lb, ub });
    return name;
  }

  hasVar(name: string): boolean {
    return this.vars.has(name);
  }

  addConstraint(expr: LPExpr, sense: "<=" | ">=" | "==", rhs: number, name?: string): void {
    this.constraints.push({ name: name ?? `_c${this.constraintCounter++}`, expr, sense, rhs });
  }

  setObjective(expr: LPExpr, direction: Direction): void {
    this.objectiveExpr = expr;
    this.direction = direction;
  }

  private formatExprTerms(expr: LPExpr): string {
    const parts: string[] = [];
    for (const [name, coef] of expr.terms) {
      if (coef === 0) continue;
      const sign = coef < 0 ? "-" : "+";
      parts.push(`${sign} ${formatNumber(Math.abs(coef))} ${name}`);
    }
    return parts.length === 0 ? "0" : parts.join(" ");
  }

  toLPFormat(): string {
    const lines: string[] = [];
    lines.push(this.direction === "maximize" ? "Maximize" : "Minimize");
    lines.push(` obj: ${this.formatExprTerms(this.objectiveExpr)}`);
    lines.push("Subject To");
    for (const c of this.constraints) {
      const rhs = c.rhs - c.expr.constant;
      // HiGHS's LP reader aborts (native crash, not a graceful parse error) on "==" — the
      // CPLEX-LP standard spells equality with a single "=".
      const sense = c.sense === "==" ? "=" : c.sense;
      lines.push(` ${c.name}: ${this.formatExprTerms(c.expr)} ${sense} ${formatNumber(rhs)}`);
    }
    lines.push("Bounds");
    const integers: string[] = [];
    const binaries: string[] = [];
    for (const v of this.vars.values()) {
      // Binary variables get their [0,1] domain from the Binaries section below; an explicit
      // Bounds line here would conflict with it (their declared ub otherwise defaults to +inf).
      if (v.type !== "binary") {
        lines.push(` ${formatNumber(v.lb)} <= ${v.name} <= ${formatNumber(v.ub)}`);
      }
      if (v.type === "integer") integers.push(v.name);
      if (v.type === "binary") binaries.push(v.name);
    }
    if (integers.length > 0) {
      lines.push("Generals");
      lines.push(` ${integers.join(" ")}`);
    }
    if (binaries.length > 0) {
      lines.push("Binaries");
      lines.push(` ${binaries.join(" ")}`);
    }
    lines.push("End");
    return lines.join("\n");
  }

  varBounds(): Map<string, { lb: number; ub: number }> {
    const m = new Map<string, { lb: number; ub: number }>();
    for (const v of this.vars.values()) m.set(v.name, { lb: v.lb, ub: v.ub });
    return m;
  }
}

export function evalExprAt(expr: LPExpr, colValues: Record<string, number>): number {
  let total = expr.constant;
  for (const [name, coef] of expr.terms) {
    total += coef * (colValues[name] ?? 0);
  }
  return total;
}

/** Interval bound ([min,max]) of a linear expression, from each variable's own LP bounds. */
export function boundExpr(expr: LPExpr, varBounds: Map<string, { lb: number; ub: number }>): { min: number; max: number } {
  let min = expr.constant;
  let max = expr.constant;
  for (const [name, coef] of expr.terms) {
    const b = varBounds.get(name);
    if (!b) throw new Error(`unknown variable "${name}" when bounding expression`);
    const a = coef * b.lb;
    const c = coef * b.ub;
    min += Math.min(a, c);
    max += Math.max(a, c);
  }
  return { min, max };
}
