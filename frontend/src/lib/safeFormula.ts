// Safe arithmetic formula evaluator (1.1.38 M3) — the Axiom-9 security boundary
// for the teacher-authored calculator formula. A whitelisted-grammar
// recursive-descent parser: it can ONLY produce a number or a parse error.
//
// Deliberately NO `eval`, NO `Function`, NO property access, NO `__proto__`.
// Supports: numbers, named variables, `+ - * / ^`, unary minus, parentheses,
// and a fixed single-argument function allowlist. Anything else throws.

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  abs: Math.abs,
  exp: Math.exp,
};

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Map the Unicode math operators a teacher might paste (from a formula editor
 *  or a maths palette) onto the ASCII the grammar accepts: × ⋅ → *, ÷ → /,
 *  − (minus sign) → -. Purely cosmetic — the grammar is unchanged. */
function normalizeOps(src: string): string {
  return src.replace(/[×⋅]/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
}

/**
 * Split an optional leading `name =` off a formula. Teachers naturally write the
 * whole equation (`E = m * c^2`), but the evaluator only computes the
 * right-hand side. Accept and strip a single `identifier =` prefix so the
 * equation form just works; return the identifier as `label` (used as the
 * calculator's result name when no title is set). Anything that isn't a clean
 * `name = expr` (no `=`, several `=`, or a non-identifier left side) is returned
 * untouched so the tokenizer can still report the real problem.
 */
export function splitFormula(raw: string): { label: string | null; expr: string } {
  const eqCount = (raw.match(/=/g) ?? []).length;
  if (eqCount !== 1) return { label: null, expr: raw };
  const idx = raw.indexOf("=");
  const lhs = raw.slice(0, idx).trim();
  if (!IDENT_RE.test(lhs)) return { label: null, expr: raw };
  return { label: lhs, expr: raw.slice(idx + 1) };
}

function tokenize(rawSrc: string): Token[] {
  const src = normalizeOps(rawSrc);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("bad number");
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  private expect(op: string) {
    const t = this.next();
    if (!t || t.t !== "op" || t.v !== op) throw new Error(`expected ${op}`);
  }

  parse(): number {
    const v = this.expr();
    if (this.pos !== this.tokens.length) throw new Error("trailing tokens");
    return v;
  }

  private expr(): number {
    let v = this.term();
    let t = this.peek();
    while (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
      this.next();
      const r = this.term();
      v = t.v === "+" ? v + r : v - r;
      t = this.peek();
    }
    return v;
  }

  private term(): number {
    let v = this.power();
    let t = this.peek();
    while (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
      this.next();
      const r = this.power();
      v = t.v === "*" ? v * r : v / r;
      t = this.peek();
    }
    return v;
  }

  private power(): number {
    const base = this.unary();
    const t = this.peek();
    if (t && t.t === "op" && t.v === "^") {
      this.next();
      return Math.pow(base, this.power()); // right-associative
    }
    return base;
  }

  private unary(): number {
    const t = this.peek();
    if (t && t.t === "op" && t.v === "-") {
      this.next();
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.next();
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") {
      const v = this.expr();
      this.expect(")");
      return v;
    }
    if (t.t === "id") {
      const nx = this.peek();
      if (nx && nx.t === "op" && nx.v === "(") {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`unknown function: ${t.v}`);
        this.next(); // consume "("
        const arg = this.expr();
        this.expect(")");
        return fn(arg);
      }
      // A bare identifier must be a known variable (never a JS global / prop).
      if (!Object.prototype.hasOwnProperty.call(this.vars, t.v)) {
        throw new Error(`unknown variable: ${t.v}`);
      }
      return this.vars[t.v];
    }
    throw new Error("unexpected token");
  }
}

/** Evaluate a formula with the given variable bindings. Returns the numeric
 *  result, or `null` on any parse / eval error or non-finite result. An optional
 *  leading `name =` (the equation form) is stripped first. */
export function evaluateFormula(formula: string, vars: Record<string, number>): number | null {
  try {
    const { expr } = splitFormula(formula);
    const tokens = tokenize(expr);
    if (tokens.length === 0) return null;
    const result = new Parser(tokens, vars).parse();
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/** Turn a raw tokenizer/parser error into a teacher-facing sentence. The two
 *  cases worth catching by hand are the equation form (`=` left in the
 *  expression) and implicit multiplication (`mc` where `m` and `c` are both
 *  declared) — the rest get a single friendly fallback. */
function explainFormulaError(error: string, expr: string, allowedVars: string[]): string {
  if (expr.includes("=")) {
    return "Write only the right-hand side of the equation — the result is shown for you. For E = mc², enter m * c^2.";
  }
  const unknownVar = error.match(/^unknown variable: (.+)$/);
  if (unknownVar) {
    const name = unknownVar[1];
    const letters = [...name];
    if (letters.length > 1 && letters.every((ch) => allowedVars.includes(ch))) {
      return `Put * between variables: write ${letters.join(" * ")}, not ${name}.`;
    }
    return `"${name}" isn't one of your variables — add it above, or check the spelling.`;
  }
  const unknownFn = error.match(/^unknown function: (.+)$/);
  if (unknownFn) {
    return `"${unknownFn[1]}" isn't an allowed function. Use: sqrt, sin, cos, tan, ln, log, abs, exp.`;
  }
  return "This formula isn't valid yet. Use your variables, numbers, + - * / ^ ( ) and the allowed functions.";
}

/** Validate a formula at author time: it must parse and reference only the
 *  allowed variables / whitelisted functions (checked by evaluating with every
 *  allowed variable bound to 1). An optional leading `name =` is stripped first. */
export function validateFormula(formula: string, allowedVars: string[]): { ok: boolean; error?: string } {
  const { expr } = splitFormula(formula);
  const trimmed = expr.trim();
  if (!trimmed) {
    return formula.includes("=")
      ? { ok: false, error: "Add the right-hand side of the equation after the = sign." }
      : { ok: false, error: "The formula is empty." };
  }
  const vars: Record<string, number> = {};
  for (const v of allowedVars) vars[v] = 1;
  try {
    const result = new Parser(tokenize(trimmed), vars).parse();
    if (!Number.isFinite(result)) {
      return { ok: false, error: "This formula can't be calculated — check for a divide-by-zero." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: explainFormulaError(e instanceof Error ? e.message : "", trimmed, allowedVars) };
  }
}
