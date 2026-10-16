// v2/expand.mjs — Stage 6, THE GULLET (PLAN-7; DESIGN-V2 §4.6). Session 63
// (the plan's "session 27"): the shared site-visitor (E15), the result kinds
// (E14), the working queue, the guards (E16), the scratch store (E13) and the
// refusal path under invariant X1 (E6). No primitives and no consumers yet:
// those are the plan's sessions 29 and 30.
//
// Plain terms. Given one command call and the arguments the author wrote
// beside it, work out what it turns into: put the arguments into the
// definition the store holds, do the same again for anything user-defined
// that appears in the result, and keep going until nothing user-defined is
// left. Stop at anything Pandoc already reads. Count as you go, so a
// definition that calls itself cannot loop for ever. If anything appears
// that is not modelled, give up on THIS ONE CALL, leave the author's text
// exactly as it was, and say why. Never hand back half an answer.
//
// MEASURED BEFORE A LINE WAS WRITTEN (_work\_s63b-pdflatex-probe.txt):
// for every shape this module rewrites — substitute-and-rescan, the
// nested-argument case, both joining cases, the scratch store, and the two
// "document's definition wins" cases of E7 — pdflatex prints the IDENTICAL
// text for the author's call and for the expansion. And for E17: the
// compile of \def\a{1}\a\def\a{2}\a prints 12, so expanding both calls with
// the store's FINAL meaning would print 22 and be wrong — which is why a
// name the chain defines more than once is REFUSED, not rewritten.
import { readArguments } from "./definition.mjs";

// ---- positions -----------------------------------------------------------
// The line a token index sits on, counted from the token array itself, so it
// agrees with the text the author sees. Lifted from marker-rewrite (s18).
// 1 + the line feeds in the text of every token before it. Counting Newline
// tokens alone missed the breaks a token holds INSIDE its own text - a
// Region (verbatim, expl3, a url over lines) and a backslash at a line's end
// (LF or CRLF) - and every site after one was a line short (HANDOFF 85.2,
// 86.2; fixed session 107). The same body as v2/transforms/ifthen.mjs's
// lineOf, kept twice on purpose (85.4, 2A); v2/test/ifthen.mjs C asserts
// they agree. A bare CR is an Other token, never a line, as in the
// tokenizer's own count. marker-rewrite takes its sites from here (siteOf).
export const lineOf = (tokens, k) => {
  let n = 1;
  for (let i = 0; i < k && i < tokens.length; i++) {
    const s = tokens[i].text;
    for (let j = s.indexOf("\n"); j >= 0; j = s.indexOf("\n", j + 1)) n++;
  }
  return n;
};
export const siteOf = (file, tokens, k) => file + ":" + lineOf(tokens, k);

// ---- E15: the one shared site-visitor ------------------------------------
// Every use of `name` in every file of the chain, wherever it sits — the
// WHOLE token array, so a use inside a definition body, a \DeclareOption
// body or an \ifthenelse is found; command hooks never step into those.
// Each use's arguments are read by the definition's own Slot list through
// readArguments. `skip(file, k)` says which token is the definition's own
// name and is passed over. The FIRST site readArguments refuses stops the
// visit and is returned as `bad` (its site string), so a caller that must
// refuse whole — marker-rewrite — can; a caller that wants every site keeps
// going by returning nothing from `onUnreadable`. `visit` receives
// { file, tokens, k, args, next } and the loop resumes at `next`, so no span
// is ever read twice. Lifted from marker-rewrite.mjs's plan() (session 18)
// and kept to that loop's exact behaviour; its 37 assertions are the proof.
export function visitUses(files, { name, params, skip = () => false }, visit, onUnreadable) {
  for (const f of files) {
    for (let k = 0; k < f.tokens.length; k++) {
      const t = f.tokens[k];
      if (t.kind !== "ControlWord" || t.name !== name) continue;
      if (skip(f.file, k)) continue;
      const r = readArguments(f.tokens, k + 1, params);
      if (!r) {
        const bad = siteOf(f.file, f.tokens, k);
        if (!onUnreadable || onUnreadable({ file: f.file, tokens: f.tokens, k, site: bad }) !== "continue") return { bad };
        continue;
      }
      const stop = visit({ file: f.file, tokens: f.tokens, k, args: r.args, next: r.next });
      if (stop) return { bad: typeof stop === "string" ? stop : siteOf(f.file, f.tokens, k) };
      k = r.next - 1;
    }
  }
  return { bad: null };
}

// ---- E14: four result kinds, one per step (rule 91) -----------------------
// Expansion and execution are different operations with different results:
// a popped token either EMITs text, pushes INPUT back on the queue, writes
// STATE to the scratch store with nothing emitted, or REFUSEs the site.
export const RESULT = Object.freeze({ EMIT: "emit", INPUT: "input", STATE: "state", REFUSE: "refuse" });

// ---- E16: the guards (rules 5, 42) ---------------------------------------
// A cumulative count of expansions for the site and a cap on the working
// queue, both configurable. Exceeding either is a REFUSAL, not an error.
export const DEFAULT_BUDGET = Object.freeze({ expansions: 10000, queue: 100000 });

// ---- the primitives §4.6 lists, NONE modelled yet (plan session 29) -------
// Until a primitive is modelled, meeting one in a body refuses the site:
// emitting it as text would be wrong (TeX reorders or decides at it) and
// Pandoc would not read it either. The list shrinks as session 29 builds.
export const UNMODELLED = new Set([
  "expandafter", "noexpand", "csname", "endcsname",
  "the", "string", "number", "romannumeral", "meaning",
  "@ifnextchar", "@ifstar", "@firstoftwo", "@secondoftwo", "@ifundefined",
  "ifthenelse", "ifx", "if", "ifnum", "ifcase", "ifdefined", "ifmmode", "else", "fi", "or",
  "iftoggle", "IfBooleanTF", "IfBooleanT", "IfBooleanF",
]);

