// A linear expression over named LP decision variables: sum(coef * var) + constant.

export interface LPExpr {
  terms: Map<string, number>;
  constant: number;
}

export function exprConst(value: number): LPExpr {
  return { terms: new Map(), constant: value };
}

export function exprVar(name: string, coef = 1): LPExpr {
  return { terms: new Map([[name, coef]]), constant: 0 };
}

export function scaleExpr(expr: LPExpr, k: number): LPExpr {
  const terms = new Map<string, number>();
  for (const [name, coef] of expr.terms) terms.set(name, coef * k);
  return { terms, constant: expr.constant * k };
}

export function addExpr(a: LPExpr, b: LPExpr): LPExpr {
  const terms = new Map(a.terms);
  for (const [name, coef] of b.terms) terms.set(name, (terms.get(name) ?? 0) + coef);
  return { terms, constant: a.constant + b.constant };
}

export function subExpr(a: LPExpr, b: LPExpr): LPExpr {
  return addExpr(a, scaleExpr(b, -1));
}

export function sumExpr(exprs: LPExpr[]): LPExpr {
  return exprs.reduce(addExpr, exprConst(0));
}
