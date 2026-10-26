// v2/list-numbers.mjs — session 251. The counter module's second piece, the
// arithmetic: reading a list's options and label recipe, and writing the
// marker LaTeX prints for a number (LISTS-PLAN-s249.md Part 3, step 2).
//
// Plain terms: enumitem lists take options such as label=(\alph*), start=3
// and resume. This file reads them from the tokens (never by pattern), and
// turns a recipe plus a count into the printed marker: (\alph*) and 3 give
// "(c)". It also names the "short form" Pandoc can carry — one of the fifteen
// 1. 1) (1) a. a) (a) A. A) (A) i. i) (i) I. I) (I) — found next to the
// counter even when the recipe wraps it (\maybecircle{\Alph*.} gives A.).
// The counting itself happens during the reading (list-depth.mjs), because
// what a resume carries on from depends on TeX's groups.
//
// Pinned by pdflatex: v2/test/list-numbers-cases.mjs, run by
// _work/_s251_numbers.mjs (135 of 135 held).

const COUNTERS = new Map([["arabic", "1"], ["alph", "a"], ["Alph", "A"], ["roman", "i"], ["Roman", "I"]]);
const STYLE_OF = new Map([["1", "arabic"], ["a", "alph"], ["A", "Alph"], ["i", "roman"], ["I", "Roman"]]);
export const SHORT_FORMS = new Set(["1.", "1)", "(1)", "a.", "a)", "(a)", "A.", "A)", "(A)", "i.", "i)", "(i)", "I.", "I)", "(I)"]);
// Keys written without "=" that only change spacing or layout.
const FLAG_KEYS = new Set(["nosep", "noitemsep", "nolistsep", "wide", "fullwidth"]);
const COUNTER_COMMANDS = new Set(["setcounter", "addtocounter", "stepcounter", "refstepcounter"]);
export { COUNTER_COMMANDS };

const isOther = (t, ch) => t && t.kind === "Other" && t.text === ch;
const blank = (t) => t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment";
const textOf = (toks) => toks.map((t) => t.text).join("").trim();
function trim(toks) {
  let a = 0, b = toks.length;
  while (a < b && blank(toks[a])) a++;
  while (b > a && blank(toks[b - 1])) b--;
  return toks.slice(a, b);
}

// key=value pairs at brace depth zero: [{ name, value (tokens) | null }].
export function splitKeys(toks) {
  const keys = [];
  let depth = 0, cur = [];
  const flush = () => {
    const piece = trim(cur); cur = [];
    if (!piece.length) return;
    let d = 0, eq = -1;
    for (let k = 0; k < piece.length; k++) {
      if (piece[k].kind === "BeginGroup") d++; else if (piece[k].kind === "EndGroup") d--;
      else if (d === 0 && isOther(piece[k], "=")) { eq = k; break; }
    }
    if (eq < 0) keys.push({ name: textOf(piece), value: null, tokens: piece });
    else keys.push({ name: textOf(piece.slice(0, eq)), value: trim(piece.slice(eq + 1)), tokens: piece });
  };
  for (const t of toks) {
    if (t.kind === "BeginGroup") depth++; else if (t.kind === "EndGroup") depth--;
    if (depth === 0 && isOther(t, ",")) { flush(); continue; }
    cur.push(t);
  }
  flush();
  return keys;
}

// Counter commands anywhere in tokens: \setcounter{enumi}... -> ["setcounter enumi"].
export function counterChanges(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "ControlWord" || !COUNTER_COMMANDS.has(t.name)) continue;
    let j = k + 1; while (j < toks.length && blank(toks[j])) j++;
    let name = "";
    if (toks[j] && toks[j].kind === "BeginGroup") { j++; while (j < toks.length && toks[j].kind !== "EndGroup") name += toks[j++].text; }
    out.push({ command: t.name, counter: name.trim() });
  }
  return out;
}

// Read one list's own options. Returns { label, start, resume, resumeStar,
// resumeName, series, why } — why is set when the tool cannot be sure.
// label is { tokens } or { short: "(a)" } or null.
export function readOptions(toks, { shortlabels = false, setlist = false } = {}) {
  const r = { label: null, start: null, resume: false, resumeStar: false, resumeName: null, series: null, why: null, keys: [] };
  const keys = splitKeys(toks);
  keys.forEach((k, idx) => {
    if (r.why) return;
    const v = k.value, vt = v ? textOf(v) : null;
    if (v && counterChanges(v).length) { r.why = "its option " + k.name + "= changes a counter"; return; }
    switch (k.name) {
      case "label": r.label = { tokens: v || [] }; r.keys.push(k); return;
      case "start":
        if (!/^-?\d+$/.test(vt || "")) { r.why = "start=" + vt + " is not a plain number"; return; }
        r.start = +vt; r.keys.push(k); return;
      case "resume": case "resume*":
        if (setlist) { r.why = "\\setlist carries " + k.name; return; }
        r.resume = true; if (k.name === "resume*") r.resumeStar = true;
        if (v) r.resumeName = vt;
        return;
      case "series":
        if (setlist) { r.why = "\\setlist carries series="; return; }
        r.series = vt; return;
      case "label*": r.why = "label*= adds to a label the tool does not follow"; return;
    }
    if (v) { r.keys.push(k); return; }                    // spacing, ref=, font= ...: the marker is the same
    if (FLAG_KEYS.has(k.name)) return;
    if (shortlabels && idx === 0 && SHORT_FORMS.has(k.name)) { r.label = { short: k.name }; r.keys.push(k); return; }
    r.why = "the option " + JSON.stringify(k.name) + " is not one the tool reads" + (shortlabels && SHORT_FORMS.has(k.name) ? " (a short label counts only as the first option)" : "");
  });
  if (!r.why && r.resume && r.start != null) r.why = "resume and start= together: the tool does not guess which wins";
  if (r.resumeName && r.series) r.why = r.why || "resume= and series= together";
  if (r.resumeName) r.series = r.resumeName;
  return r;
}

