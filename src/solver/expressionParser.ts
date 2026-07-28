// A small, safe recursive-descent parser for custom objective expressions like
// "sqrt(i)+sqrt(m)+ln(w)" or "2*w+t-abs(w-2*t)". Replaces the original Python tool's raw
// eval() (flagged in its own source as a security risk) with a real parser producing an AST,
// which src/solver/objective.ts then compiles into an LP-linearizable form.
//
// Supported score letters (matching the original tool):
//   i = initial_population_increase   m = max_population_increase
//   e = security                      t = tech_level
//   w = wealth                        n = standard_of_living
//   d = development_level             c = construction_cost
//
// Two additions beyond the original tool:
//   y = economy_synergy, a body/facility-economy-aware term solve.ts computes per solved layout
//       (0 in aggregate mode) — see solve.ts's header comment and CLAUDE.md's "Update 3
//       link/economy modeling" section.
//   p = economy_preference, the Want/Don't-want per-economy preference bias from the "Economy
//       preferences" controls (also 0 in aggregate mode) — see CLAUDE.md's "Per-economy
//       Must/Want/Don't want/Forbid preference controls" section.

export const SCORE_LETTERS = ["i", "m", "e", "t", "w", "n", "d", "c", "y", "p"] as const;
export type ScoreLetter = (typeof SCORE_LETTERS)[number];

export const UNARY_FUNCTIONS = ["sqrt", "ln", "log", "exp", "abs"] as const;
export type UnaryFunction = (typeof UNARY_FUNCTIONS)[number];

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "var"; name: ScoreLetter }
  | { kind: "neg"; expr: Expr }
  | { kind: "add"; left: Expr; right: Expr }
  | { kind: "sub"; left: Expr; right: Expr }
  | { kind: "mul"; left: Expr; right: Expr }
  | { kind: "call"; fn: UnaryFunction; arg: Expr }
  | { kind: "pow"; base: Expr; exponent: number };

export class ExpressionParseError extends Error {}

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const text = input.slice(i, j);
      const value = Number(text);
      if (Number.isNaN(value)) throw new ExpressionParseError(`Invalid number: "${text}"`);
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[a-zA-Z_]/.test(input[j])) j++;
      tokens.push({ kind: "ident", name: input.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ kind: "op", value: c as "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," });
      i++;
      continue;
    }
    throw new ExpressionParseError(`Unexpected character: "${c}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ExpressionParseError("Unexpected end of expression");
    this.pos++;
    return t;
  }

  private expectOp(value: string): void {
    const t = this.next();
    if (t.kind !== "op" || t.value !== value) {
      throw new ExpressionParseError(`Expected "${value}"`);
    }
  }

  parse(): Expr {
    const expr = this.parseAdditive();
    if (this.pos !== this.tokens.length) {
      throw new ExpressionParseError(`Unexpected trailing input near position ${this.pos}`);
    }
    return expr;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const right = this.parseMultiplicative();
        left = t.value === "+" ? { kind: "add", left, right } : { kind: "sub", left, right };
      } else {
        return left;
      }
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parsePower();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        const right = this.parsePower();
        if (t.value === "/") {
          if (right.kind !== "num") {
            throw new ExpressionParseError("Division is only supported by a constant");
          }
          left = { kind: "mul", left, right: { kind: "num", value: 1 / right.value } };
        } else {
          left = { kind: "mul", left, right };
        }
      } else {
        return left;
      }
    }
  }

  private parsePower(): Expr {
    const base = this.parseUnary();
    const t = this.peek();
    if (t?.kind === "op" && t.value === "^") {
      this.next();
      const exponentExpr = this.parseUnary();
      if (exponentExpr.kind !== "num") {
        throw new ExpressionParseError("Only constant exponents are supported (e.g. i^0.2)");
      }
      return { kind: "pow", base, exponent: exponentExpr.value };
    }
    return base;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t?.kind === "op" && t.value === "-") {
      this.next();
      return { kind: "neg", expr: this.parseUnary() };
    }
    if (t?.kind === "op" && t.value === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.next();
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "op" && t.value === "(") {
      const expr = this.parseAdditive();
      this.expectOp(")");
      return expr;
    }
    if (t.kind === "ident") {
      const nextTok = this.peek();
      if (nextTok?.kind === "op" && nextTok.value === "(") {
        this.next();
        if (!(UNARY_FUNCTIONS as readonly string[]).includes(t.name)) {
          throw new ExpressionParseError(
            `Unknown function "${t.name}" (allowed: ${UNARY_FUNCTIONS.join(", ")})`,
          );
        }
        const arg = this.parseAdditive();
        this.expectOp(")");
        return { kind: "call", fn: t.name as UnaryFunction, arg };
      }
      if (!(SCORE_LETTERS as readonly string[]).includes(t.name)) {
        throw new ExpressionParseError(
          `Unknown variable "${t.name}" (allowed: ${SCORE_LETTERS.join(", ")})`,
        );
      }
      return { kind: "var", name: t.name as ScoreLetter };
    }
    throw new ExpressionParseError("Expected a number, variable, or expression");
  }
}

export function parseExpression(input: string): Expr {
  const tokens = tokenize(input);
  return new Parser(tokens).parse();
}
