// v2/structure.mjs — Stage 2 of the v2 rebuild. DESIGN-V2 §4.2a.
//
// Plain terms: the tokenizer hands back a flat list of pieces. These
// helpers answer the questions every later layer asks of that list — where
// does this brace group end, where is the matching \end, where is the math
// — without ever changing the list. Every helper takes the token array and
// an index, keeps no state and never mutates a token (gate T stays green).
//
// Every span returned is a union of whole tokens (invariant S1):
//   open, close   token indices of the span's first and last token
//   start, end    character offsets of the whole span in the file
// findMath and matchEnvironment add bodyStart/bodyEnd (offsets of the
// content between the delimiters), bodyOpen/bodyClose (the body's first and
// last token indices, inclusive — a consumer walking tokens needs no search
// from the offsets; added for the intent-search harness, Session A 2026-09-12)
// and what kind of thing was found.
//
// Broken structure — an unclosed {, a $ never closed, a \begin with no
// \end — gets "not found" (null): no guess, no run to end of file, no
// finding (decided 2026-09-11). The caller knows what it was trying to do
// and decides whether the user should hear about it. braceBalance and
// mathBalance are the diagnostic lookups a caller uses when composing that
// Finding: they say where the structure is broken.
//
// Whitespace before a delimiter follows Pandoc 3.11 (Readers/LaTeX/
// Parsing.hs, read 2026-09-12):
//   before a {...} argument   `spaces`: any run of Space, Newline (blank
//                             lines included) and Comment tokens
//   before a [...] argument   `sp`: Space and Comment tokens, plus at most
//                             ONE Newline that is not followed, after
//                             blanks, by another Newline (a blank line)
// Math follows Readers/LaTeX/Math.hs (dollarsMath, pDollarsMath, mathEnv,
// inlineEnvironments), measured on 3.11 with _work/_probe_math.tex.
//
// Zero dependencies and no regular expressions (DESIGN-V2 §6).

// The 23 math environments Pandoc 3.11 recognises — Math.hs
// `inlineEnvironments`. `math` is inline; every other one is display.
export const PANDOC_MATH_ENVS = ["displaymath", "math", "equation", "equation*",
  "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*",
  "align", "align*", "alignat", "alignat*", "flalign", "flalign*",
  "dmath", "dmath*", "dgroup", "dgroup*", "darray", "darray*", "subequations"];
const MATH_ENV = new Set(PANDOC_MATH_ENVS);

// Picture environments. Pandoc 3.11 reads tikzpicture and tikzcd as raw
// verbatim blocks (Readers/LaTeX.hs rawVerbEnv), so math inside them never
// reaches MathJax, and TikZ's calc library writes coordinates as $...$.
// findMath does NOT skip them on its own — it is a pure lookup, and a later
// toolchain may want the math, text and tick labels inside pictures (Nicholas,
// 2026-09-12). A consumer passes { skip: isPictureEnv } (or a list of names)
// to leave them out. The marker test, from the intent-search harness, also
// catches a course package's own wrappers such as tikzangle; Stage 3's
// definition store will know those exactly.
export const PICTURE_ENV_MARKERS = ["tikz", "pgf", "picture", "axis", "plot",
  "circuit", "chart", "diagram", "forest", "graphviz"];
export function isPictureEnv(name) {
  const lower = String(name).toLowerCase();
  for (const m of PICTURE_ENV_MARKERS) if (lower.includes(m)) return true;
  return false;
}

// ---- small shared pieces ------------------------------------------

const isOther = (t, ch) => t.kind === "Other" && t.text === ch;

function span(tokens, open, close, extra) {
  const s = { open, close, start: tokens[open].start, end: tokens[close].end };
  return extra ? Object.assign(s, extra) : s;
}

// Pandoc `spaces`: skip Space, Newline and Comment tokens. Used before a
// {...} argument and by \begin / \end before their name group.
export function skipSpaces(tokens, i) {
  while (i < tokens.length) {
    const k = tokens[i].kind;
    if (k !== "Space" && k !== "Newline" && k !== "Comment") break;
    i++;
  }
  return i;
}