// ---- 3b-1 (s120; HANDOFF 99.3 parts 1-3 and 5, decided 99.4): \ifthenelse
// in the queue. One decider, not two: the fold's chooseBranch decides, from
// an ifThenState built of the expander's `flags` option (absent: every flag
// unknown). The kept branch's tokens go back on the queue, so a macro inside
// it still expands. 93.6 A's edge rule at the four joints is 3b-2's, not here.
// Before deciding, (9): an \ifthenelse written in the body of one of the four
// definitions 78.4 read as markup is the markup module's, whatever its test
// (99.3 Q1 A, a list by name; `tf` is an environment, its store key not read).
// An undecidable test is refused with ONE reason, in 99.3's order: (1) the
// test reads a counter (by name); (6) it holds a parameter, so it belongs to
// a definition made inside another; (10) by origin: a command that came
// through the call's own argument and that the store does not define; (4) a
// command the store defines; (5) any other command; else (12), undecidable,
// no listed cause (99.4). Reasons (1)-(8) at 64.5, (9)-(11) at 78.4.
// "ifthenelse" stays in UNMODELLED: a site whose three arguments cannot be
// read in the queue keeps today's refusal.
import { ifThenState, chooseBranch } from "./transforms/ifthen.mjs";
import { evalTest } from "../lib/ifthen-eval.mjs";   // s146, 3c-3 p2 (HANDOFF 124.4): the queue's decider evaluates its rebuilt text (p4); lib untouched
const IFTHEN_MARKUP = Object.freeze(["maybecircle", "maybebubble", "tf", "LP@drawbackground"]);
const COUNTER_READERS = new Set(["value", "arabic", "alph", "Alph", "roman", "Roman", "fnsymbol"]);
const isCounterReader = (name) => COUNTER_READERS.has(name) ||
  /^the(enum(i|ii|iii|iv)|page|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|equation|figure|table|footnote|mpfootnote)$/.test(name);
const isIfthen = (x) => !!x && x.kind === "ControlWord" && x.name === "ifthenelse";
const IFTHEN_WHY = Object.freeze({
  1: "its test reads a counter, which needs the counter module",
  4: "a side of its test needs an author's macro expanded first",
  5: "a side of its test holds a command the fold does not expand",
  6: "it belongs to a definition made inside another",
  9: "it is markup, the markup module's",
  10: "its test holds a command that came through the call's argument and that the store does not define",
  12: "its test cannot be decided, and no listed cause fits",
});
// s146, 3c-3 p5 (HANDOFF 124.4): `answered`, the tokens of the counter
// commands the counters option answered in this test, skipped; absent, none.
function ifthenReason(q, c, lookup, argSet, answered) {
  const ts = q.slice(c.testAt[0], c.testAt[1] + 1).filter((x) => !(answered && answered.has(x)));
  const cw = ts.filter((x) => x && x.kind === "ControlWord");
  if (cw.some((x) => isCounterReader(x.name))) return 1;
  if (ts.some((x) => x && x.kind === "Parameter")) return 6;
  if (cw.some((x) => argSet.has(x) && !lookup(x.name))) return 10;
  if (cw.some((x) => lookup(x.name))) return 4;
  return cw.length ? 5 : 12;
}

// A letter token, for the joining rule: the tokenizer emits letters as Other.
const isLetter = (t) => !!t && t.kind === "Other" && /^[A-Za-z]$/.test(t.text);
const textOf = (ts) => ts.map((t) => t.text).join("");

// ---- E8: joining, two-sided --------------------------------------------
// When a control word is followed by a LETTER, insert one space, so \emph
// followed by beta never fuses into \emphbeta; followed by anything else —
// punctuation, a brace, another command — nothing is inserted, so \emph.
// stays \emph. (the case marker-rewrite's one-sided helper gets wrong).
export function joinTokens(ts) {
  let s = "";
  for (let i = 0; i < ts.length; i++) {
    s += ts[i].text;
    if (ts[i].kind === "ControlWord" && isLetter(ts[i + 1])) s += " ";
  }
  return s;
}

// ---- substitution: #n -> the argument's tokens, ## -> # --------------------
// An argument that arrived as one {...} group has that pair stripped (TeX
// does). `args` is readArguments' list, aligned with the Slot list.
//
// Session 64, given the definition `rec`: a PRESENT optional or a
// character-delimited argument loses its delimiters (the s63b skeleton kept
// them and printed ([z],y)), and a group that is the whole of it loses its
// braces, as TeX strips that pair; an ABSENT optional takes the definition's
// default, rec.defaultOf[slot], which then re-scans with the body (probe
// opt-*). An absent optional with NO default (xparse o, d) returns null: its
// -NoValue- marker is not modelled, so the caller refuses the site. Without
// `rec` the s63b behaviour is unchanged.
function groupEnd(ts, j) {
  let depth = 0;
  for (let k = j; k < ts.length; k++) {
    if (ts[k].kind === "BeginGroup") depth++;
    else if (ts[k].kind === "EndGroup" && --depth === 0) return k;
  }
  return -1;
}
const stripGroup = (ts) => (ts.length && ts[0].kind === "BeginGroup" && groupEnd(ts, 0) === ts.length - 1 ? ts.slice(1, -1) : ts);
function argTokens(tokens, a, slot, dflt) {
  const opt = !!slot && slot.type === "optional";
  if (!a) return opt ? (Array.isArray(dflt) ? dflt.slice() : null) : [];
  if (opt && slot.close === null)                                   // embellishment: introducer, then a token or a group
    return a.braced ? tokens.slice(a.open + 2, a.close) : tokens.slice(a.open + 1, a.close + 1);
  if (opt || (slot && slot.type === "mandatory" && slot.open)) return stripGroup(tokens.slice(a.open + 1, a.close));
  return a.braced ? tokens.slice(a.open + 1, a.close) : tokens.slice(a.open, a.close + 1);
}
// Session 71 (HANDOFF 51.4, option A; Nicholas at INDEX). TeX drops the
// spaces after a command name — and one line end, and the next line's
// indent — when it READS a body, a default or an argument; the tokenizer
// keeps them so a file reprints exactly (gate T). texRead drops exactly the
// run skippedAfter names, after every control word, so the queue holds what
// TeX would. Applied to the body, and to each argument or default SEPARATELY:
// a space after #1 in a body is a real space in TeX and must stay
// (_work\_s71-fix-probe.txt, case ctl-param-space).
function texRead(ts) {
  const out = [];
  for (let k = 0; k < ts.length; k++) {
    out.push(ts[k]);
    if (ts[k].kind === "ControlWord") k = Math.max(k, skippedAfter(ts, k));
  }
  return out;
}
export function substitute(body, tokens, args, rec) {
  const out = [];
  body = texRead(body);
  for (let i = 0; i < body.length; i++) {
    const t = body[i], n = body[i + 1];
    if (t.kind === "Parameter" && n && n.kind === "Parameter") { out.push(n); i++; continue; }      // ## -> #
    if (t.kind === "Parameter" && n && n.kind === "Other" && /^[1-9]$/.test(n.text)) {           // #n
      const k = Number(n.text) - 1;
      const got = argTokens(tokens, args[k], rec && rec.params ? rec.params[k] : null, rec && rec.defaultOf ? rec.defaultOf[k] : undefined);
      if (got === null) return null;
      out.push(...texRead(got)); i++; continue;                                                // s71: an argument or default read as TeX reads it
    }
    out.push(t);
  }
  return out;
}

