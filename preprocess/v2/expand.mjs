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
export const lineOf = (tokens, k) => {
  let n = 1;
  for (let i = 0; i < k && i < tokens.length; i++) if (tokens[i].kind === "Newline") n++;
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

export function createExpander({ store, budget, capability, math } = {}) {
  const B = Object.assign({}, DEFAULT_BUDGET, budget || {});
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
    const refuse = (rule, level, what, detail) => ({
      kind: "refused", span, steps,
      finding: { rule, level, file, span, detail: Object.assign({ site, name: top.name, depth }, detail),
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
      const sub = substitute(rec.body, tokens, r.args, rec);
      if (!sub) return refuse("expand/refused-unmodelled", "unsupported",
        "an optional argument is absent and its definition gives no default (xparse's -NoValue- is not modelled)", { token: "\\" + top.name });
      q = sub.concat([END]);
      steps.push({ kind: RESULT.INPUT, name: top.name });
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