// Pandoc `sp`: skip Space and Comment tokens, then at most one Newline —
// and only if it is not the start of a blank line and not the last token —
// then Space and Comment tokens again. Used before a [...] argument.
export function skipSp(tokens, i) {
  const blanks = (j) => { while (j < tokens.length && (tokens[j].kind === "Space" || tokens[j].kind === "Comment")) j++; return j; };
  i = blanks(i);
  if (i < tokens.length && tokens[i].kind === "Newline") {
    let j = i + 1;
    while (j < tokens.length && tokens[j].kind === "Space") j++;
    if (j >= tokens.length || tokens[j].kind === "Newline") return i;   // nothing after, or a blank line
    i = blanks(i + 1);
  }
  return i;
}

// ---- groups and brackets --------------------------------------------

// The {...} group at or after i (Pandoc `spaces` skipped first), depth-aware.
// A Region token is one token, so its contents can never affect the depth.
// Returns { open, close, start, end } or null (not a group / never closed).
export function readGroup(tokens, i) {
  const open = skipSpaces(tokens, i);
  if (open >= tokens.length || tokens[open].kind !== "BeginGroup") return null;
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === "BeginGroup") depth++;
    else if (k === "EndGroup" && --depth === 0) return span(tokens, open, j);
  }
  return null;
}

// The [...] group at or after i (Pandoc `sp` skipped first). Two counters
// (rule 46): a ] closes only at brace depth zero; a stray } at depth zero is
// an ordinary character (Pandoc bracketedToks); a nested [ is NOT counted,
// so `[a[b]c]` closes at the first ] exactly as Pandoc reads it. [ and ]
// are Other tokens; their text is tested.
export function readBracket(tokens, i) {
  const open = skipSp(tokens, i);
  if (open >= tokens.length || !isOther(tokens[open], "[")) return null;
  let depth = 0;
  for (let j = open + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === "BeginGroup") depth++;
    else if (t.kind === "EndGroup") { if (depth > 0) depth--; }
    else if (depth === 0 && isOther(t, "]")) return span(tokens, open, j);
  }
  return null;
}

// How many [...] groups follow i in a row; `next` is the token index after
// the last one (i itself when there are none). Kept from v1.
export function countBrackets(tokens, i) {
  let count = 0, next = i;
  for (;;) {
    const b = readBracket(tokens, next);
    if (!b) return { count, next };
    count++; next = b.close + 1;
  }
}

// ---- environments -----------------------------------------------------

// Text between a group's braces, exactly as written (an environment name).
function groupText(tokens, g) {
  let s = "";
  for (let k = g.open + 1; k < g.close; k++) s += tokens[k].text;
  return s;
}

// If tokens[i] is \begin or \end (per `word`) followed by a name group,
// { name, group }; else null. Pandoc begin_/end_: `spaces`, braced, exact name.
function envWord(tokens, i, word) {
  const t = tokens[i];
  if (!t || t.kind !== "ControlWord" || t.name !== word) return null;
  const group = readGroup(tokens, i + 1);
  return group ? { name: groupText(tokens, group), group } : null;
}

// The \end{name} matching the \begin{name} at i, nesting-aware (a nested
// \begin{name} of the same name needs its own \end) but not brace-aware —
// the rule v1's comment-alias transform used, now over tokens, so \begin
// lines inside comments or verbatim can no longer confuse it.
// Returns { name, open, close, start, end, bodyStart, bodyEnd, endWord,
//   bodyOpen, bodyClose }: close is the final } of \end{name}; endWord the
// index of the \end token; bodyOpen..bodyClose the body's token indices.
export function matchEnvironment(tokens, i) {
  const b = envWord(tokens, i, "begin");
  if (!b) return null;
  let depth = 0;
  for (let j = b.group.close + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind !== "ControlWord") continue;
    if (t.name === "begin") {
      const e = envWord(tokens, j, "begin");
      if (e && e.name === b.name) { depth++; j = e.group.close; }
    } else if (t.name === "end") {
      const e = envWord(tokens, j, "end");
      if (!e || e.name !== b.name) continue;
      if (depth === 0) return span(tokens, i, e.group.close,
        { name: b.name, bodyStart: b.group.end, bodyEnd: t.start, endWord: j, bodyOpen: b.group.close + 1, bodyClose: j - 1 });
      depth--; j = e.group.close;
    }
  }
  return null;
}