// ---- the expander ----------------------------------------------------------
// createExpander({ store, budget }) -> { expandAt(tokens, i, { file }) }.
// expandAt works ONE call site: the control word at tokens[i]. It returns
//   { kind: "leave" }                      the name is not the document's — not our site
//   { kind: "expanded", span, text, steps, emitted }   one edit for the invocation span
//   { kind: "refused",  span, finding, steps }         NO edit; the finding says why
// and never anything in between (invariant X1). `steps` is the list of
// per-token results, each { kind } from RESULT, so a fixture can tell a STATE
// from an EMIT when both leave the output empty (rule 91).
//
// The scratch store (E13, decision 5.4a): a copy-on-write overlay. Reads fall
// through to the real store; a definition met DURING the expansion writes
// the overlay only, which is discarded when the site ends.
//
// E17 (decision G2): the store holds the meaning at the END of the chain,
// so a name the chain defines more than once is refused rather than expanded
// with the wrong meaning — the probe's 12-not-22 case.
import { readDefinition, isDefinitionForm } from "./definition.mjs";

// ---- session 78: B and A (PLAN-7 §9 "Session 74" and "Session 77") -------
// B (INDEX, Nicholas: "B"): a \newlength or \newsavebox name is not a call.
// The store holds it as an opaque record with no body. As the site it is
// KEPT as written with one finding, expand/kept-not-a-call, naming the form;
// met inside an expansion it passes through as written. Counters are NOT in
// it: \newcounter's record is opaque too, but its form is not in this set.
// A (INDEX, Nicholas: "I go with "A", your recommendation."): a \newlength or
// \newsavebox statement met inside an expansion is emitted as written, and
// still recorded in scratch (E13), so its name then passes through by B.
const NOT_A_CALL = new Set(["newlength", "newsavebox"]);
const notACall = (rec) => !!rec && rec.kind === "opaque" && NOT_A_CALL.has(rec.form);

const END = Object.freeze({ kind: "EndFrame", text: "" });   // closes one expansion's frame on the queue

// ---- session 64: the core's helpers (PLAN-7 §9 "Session 64") ---------------
import { findMath, PANDOC_MATH_ENVS } from "./structure.mjs";

// Answer 2: "purely visual" is a result made of these, their arguments and
// spaces, and nothing else. The page-break commands are deliberately NOT here:
// a body that is one of them is expanded INTO the file, for a later toolchain.
// Nor, from session 69, are \linebreak and \nolinebreak (PLAN-7 §9 "Session
// 68" reading 1; Nicholas: "treated the same as the page break commands and
// written into the "-pp" file").
export const VISUAL_ONLY = Object.freeze(["hspace", "vspace", "hfill", "vfill", "smallskip",
  "medskip", "bigskip", "noindent"]);
const VISUAL = new Set(VISUAL_ONLY);
const MATH_ENVS = new Set(PANDOC_MATH_ENVS);

// Answer 1: does the token at ts[k] open or close math? Returns null, or
// { inMath, take } — take = how many tokens the delimiter spans ($$ is two;
// \begin{equation} is the whole group). Pandoc's delimiters and environments.
function mathTurn(ts, k, inMath) {
  const t = ts[k];
  if (!t) return null;
  if (t.kind === "MathShift") return { inMath: !inMath, take: ts[k + 1] && ts[k + 1].kind === "MathShift" ? 2 : 1 };
  if (t.kind === "ControlSymbol" && (t.name === "(" || t.name === "[")) return inMath ? null : { inMath: true, take: 1 };
  if (t.kind === "ControlSymbol" && (t.name === ")" || t.name === "]")) return inMath ? { inMath: false, take: 1 } : null;
  if (t.kind === "ControlWord" && (t.name === "begin" || t.name === "end")) {
    const g = ts[k + 1] && ts[k + 1].kind === "BeginGroup" ? groupEnd(ts, k + 1) : -1;
    if (g < 0 || ts.slice(k, g + 1).some((x) => x.kind === "EndFrame")) return null;
    if (!MATH_ENVS.has(ts.slice(k + 2, g).map((x) => x.text).join(""))) return null;
    if ((t.name === "begin") === inMath) return null;
    return { inMath: t.name === "begin", take: g - k + 1 };
  }
  return null;
}

// A visual command's own extent: \hspace(*){..}, \vspace(*){..}; the rest
// take nothing. -1 when malformed (then not visual). Session 69 removed the
// \linebreak[n] branch: neither line-break name is on VISUAL_ONLY any more.
function visualEnd(ts, k, name) {
  let j = k + 1;
  if (name === "hspace" || name === "vspace") {
    if (ts[j] && ts[j].kind === "Other" && ts[j].text === "*") j++;
    while (ts[j] && ts[j].kind === "Space") j++;
    return ts[j] && ts[j].kind === "BeginGroup" ? groupEnd(ts, j) : -1;
  }
  return k;
}

