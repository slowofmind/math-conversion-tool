// lib/ifthen-eval.mjs — three-valued evaluator for the ifthen package.
//
// Returns TRUE, FALSE or UNKNOWN. Partial information is the normal
// outcome, not an error, so Kleene logic does real work: FALSE AND
// UNKNOWN is FALSE, TRUE OR UNKNOWN is TRUE.
//
// Evaluated on RAW TEXT, not the AST, deliberately. ifthen uses \( and \)
// as grouping parentheses — handout.sty line 208 is
//     {\(\equal{\firstChar{#1}}{\firstChar{T}}\)\OR\(...\)}
// and unified-latex quite reasonably parses those as inline math. Working
// from text sidesteps that entirely.

import { readGroups } from "./braces.mjs";

export const T = "T", F = "F", U = "U";

export const not = (a) => (a === U ? U : a === T ? F : T);
export const and = (a, b) => (a === F || b === F) ? F : (a === U || b === U) ? U : T;
export const or  = (a, b) => (a === T || b === T) ? T : (a === U || b === U) ? U : F;

// state: { value(name) -> T|F|U, defined(name) -> bool, expand(text) -> {text, residual} }
export function evalTest(src, state) {
  let i = 0;
  const s = String(src);

  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const eat = (lit) => {
    ws();
    if (s.startsWith(lit, i)) { i += lit.length; return true; }
    return false;
  };
  const peekOp = () => {
    ws();
    for (const [lit, op] of [["\\AND", "and"], ["\\and", "and"],
                             ["\\OR", "or"], ["\\or", "or"]]) {
      if (s.startsWith(lit, i) && !/[a-zA-Z]/.test(s[i + lit.length] || "")) return [lit, op];
    }
    return null;
  };

  function primary() {
    ws();
    if (eat("\\NOT") || eat("\\not")) return not(primary());
    if (eat("\\(")) {
      const v = expr();
      eat("\\)");
      return v;
    }
    return atom();
  }

  function atom() {
    ws();
    if (s.startsWith("\\boolean", i)) {
      const g = readGroups(s, i + "\\boolean".length, 1);
      if (!g) { i = s.length; return U; }
      i = g[0].end;
      return state.value(g[0].inner.trim());
    }
    if (s.startsWith("\\isundefined", i)) {
      const g = readGroups(s, i + "\\isundefined".length, 1);
      if (!g) { i = s.length; return U; }
      i = g[0].end;
      const nm = g[0].inner.trim().replace(/^\\/, "");
      const known = state.defined(nm);
      return known === undefined ? U : (known ? F : T);
    }
    if (s.startsWith("\\equal", i)) {
      const g = readGroups(s, i + "\\equal".length, 2);
      if (!g) { i = s.length; return U; }
      i = g[1].end;
      const a = state.expand(g[0].inner), b = state.expand(g[1].inner);
      if (a.residual || b.residual) return U;
      return a.text.trim() === b.text.trim() ? T : F;
    }
    // \lengthtest, \isodd, numeric comparisons and anything else are not
    // decidable without typesetting or counter state.
    i = s.length;
    return U;
  }

  function expr() {
    let v = primary();
    for (;;) {
      const op = peekOp();
      if (!op) return v;
      i += op[0].length;
      const rhs = primary();
      v = op[1] === "and" ? and(v, rhs) : or(v, rhs);
    }
  }

  const result = expr();
  ws();
  // Anything left over means we did not understand the whole test.
  return i < s.length ? U : result;
}