// A label recipe -> { style, short, exact, before, after } or { why }.
// before/after are the printed characters either side of the counter.
export function analyzeLabel(label) {
  if (label.short) {
    const m = /^(\(?)([1aAiI])([.)])$/.exec(label.short);
    return { style: STYLE_OF.get(m[2]), short: label.short, exact: true, before: m[1], after: m[3] };
  }
  const toks = label.tokens;
  let before = "", after = "", found = null, exact = true, depth = 0;
  const groupStack = [[]];              // the plain characters of each open group, the counter as \u0000
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const put = (s) => { if (found) after += s; else before += s; for (const ch of s) groupStack[groupStack.length - 1].push(ch); };
    if (t.kind === "BeginGroup") { depth++; groupStack.push([]); exact = false; continue; }
    if (t.kind === "EndGroup") {
      depth--; const g = groupStack.pop();
      if (g.includes("\u0000")) groupStack[groupStack.length - 1].push(g);   // keep the counter's own group whole
      else for (const ch of g) groupStack[groupStack.length - 1].push(ch);
      continue;
    }
    if (t.kind === "ControlWord" && COUNTERS.has(t.name) && isOther(toks[k + 1], "*")) {
      if (found) return { why: "the label holds two counters" };
      found = COUNTERS.get(t.name); groupStack[groupStack.length - 1].push("\u0000"); k++; continue;
    }
    if (t.kind === "ControlWord") {
      if (t.name === "protect") continue;
      if (COUNTERS.has(t.name) || /^the/.test(t.name) || t.name === "value") return { why: "the label prints a counter the tool does not follow (\\" + t.name + ")" };
      exact = false; continue;                       // \textbf, \maybecircle, \bfseries: the characters are the same
    }
    if (t.kind === "ControlSymbol") { if (t.name === "#" || t.name === "%" || t.name === "&") { put(t.name); exact = false; continue; } return { why: "the label holds \\" + t.name }; }
    if (t.kind === "MathShift") return { why: "the label holds mathematics" };
    if (t.kind === "Space" || t.kind === "Newline") { put(" "); continue; }
    if (t.kind === "Comment") continue;
    put(t.text);
  }
  if (!found) return { why: "the label has no counter (\\arabic* and the like)" };
  // the short form: the plain characters next to the counter inside its own group
  const findGroup = (g) => { if (g.includes("\u0000")) return g; for (const x of g) if (Array.isArray(x)) { const f = findGroup(x); if (f) return f; } return null; };
  const g = findGroup(groupStack[0]) || [];
  const at = g.indexOf("\u0000");
  let pre = "", post = "";
  for (let k = at - 1; k >= 0 && typeof g[k] === "string" && g[k] !== " "; k--) pre = g[k] + pre;
  for (let k = at + 1; k < g.length && typeof g[k] === "string" && g[k] !== " "; k++) post += g[k];
  const cand = pre + found + post;
  return { style: STYLE_OF.get(found), short: SHORT_FORMS.has(cand) ? cand : null, exact: exact && SHORT_FORMS.has(cand) && before === pre && after === post,
           before: before.replace(/\s+/g, " "), after: after.replace(/\s+/g, " ") };
}

const ROMAN = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
// A count in a style, as LaTeX prints it; null where LaTeX would complain or print nothing.
export function formatCount(n, style) {
  if (style === "arabic") return String(n);
  if (style === "alph" || style === "Alph") { if (n < 1 || n > 26) return null; const c = String.fromCharCode(96 + n); return style === "Alph" ? c.toUpperCase() : c; }
  if (n < 1) return null;
  let s = "", m = n;
  for (const [v, r] of ROMAN) while (m >= v) { s += r; m -= v; }
  return style === "Roman" ? s.toUpperCase() : s;
}

// The level defaults for an enumerate-type list (kernel and enumitem agree).
export const DEFAULT_LABELS = [{ short: "1." }, { short: "(a)" }, { short: "i." }, { short: "A." }];
const ROMAN_LEVEL = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
export const counterName = (base, level) => base + (ROMAN_LEVEL[level - 1] || String(level));