// E7 on the RESULT. Outside math only (math is MathJax's): every control word
// the table does not keep — "all", "some", or unlisted, which Pandoc's
// unknown-command fallback drops in running text — is listed as dropped; and
// the result is visual-only when it holds nothing but VISUAL commands.
function classify(ts, cap) {
  const dropped = [], visual = [];
  let inMath = false, onlyVisual = true, any = false;
  for (let k = 0; k < ts.length; k++) {
    const mt = mathTurn(ts, k, inMath);
    if (mt || inMath) { onlyVisual = false; if (mt) { inMath = mt.inMath; k += mt.take - 1; } continue; }
    const t = ts[k];
    if (t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment") continue;
    any = true;
    // Session 66, option B (Nicholas; PLAN-7 §9 "Session 66"). \begin and
    // \end are judged by the ENVIRONMENT they name: the table has no begin /
    // end rows (drops() would answer null, counted as dropped). Listed, as
    // written, only when that name's ENVIRONMENT rows say DROP; kept, math
    // and unknown environments (Pandoc keeps the body in a Div) are not. The
    // token and its name group are one non-visual item. No readable name:
    // falls through to the handling below, as before.
    if (t.kind === "ControlWord" && (t.name === "begin" || t.name === "end") && ts[k + 1] && ts[k + 1].kind === "BeginGroup") {
      const g = groupEnd(ts, k + 1);
      if (g >= 0 && !ts.slice(k, g + 1).some((x) => x.kind === "EndFrame")) {
        const env = ts.slice(k + 2, g).map((x) => x.text).join(""), w = "\\" + t.name + "{" + env + "}";
        if (cap && ["environment", "table_environment", "math_environment"].some((kind) => /^(all|some)$/.test(String(cap.drops(env, { kind }))))
            && !dropped.includes(w)) dropped.push(w);
        onlyVisual = false; k = g; continue;
      }
    }
    if (t.kind === "ControlWord") {
      if (cap && cap.drops(t.name) !== "none" && !dropped.includes("\\" + t.name)) dropped.push("\\" + t.name);
      if (VISUAL.has(t.name)) {
        const e = visualEnd(ts, k, t.name);
        if (e >= 0) { visual.push("\\" + t.name); k = e; continue; }
      }
    }
    onlyVisual = false;
  }
  return { dropped, visual, visualOnly: any && onlyVisual };
}

// The right edge (probe edge-right-*, probe2, probe3). After a call that ends
// at its own control word — no argument read, or only absent optionals — TeX
// skips the spaces, one line end, and the next line's leading spaces; never a
// blank line, which is a paragraph. Returns the index of the last token the
// call's span should cover. (After a READ argument TeX skips nothing: probe3.)
function skippedAfter(tokens, k) {
  let j = k + 1;
  while (tokens[j] && tokens[j].kind === "Space") j++;
  if (tokens[j] && tokens[j].kind === "Newline" && !tokens[j].parbreak) {
    let m = j + 1;
    while (tokens[m] && tokens[m].kind === "Space") m++;
    if (!(tokens[m] && tokens[m].kind === "Newline")) j = m;
  }
  return j - 1;
}

// s122 (HANDOFF 101.3 Q1 A, stop 3b-2a; Q5 A): TeX's reading of a blank line
// before \ifthenelse's ELSE, in the expander's queue ONLY. readArguments skips
// a blank line before a mandatory argument (E12) and chooseBranch takes the
// token after it as ELSE; pdflatex takes the blank line itself - its paragraph
// break, the second Newline of the pair - as ELSE (S1, S2; _work\_s114-probe.txt).
// So ELSE is that Newline, the call's span ends there, and what followed the
// blank line stays on the queue. s126 (Q5 A; HANDOFF 105.4 carried 2; Q1 A,
// Q2 A; _work\_s126-design.txt): a blank line before the test is TeX's test,
// so the call is refused, reason 12 (R6); exactly one blank line before THEN
// is TeX's THEN, the group E12 reads as THEN is its ELSE, the span ends there
// and E12's ELSE stays on the queue (S9). s136 (HANDOFF 113.2 Q1 A, 114.2,
// 115.3 A; _work\_s134-probe.txt, _work\_s135-probe.txt): two or more blank
// lines before THEN are TeX's THEN, the first, and its ELSE, the second; the
// span ends at the second and what followed it stays on the queue. With three
// or more, TeX's later paragraph breaks print nothing, and one is served (B3,
// compiled SAME beside its call at s135). chooseBranch, the -pp fold and the
// reader's seam are unchanged.
const IF_THREE = Object.freeze([{ type: "mandatory" }, { type: "mandatory" }, { type: "mandatory" }]);
function elseAtPar(q, c) {
  if (!c) return c;
  const r = readArguments(q, 1, IF_THREE);
  if (!r || !r.args || !r.args[0] || !r.args[1] || !r.args[2]) return c;
  const par = (a, b) => { for (let k = a; k < b; k++) if (q[k].kind === "Newline" && q[k].parbreak) return k; return -1; };
  if (par(1, r.args[0].open) >= 0) return Object.assign({}, c, { parTest: true });   // s126, R6: refused in the queue, reason 12
  const kT = par(r.args[0].close + 1, r.args[1].open);
  if (kT >= 0) {                                     // s126, S9: THEN is the blank line, ELSE E12's THEN group
    const kE = par(kT + 1, r.args[1].open);          // s136 (113.2 Q1 A): THEN the first blank line, ELSE the second
    if (kE >= 0) return Object.assign({}, c, { close: kE, keep: c.value === "T" ? [kT, kT] : [kE, kE] });
    const a = r.args[1], e = a.braced ? [a.open + 1, a.close - 1] : [a.open, a.close];
    return Object.assign({}, c, { close: a.close, keep: c.value === "T" ? [kT, kT] : (e[0] > e[1] ? null : e) });
  }
  const k = par(r.args[1].close + 1, r.args[2].open);
  return k < 0 ? c : Object.assign({}, c, { close: k, keep: c.value === "T" ? c.keep : [k, k] });
}

// ---- s123, 3b-2b (HANDOFF 99.3 part 4; 93.6 A, decided 93.7): the edge rule ----
// In the expander only (99.3 Q3 A): the -pp fold, chooseBranch and the seam are
// unchanged. A JOINT is a run of whitespace between two pieces of content in what
// the expander writes: a fold's two edges, (a) and (b), and a served text's two,
// (c) and (d). Its PLACES are its stretches of source-adjacent tokens; each is read
// as TeX read it in its own place, from the state after its source predecessor
// (sim, as _work\_s114_probe.mjs), TeX's outcome the largest. Where the joined run
// reads otherwise it is rewritten in 93.5.2's form, a comment kept where the form
// has a %; where no such form reads as TeX (a space after a control word) the
// call is refused. A token the rule writes carries the state it was read from.
const isWS = (t) => !!t && (t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment");
const stAfter = (t) => (!t ? "N" : t.kind === "ControlWord" || (t.kind === "ControlSymbol" && t.name === " ") ? "S" : t.kind === "Newline" ? "N" : "M");
const stFrom = (prev, t) => (!t ? "M" : t.st0 ? t.st0 : prev && !isWS(prev) && prev.end === t.start ? stAfter(prev)
  : t.kind === "Newline" && t.parbreak ? "N" : "M");
const synth = (text, st0) => ({ kind: "Space", text, st0 });
const JOINT_WHY = "a joint of its served text cannot be written to read as TeX reads it (a space after a control word)";
function simSt(piece, st) {        // -> [0 nothing | 1 space | 2 paragraph | 3 not whitespace, the state after]
  let out = 0;
  for (let i = 0; i < piece.length; i++) {
    const c = piece[i];
    if (c === "%") { const j = piece.indexOf("\n", i); if (j < 0) return [out, st]; i = j; st = "N"; continue; }
    if (c === " " || c === "\t") { if (st === "M") { out = Math.max(out, 1); st = "S"; } continue; }
    if (c === "\r") continue;
    if (c === "\n") { if (st === "N") out = 2; else if (st === "M") out = Math.max(out, 1); st = "N"; continue; }
    return [3, st];
  }
  return [out, st];
}
const sim = (piece, st) => simSt(piece, st)[0];
function texOf(parts) {            // parts: [[tokens, the state at the first], ...] -> TeX's outcome, the largest
  let T = 0;
  for (const [J, st] of parts)
    for (let k = 0, m; k < J.length; k = m) {
      for (m = k + 1; m < J.length && !J[m].st0 && J[m - 1].end !== undefined && J[m - 1].end === J[m].start; m++);
      T = Math.max(T, sim(textOf(J.slice(k, m)), k ? stFrom(null, J[k]) : st));
    }
  return T;
}
function rewriteJoint(parts) {     // (a), (b), (ab): false - reads as TeX; a token - rewritten; null - refuse
  const J = parts.flatMap((p) => p[0]);
  if (!J.length) return false;
  const s0 = parts.find((p) => p[0].length)[1], jt = textOf(J), T = texOf(parts);
  if (sim(jt, s0) === T) return false;
  const nl = jt.lastIndexOf("\n"), ind = nl < 0 ? "" : jt.slice(nl + 1).match(/^[ \t]*/)[0], cm = jt.match(/%[^\r\n]*/g) || [];
  const f = T === 0 ? (cm.length ? cm : ["%"]).join("\n" + ind) + "\n" + ind : T === 1 ? " \n" + ind : "\n\n" + ind;
  return sim(f, s0) === T ? synth(f, s0) : null;
}
function rewriteEdge(piece, s, doc, sDoc, atEnd) {   // (c), (d): false; [] or [token] for the served side; null
  const own = texOf([[piece, s]]), T = Math.max(own, sim(doc, sDoc)), pt = textOf(piece);
  if ((atEnd ? sim(pt + doc, s) : sim(doc + pt, sDoc)) === T) return false;
  const f = ["", " ", "\n\n"][own];
  if ((atEnd ? sim(f + doc, s) : sim(doc + f, sDoc)) !== T) return null;
  return f ? [synth(f, s)] : [];
}

const MATH_CACHE = new WeakMap();
const mathSpansOf = (tokens) => {
  let s = MATH_CACHE.get(tokens);
  if (!s) { s = findMath(tokens); MATH_CACHE.set(tokens, s); }
  return s;
};

// ---- session 70: the math connection (PLAN-7 §9 "Session 69", option B) ----
// Where expansion meets math - a call that sits inside math, and math an
// expansion opens - the expander asks a math handler what to do, so a later
// math module can plug in there, apart from the text rules. The default does
// exactly what the expander did before the connection existed. The answers:
//   atCall({ tokens, i, file, site, name, rec, math, span }) ->
//     { action: "keep" } | { action: "rewrite", text } | { action: "refuse", rule, what, level?, detail? }
//   inExpansion({ stretch, closed, file, site, name }) ->
//     { action: "emit", tokens } | { action: "refuse", rule, what, level?, detail? }
// Any other answer, or a throw, refuses the whole call under
// expand/refused-math-handler, the author's text untouched (invariant X1).
export const DEFAULT_MATH_HANDLER = Object.freeze({
  name: "kept-as-written",
  atCall: () => ({ action: "keep" }),
  inExpansion: ({ stretch }) => ({ action: "emit", tokens: stretch }),
});

export function createExpander({ store, budget, capability, math, flags, counters } = {}) {
  const B = Object.assign({}, DEFAULT_BUDGET, budget || {});
  const IF = ifThenState(flags || {});      // s120, 3b-1 part 1: the fold's three-valued state; absent, every flag unknown
  const counterOpt = typeof counters === "function" ? counters : null;   // s146, 3c-3 p3 (119.3 Q1 A): counters(written, place); absent (or not a function): nothing asked
  const cap = capability || null;            // absent: nothing is classified as dropped
  const M = math || DEFAULT_MATH_HANDLER;    // session 70: absent -> the default, today's behaviour
  const definedTimes = (name) => (store && store.events ? store.events.filter((e) => e.type === "define" && e.name === name).length : 0);

  function expandAt(tokens, i, { file = "?" } = {}) {
    const site = siteOf(file, tokens, i);
    const top = tokens[i];
    const steps = [], emitted = [];
    const scratch = new Map();
    const lookup = (name) => (scratch.has(name) ? scratch.get(name) : (store ? store.lookup(name) : undefined));
    if (!top || top.kind !== "ControlWord" || !lookup(top.name)) return { kind: "leave", span: null };

    let span = null, expansions = 0, depth = 0;
    // s120, 3b-1 part 5, reason (7): any OTHER refusal of a call that holds an
    // \ifthenelse - met by the decider in this call, still on the queue, or in
    // its definition's body - carries detail.reason 7 beside the expander's own
    // rule (64.5: the call refused for another reason, citing the expander's).
    // Not refused-ifthen, which has its own reason; not today's refusal of an
    // \ifthenelse whose arguments cannot be read in the queue (token \ifthenelse).
    let metIf = false, argSet = new Set();
    const holdsIf = () => metIf || (Array.isArray(q) && q.some(isIfthen)) ||
      (() => { const d = lookup(top.name); return !!d && Array.isArray(d.body) && d.body.some(isIfthen); })();
    const refuse = (rule, level, what, detail) => ({
      kind: "refused", span, steps,
      finding: { rule, level, file, span, detail: Object.assign({ site, name: top.name, depth },
          rule !== "expand/refused-ifthen" && !(detail && detail.token === "\\ifthenelse") && holdsIf() ? { reason: 7 } : {}, detail),
        message: site + " — left \\" + top.name + " alone: " + what + " [" + rule + "]" },
    });

    // The queue holds the tokens still to be looked at; the call's own
    // arguments are read from the SOURCE array first, so the span is exact.
    // KEPT (s64): the author's text left exactly as written ON PURPOSE — a
    // math site (answer 1) or a purely visual result (E7) — with one finding.
    const keep = (rule, what, detail) => ({
      kind: "kept", span, steps,
      finding: { rule, level: "unsupported", file, span, detail: Object.assign({ site, name: top.name }, detail),
        message: site + " — kept \\" + top.name + " as written: " + what + " [" + rule + "]" },
    });
    // Session 70: a math handler's refusal becomes the expander's own, naming
    // the handler; any answer the expander cannot use refuses the whole call.
    const fromHandler = (a, at) => (a && a.action === "refuse" && typeof a.rule === "string" && a.rule
      ? refuse(a.rule, typeof a.level === "string" ? a.level : "unsupported", String(a.what || "the math handler refused it"),
          Object.assign({}, a.detail, { handler: M.name, at }))
      : refuse("expand/refused-math-handler", "unsupported",
          "the math handler \"" + M.name + "\" gave an answer the expander cannot use", { handler: M.name, at }));

    let q, r0, inMath = false;
    {
      const rec = lookup(top.name);
      const m = mathSpansOf(tokens).find((s) => s.start <= top.start && top.end <= s.end);
      if (m) {                                    // answer 1: inside math, the math pipeline's
        const ra = Array.isArray(rec.params) ? readArguments(tokens, i + 1, rec.params) : null;
        span = { start: top.start, end: ra ? tokens[ra.next - 1].end : top.end };
        // Session 70, the math connection: the handler decides. The default
        // answers "keep", which is exactly this site's result before it.
        let a; try { a = M.atCall({ tokens, i, file, site, name: top.name, rec, math: m, span }); } catch (e) { a = null; }
        if (a && a.action === "keep") return keep("expand/kept-math", "it sits inside math, left as written for the math pipeline", { math: m.kind });
        if (a && a.action === "rewrite" && typeof a.text === "string")
          return { kind: "expanded", span, text: a.text, steps, emitted: [], expansions: 0, rule: "expand/expanded-math",
                   detail: { site, name: top.name, dropped: [], redefines: null, handler: M.name } };
        return fromHandler(a, "call");
      }
      if (definedTimes(top.name) > 1)
        return refuse("expand/refused-redefined", "undecidable",
          "the chain defines it " + definedTimes(top.name) + " times, so which meaning this use carries cannot be known here",
          { definitions: definedTimes(top.name) });
      const r = Array.isArray(rec.params) ? readArguments(tokens, i + 1, rec.params) : { args: [], next: i + 1 };
      if (!r) { span = { start: top.start, end: top.end }; return refuse("expand/refused-unreadable", "author-error", "its arguments cannot be read by its own definition", {}); }
      span = { start: top.start, end: tokens[r.next - 1].end };
      if (notACall(rec)) return keep("expand/kept-not-a-call", "it is a \\" + rec.form + " name, not a command with a body", { form: rec.form });   // B (s78)
      if (!Array.isArray(rec.body)) return refuse("expand/refused-unmodelled", "unsupported", "its definition has no body the expander can expand", { token: "\\" + top.name });
      depth = 1; expansions = 1; r0 = r;
      argSet = new Set(tokens.slice(i + 1, r.next));   // s120, (10) by origin: the call's own argument tokens, by identity
      const sub = substitute(rec.body, tokens, r.args, rec);
      if (!sub) return refuse("expand/refused-unmodelled", "unsupported",
        "an optional argument is absent and its definition gives no default (xparse's -NoValue- is not modelled)", { token: "\\" + top.name });
      q = sub.concat([END]);
      steps.push({ kind: RESULT.INPUT, name: top.name });
    }

    // ---- s146, 3c-3 p4 (HANDOFF 124.4; 119.3; 125.2's reading): the queue's
    // decider, handed to chooseBranch (p5); the fold's decideTest is unchanged.
    // Per test: (a) a Parameter token, or a token holding # other than the
    // control symbol \#: unknown, as today (122.5 (i)), nothing asked. (b) each
    // counter command - \the<counter>, or a reader of 119.2's list with its one
    // argument by readArguments - as written, asked through `counters` once per
    // call, the answer kept across the call's tests; a string answer put where
    // the command stood; any other answer: the test unknown, not evaluated
    // (119.3 Q3 A), its reason kept for p5; option absent: nothing asked, the
    // command left as written. (c) the test's text rebuilt from its tokens, a
    // brace group that is an operand of \AND/\and or follows \NOT/\not written
    // \(...\), inside such groups too, found by brace depth over BeginGroup and
    // EndGroup tokens, never by pattern (122.5 (ii)); \OR not included. (d)
    // lib's evalTest on that text, with the expander's flag state.
    const asked = new Map();                         // written -> the option's answer, once per call
    let decided = null;                              // the last test's { counter, answered }, read by p5
    const ONE_ARG = [{ type: "mandatory" }];
    const isCW = (x, names) => !!x && x.kind === "ControlWord" && names.includes(x.name);
    const OPS = ["AND", "and", "OR", "or", "NOT", "not"], AND_NOT = ["AND", "and", "NOT", "not"], AND = ["AND", "and"];
    const txt = (x) => (x && typeof x.text === "string" ? x.text : "");
    function decideQ(ts, from, to, state) {
      decided = { counter: null, answered: new Set() };
      const test = from > to ? "" : ts.slice(from, to + 1).map(txt).join("");
      for (let k = from; k <= to; k++)                                   // (a): \# is not a parameter
        if (ts[k].kind === "Parameter" || (txt(ts[k]).includes("#") && !(ts[k].kind === "ControlSymbol" && ts[k].name === "#")))
          return { value: "U", why: "parameter", test };
      const put = new Map();                                             // (b): a command's index -> [its last index, the answer]
      for (let k = from; k <= to; k++) {
        const x = ts[k];
        if (!x || x.kind !== "ControlWord" || !isCounterReader(x.name)) continue;
        let end = k;
        if (COUNTER_READERS.has(x.name)) {
          const r = readArguments(ts, k + 1, ONE_ARG);
          if (!r || !r.args || r.next - 1 > to) continue;
          end = r.next - 1;
        }
        if (!counterOpt) { k = end; continue; }
        const written = ts.slice(k, end + 1).map(txt).join("");
        if (!asked.has(written)) {
          let a; try { a = counterOpt(written, { file, i, site }); } catch (e) { a = { reason: "the counters option threw: " + String(e && e.message) }; }
          asked.set(written, a);
        }
        const a = asked.get(written);
        if (typeof a === "string") { put.set(k, [end, a]); for (let j = k; j <= end; j++) decided.answered.add(ts[j]); }
        else if (!decided.counter) decided.counter = { written, reason: a && typeof a === "object" && "reason" in a ? a.reason : null };
        k = end;
      }
      if (decided.counter) return { value: "U", why: "counter", test };
      const conv = new Map();                                            // (c): a converted group's brace index -> \( or \)
      const level = (a, b) => {                                          // one level of the test; a primary may start at a
        let prev = null;
        for (let k = a; k <= b; k++) {
          const x = ts[k];
          if (isWS(x)) continue;
          if (x.kind === "BeginGroup") {
            let e = -1;
            for (let d = 0, j = k; j <= b; j++) { if (ts[j].kind === "BeginGroup") d++; else if (ts[j].kind === "EndGroup" && --d === 0) { e = j; break; } }
            if (e < 0) return;
            let n = e + 1; while (n <= b && isWS(ts[n])) n++;
            const starts = prev === null || isCW(prev, OPS) || (prev.kind === "ControlSymbol" && prev.name === "(");
            if (starts && (isCW(prev, AND_NOT) || (n <= b && isCW(ts[n], AND)))) { conv.set(k, "\\("); conv.set(e, "\\)"); level(k + 1, e - 1); }
            prev = ts[e]; k = e; continue;
          }
          prev = x;
        }
      };
      level(from, to);
      let text = "";                                                     // the rebuilt text
      for (let k = from; k <= to; k++) {
        if (put.has(k)) { const [e, s] = put.get(k); text += s; k = e; continue; }
        text += conv.has(k) ? conv.get(k) : txt(ts[k]);
      }
      let v = "U";                                                       // (d)
      try { v = evalTest(text, state); } catch { v = "U"; }
      return { value: v, why: v === "U" ? "test" : null, test };
    }

    while (q.length) {
      if (q.length > B.queue) return refuse("expand/refused-budget", "unsupported",
        "its expansion grew the working queue past " + B.queue + " tokens — deep, not necessarily broken", { budget: "queue", limit: B.queue });
      const t = q[0];
      if (t === END) { depth--; q = q.slice(1); continue; }
      // Answer 1, inside an expansion: math the expansion itself opens is the
      // math pipeline's too — every token in it is emitted as written and
      // nothing in it is expanded (\Rs -> $\R$, not $\mathbb{R}$).
      // Session 70, the math connection: the stretch from the opening sign to
      // the closing one (or to the queue's end: `closed` false) goes to the
      // math handler, frame ends taken out and counted exactly as before. The
      // default hands it back, so the emitted tokens and steps are unchanged.
      const mt = inMath ? null : mathTurn(q, 0, false);
      if (mt) {
        const stretch = [];
        let j = 0, closed = false;
        while (j < mt.take) stretch.push(q[j++]);
        while (j < q.length) {
          if (q[j] === END) { depth--; j++; continue; }
          const ct = mathTurn(q, j, true);
          if (ct) { for (let k = 0; k < ct.take; k++) stretch.push(q[j++]); closed = true; break; }
          stretch.push(q[j++]);
        }
        let a; try { a = M.inExpansion({ stretch: stretch.slice(), closed, file, site, name: top.name }); } catch (e) { a = null; }
        if (!(a && a.action === "emit" && Array.isArray(a.tokens) && a.tokens.every((x) =>
              x && typeof x.kind === "string" && x.kind !== "EndFrame" && typeof x.text === "string"))) return fromHandler(a, "expansion");
        for (const x of a.tokens) { emitted.push(x); steps.push({ kind: RESULT.EMIT }); }
        q = q.slice(j); inMath = !closed; continue;
      }
      if (t.kind !== "ControlWord") { emitted.push(t); steps.push({ kind: RESULT.EMIT }); q = q.slice(1); continue; }

      if (isDefinitionForm(t.name)) {                       // E13: executed into scratch, nothing emitted
        const d = readDefinition(q, 0);
        if (!d || !d.def) return refuse("expand/refused-unmodelled", "unsupported", "a definition inside its body could not be read", { token: "\\" + t.name });
        scratch.set(d.def.name, d.def);
        steps.push({ kind: RESULT.STATE, name: d.def.name });
        if (notACall(d.def))                                // A (s78): this statement is also emitted as written
          for (let k = 0; k <= d.close; k++) { if (q[k] === END) { depth--; continue; } emitted.push(q[k]); steps.push({ kind: RESULT.EMIT }); }
        q = q.slice(d.close + 1); continue;
      }
      if (isIfthen(t)) {                                    // s120, 3b-1 part 2: the fold's decider, in the queue
        const c = elseAtPar(q, chooseBranch(q, 0, IF, decideQ));     // s122, 3b-2a: a blank line before ELSE read as TeX does; s146, 3c-3 p5: the queue's decider (p4)
        if (c && !q.slice(0, c.close + 1).includes(END)) {   // else today's refusal, just below
          metIf = true;
          if (IFTHEN_MARKUP.some((n) => { const d = lookup(n); return !!d && Array.isArray(d.body) && d.body.includes(t); }))
            return refuse("expand/refused-ifthen", "unsupported", "an \\ifthenelse in its expansion: " + IFTHEN_WHY[9] + " (reason 9)", { reason: 9 });
          if (c.parTest)                                     // s126 (Q5 A, Q2 A): TeX's test is the blank line - R6
            return refuse("expand/refused-ifthen", "undecidable", "an \\ifthenelse in its expansion: " + IFTHEN_WHY[12] + " (reason 12)", { reason: 12 });
          if (c.value === "U" && c.why === "counter")        // s146, 3c-3 p5 (119.3 Q3 A): an answer unknown - reason 1, the answer's reason in the detail
            return refuse("expand/refused-ifthen", "undecidable", "an \\ifthenelse in its expansion: " + IFTHEN_WHY[1] + " (reason 1)", { reason: 1, counter: decided.counter });
          if (c.value === "U") {
            const n = ifthenReason(q, c, lookup, argSet, decided ? decided.answered : null);
            return refuse("expand/refused-ifthen", "undecidable", "an \\ifthenelse in its expansion: " + IFTHEN_WHY[n] + " (reason " + n + ")", { reason: n });
          }
          // s123, 3b-2b (93.6 A; 99.3 part 4): the fold's two edges - (a) what was written
          // since the last content with the kept branch's head, (b) its tail with the
          // queue's whitespace after the span, to the next content or the body's end; a
          // branch of whitespace only is one joint (ab). Unchanged where it reads as TeX.
          let kept = c.keep ? q.slice(c.keep[0], c.keep[1] + 1) : [], rest = q.slice(c.close + 1);
          let e0 = emitted.length, a = 0, fi = 0, la = kept.length;
          while (e0 > 0 && isWS(emitted[e0 - 1])) e0--;
          while (a < rest.length && isWS(rest[a])) a++;
          while (fi < kept.length && isWS(kept[fi])) fi++;
          while (la > fi && isWS(kept[la - 1])) la--;
          const ab = fi === kept.length, L = emitted.slice(e0), A = rest.slice(0, a);
          const pL = [L, stFrom(emitted[e0 - 1], L[0])], pA = [A, stFrom(q[c.close], A[0])];
          const xa = rewriteJoint(ab ? [pL, [kept, stFrom(null, kept[0])], pA] : [pL, [kept.slice(0, fi), stFrom(null, kept[0])]]);
          const xb = ab ? false : rewriteJoint([[kept.slice(la), stFrom(kept[la - 1], kept[la])], pA]);
          if (xa === null || xb === null)
            return refuse("expand/refused-joint", "unsupported", JOINT_WHY, { joint: xa === null ? (ab ? "ab" : "a") : "b" });
          if (xb) { kept = kept.slice(0, la).concat([xb]); rest = rest.slice(a); }
          if (xa) { emitted.length = e0; emitted.push(xa); kept = ab ? [] : kept.slice(fi); if (ab) rest = rest.slice(a); }
          q = kept.concat(rest);
          steps.push({ kind: RESULT.INPUT, name: "ifthenelse" });
          continue;
        }
      }
      if (UNMODELLED.has(t.name)) return refuse("expand/refused-unmodelled", "unsupported",
        "\\" + t.name + " appears in its expansion and is not yet modelled", { token: "\\" + t.name });

      const rec = lookup(t.name);
      if (!rec) { emitted.push(t); steps.push({ kind: RESULT.EMIT }); q = q.slice(1); continue; }   // not the document's: Pandoc's business
      if (definedTimes(t.name) > 1 && !scratch.has(t.name))
        return refuse("expand/refused-redefined", "undecidable", "\\" + t.name + " in its expansion is defined " + definedTimes(t.name) + " times in the chain", { definitions: definedTimes(t.name), token: "\\" + t.name });
      if (rec.kind === "alias" && Array.isArray(rec.body)) { q = rec.body.concat(q.slice(1)); steps.push({ kind: RESULT.INPUT, name: t.name }); continue; }
      if (notACall(rec)) { emitted.push(t); steps.push({ kind: RESULT.EMIT }); q = q.slice(1); continue; }   // B (s78): passes through as written
      if (!Array.isArray(rec.body)) return refuse("expand/refused-unmodelled", "unsupported", "\\" + t.name + " in its expansion has no body the expander can expand", { token: "\\" + t.name });
      const r = Array.isArray(rec.params) ? readArguments(q, 1, rec.params) : { args: [], next: 1 };
      if (!r) return refuse("expand/refused-unreadable", "author-error", "the arguments of \\" + t.name + " in its expansion cannot be read", { token: "\\" + t.name });
      if (++expansions > B.expansions) return refuse("expand/refused-budget", "unsupported",
        "its expansion passed " + B.expansions + " rounds — deep, not necessarily broken", { budget: "expansions", limit: B.expansions });
      depth++;
      const sub = substitute(rec.body, q, r.args, rec);
      if (!sub) return refuse("expand/refused-unmodelled", "unsupported",
        "an optional argument of \\" + t.name + " in its expansion is absent with no default (xparse's -NoValue- is not modelled)", { token: "\\" + t.name });
      q = sub.concat([END], q.slice(r.next));
      steps.push({ kind: RESULT.INPUT, name: t.name });
    }
    // ---- E7 on the RESULT (PLAN-7 §4 E7; §9 "Session 64", answers 1-3) ----
    // Answer 3: a call whose own name the table DROPS is tracked whatever its
    // result. Purely visual -> kept, one finding (carrying `redefines` too).
    const c = classify(emitted, cap);
    const redefines = cap && /^(all|some)$/.test(String(cap.drops(top.name))) ? "\\" + top.name : null;
    if (c.visualOnly) return keep("expand/kept-visual-only", "its expansion is purely visual layout (" + c.visual.join(" ") + ")", { redefines, visual: c.visual });

    // ---- the two edges (probe edge-*, probe2, probe3) ----------------------
    let endIdx = r0.next - 1;
    if (r0.next === i + 1) endIdx = skippedAfter(tokens, endIdx);
    span = { start: top.start, end: tokens[endIdx].end };
    // s123, 3b-2b (93.6 A; 99.3 part 4): the served text's two edges against the
    // document, (c) after and (d) before; only the served side is rewritten. The
    // document after is read from the state after the span (after a read argument,
    // its last token's; with none read, after the skipped run, read from S). A
    // served text with no content is left as before (carried).
    let f0 = 0, l0 = emitted.length, p0 = i, d0 = endIdx + 1;
    while (f0 < emitted.length && isWS(emitted[f0])) f0++;
    if (f0 < emitted.length) {
      while (isWS(emitted[l0 - 1])) l0--;
      while (p0 > 0 && isWS(tokens[p0 - 1])) p0--;
      while (d0 < tokens.length && isWS(tokens[d0])) d0++;
      const sD = r0.next === i + 1 ? simSt(textOf(tokens.slice(i + 1, endIdx + 1)), "S")[1] : stAfter(tokens[endIdx]);
      const xc = rewriteEdge(emitted.slice(l0), stFrom(emitted[l0 - 1], emitted[l0]), textOf(tokens.slice(endIdx + 1, d0)), sD, true);
      const xd = rewriteEdge(emitted.slice(0, f0), stFrom(null, emitted[0]), textOf(tokens.slice(p0, i)), stAfter(tokens[p0 - 1]), false);
      if (xc === null || xd === null)
        return refuse("expand/refused-joint", "unsupported", JOINT_WHY, { joint: xc === null ? "c" : "d" });
      if (xc) emitted.splice(l0, emitted.length - l0, ...xc);
      if (xd) emitted.splice(0, f0, ...xd);
    }
    let text = joinTokens(emitted);
    const last = emitted[emitted.length - 1], after = tokens[endIdx + 1], before = tokens[i - 1];
    if (last && last.kind === "ControlWord" && isLetter(after)) text += " ";            // \emph|beta
    if (before && before.kind === "ControlWord" && /^[A-Za-z]/.test(text.length ? text : (after ? after.text : "")))
      text = " " + text;                                                                 // \relax|X
    const rule = !emitted.length ? "expand/removed-empty"
      : redefines ? "expand/expanded-redefines-dropped"
      : c.dropped.length ? "expand/expanded-pandoc-drops" : "expand/expanded";
    return { kind: "expanded", span, text, steps, emitted, expansions, rule,
             detail: { site, name: top.name, dropped: c.dropped, redefines } };
  }
  return { expandAt, budget: B };
}

// The consumer's half of invariant X1: an expanded site becomes its text;
// a refused or left site returns the author's text BYTE-IDENTICAL.
export function applyExpansion(text, r) {
  if (!r || r.kind !== "expanded" || !r.span) return text;
  return text.slice(0, r.span.start) + r.text + text.slice(r.span.end);
}