// ---- math -----------------------------------------------------------------

// A math span: { kind: "inline"|"display", delim: "$"|"$$"|"\\("|"\\["|"env",
//   name (env only), open, close, start, end, bodyStart, bodyEnd,
//   bodyOpen, bodyClose (token indices of the body, inclusive; an empty body
//   has bodyClose === bodyOpen - 1) }.
function mathSpan(tokens, open, close, kind, delim, bodyFirst, bodyLastExcl, name) {
  const bodyStart = bodyFirst < bodyLastExcl ? tokens[bodyFirst].start : tokens[bodyLastExcl].start;
  const s = span(tokens, open, close, { kind, delim, bodyStart, bodyEnd: tokens[bodyLastExcl].start, bodyOpen: bodyFirst, bodyClose: bodyLastExcl - 1 });
  if (name !== undefined) s.name = name;
  return s;
}

// Pandoc pDollarsMath: the next $ at brace depth zero closes; { and } move
// the depth; a } at depth zero fails the parse (Pandoc rejects the document).
// Returns the closing index, -1 (no closer) or -2 (stray } first).
function dollarClose(tokens, j) {
  let depth = 0;
  for (; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === "MathShift" && depth === 0) return j;
    if (k === "BeginGroup") depth++;
    else if (k === "EndGroup") { if (depth === 0) return -2; depth--; }
  }
  return -1;
}

// $...$ and $$...$$ starting at the MathShift at i (Pandoc dollarsMath).
// Measured on 3.11: `$x$$y$` is two inline formulas; `$$x$ y$$` (one $
// where two are due) and an unclosed `$` make Pandoc reject the document;
// an unclosed `$$` becomes empty math. Broken shapes report `unclosed`.
function dollars(tokens, i) {
  const display = i + 1 < tokens.length && tokens[i + 1].kind === "MathShift";
  const first = display ? i + 2 : i + 1;
  const at = dollarClose(tokens, first);
  const delim = display ? "$$" : "$";
  if (at < 0) return { unclosed: { index: i, delim, reason: at === -2 ? "stray-close-brace" : "no-closer" }, skip: first };
  if (!display) return { span: mathSpan(tokens, i, at, "inline", "$", first, at) };
  if (at + 1 < tokens.length && tokens[at + 1].kind === "MathShift")
    return { span: mathSpan(tokens, i, at + 1, "display", "$$", first, at) };
  return { unclosed: { index: i, delim, reason: "single-closer" }, skip: first };
}

// \( ... \) and \[ ... \] starting at the ControlSymbol at i. Pandoc reads to
// the FIRST \) or \] regardless of braces (measured: `\(x \text{a \) b} y\)`
// is rejected). Not brace-aware, by design.
function parenMath(tokens, i) {
  const opener = tokens[i].name, closer = opener === "(" ? ")" : "]";
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === "ControlSymbol" && t.name === closer)
      return { span: mathSpan(tokens, i, j, opener === "(" ? "inline" : "display", "\\" + opener, i + 1, j) };
  }
  return { unclosed: { index: i, delim: "\\" + opener, reason: "no-closer" }, skip: i + 1 };
}

// \begin{X} ... \end{X} for a math environment Pandoc knows, starting at the
// \begin at i. Pandoc mathEnv reads to the FIRST \end{X} — not nesting-aware
// (measured: a nested equation inside equation is rejected). Returns null
// when X is not a math environment (so the caller keeps scanning inside it).
// envs: the Set of math environment names in force — Pandoc's 23, plus a
// consumer's extraMathEnvs (read as display).
function envMath(tokens, i, envs) {
  const b = envWord(tokens, i, "begin");
  if (!b || !envs.has(b.name)) return null;
  for (let j = b.group.close + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind !== "ControlWord" || t.name !== "end") continue;
    const e = envWord(tokens, j, "end");
    if (e && e.name === b.name)
      return { span: mathSpan(tokens, i, e.group.close, b.name === "math" ? "inline" : "display", "env", b.group.close + 1, j, b.name) };
  }
  return { unclosed: { index: i, delim: "env", name: b.name, reason: "no-closer" }, skip: b.group.close + 1 };
}

// One pass over the whole token list: outermost math spans in order, plus
// every opener that never closed (skipped, scanning resumed after it).
function scanMath(tokens, skip, extra) {
  const spans = [], unclosed = [];
  const envs = extra && extra.length ? new Set([...PANDOC_MATH_ENVS, ...extra]) : MATH_ENV;
  const skipped = typeof skip === "function" ? skip : skip ? ((s) => (name) => s.has(name))(new Set(skip)) : null;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    let r = null;
    if (skipped && t.kind === "ControlWord" && t.name === "begin") {   // consumer policy: whole body left out
      const b = envWord(tokens, i, "begin");
      if (b && !envs.has(b.name) && skipped(b.name)) {
        const m = matchEnvironment(tokens, i);                          // nesting-aware; unclosed -> not skipped
        if (m) { i = m.close + 1; continue; }
      }
    }
    if (t.kind === "MathShift") r = dollars(tokens, i);
    else if (t.kind === "ControlSymbol" && (t.name === "(" || t.name === "[")) r = parenMath(tokens, i);
    else if (t.kind === "ControlWord" && t.name === "begin") r = envMath(tokens, i, envs);
    if (r === null) { i++; continue; }
    if (r.span) { spans.push(r.span); i = r.span.close + 1; }
    else { unclosed.push(r.unclosed); i = r.skip; }
  }
  return { spans, unclosed };
}

// Outermost math spans of the whole file, in order. $...$ is brace-aware
// (Pandoc), \(...\) and \[...\] are not, math environments close at their
// first \end. Openers inside a span are never visited. Broken openers are
// skipped here; mathBalance reports them.
// options.skip: environment names (list) or a predicate (name) => boolean whose
// whole bodies are left out — e.g. { skip: isPictureEnv }. Off by default.
// options.extraMathEnvs: environment names read as display math IN ADDITION
// to Pandoc's 23 — a consumer's own list (the intent-search harness reads
// xalignat and xxalignat, which Pandoc's Math.hs never lists). Off by
// default; an extra environment is never skipped, as Pandoc's are not.
export function findMath(tokens, options = {}) {
  return scanMath(tokens, options.skip, options.extraMathEnvs).spans;
}

// ---- diagnostics — for the caller composing a Finding ------------------

// Where the math structure is broken: every opener that never closed,
// { index, delim, reason: no-closer | stray-close-brace | single-closer,
// name (env) }. Pandoc 3.11 rejects the document for an unclosed $, a
// stray } inside math, and `$$...$` (measured), so these are author errors
// worth telling the user about, with a position.
export function mathBalance(tokens, options = {}) {
  return { unclosed: scanMath(tokens, options.skip, options.extraMathEnvs).unclosed };
}

// Brace bookkeeping for the whole file:
//   surplus          count of { minus count of } (0 when balanced)
//   openAtEnd        indices of { still open at the end, outermost first —
//                    the LAST one is the most likely culprit for a missing }
//   strayCloses      how many } arrived with nothing open
//   firstStrayClose  index of the first such }, or null
// Comments and Regions are single tokens, so their braces never count.
export function braceBalance(tokens) {
  const openAtEnd = [];
  let surplus = 0, strayCloses = 0, firstStrayClose = null;
  for (let i = 0; i < tokens.length; i++) {
    const k = tokens[i].kind;
    if (k === "BeginGroup") { openAtEnd.push(i); surplus++; }
    else if (k === "EndGroup") {
      surplus--;
      if (openAtEnd.length) openAtEnd.pop();
      else { strayCloses++; if (firstStrayClose === null) firstStrayClose = i; }
    }
  }
  return { surplus, openAtEnd, strayCloses, firstStrayClose };
}
