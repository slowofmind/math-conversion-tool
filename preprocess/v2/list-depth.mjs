// v2/list-depth.mjs — session 250. The counter module's first piece: how
// deeply each place sits in nested lists (COUNTERS-LISTS-BRIEF.md, the
// list-depth design, HANDOFF 163.2-183.3; LISTS-PLAN-s249.md step 1).
// Session 251 adds the second piece, the number and marker at each \item
// (step 2; the arithmetic is in list-numbers.mjs).
//
// Plain terms: LaTeX keeps two kinds of count. The OVERALL count (\@listdepth)
// is how many lists are open, of any kind: it sets the indent, and the seventh
// is refused ("Too deeply nested"). Each KIND of list also has its OWN count
// (enumerate's \@enumdepth, itemize's \@itemdepth, enumitem's description and
// every \newlist name): it picks the marker style at that level. At every
// \item this piece records both, and which list the \item belongs to.
//
// The rules, each pinned by pdflatex (v2/test/list-depth-cases.mjs, run by
// _work/_s250_depth.mjs, 85 of 85 held):
// - An environment adds one overall when it reaches \list (enumerate, itemize,
//   description, quote, quotation, verse, thebibliography, a \newlist list);
//   \trivlist adds nothing (center, flushleft, flushright, theorems, proof).
// - The overall step is refused past 6 (kernel \list: \@listdepth > 5); the
//   kind's own step is checked first, against 4 for enumerate and itemize and
//   against a \newlist's third argument. A refused own step opens no list at
//   all; a refused overall step still opens the list, and its \end takes one
//   off the overall count anyway (kernel \endlist) — measured, l6 and l7.
// - The own counts are local: put back at the list's \end. The overall count
//   is changed globally, which matters only inside minipages:
// - A minipage points the overall count at one shared minipage count, set to
//   zero. Its end puts the old value back only if no list changed that count
//   in between (TeX's save stack keeps a global value) — the open question of
//   a minipage inside a minipage (185.4), settled by d3 and e2.
// - The abstract goes by class and options: article adds one unless
//   [titlepage] or [twocolumn]; report adds one only with [notitlepage] (and
//   one column); amsart always adds one; any other class is "at least".
// - An author's environment is followed through the definition in force where
//   its \begin sits (the store's own record); \begin{x}, \x for a known list,
//   \list, \trivlist and the author's own commands inside it are followed. A
//   conditional, a #-argument or an environment the tool has no code for
//   makes the place "at least" what is counted, with a finding. A condition
//   that opens no list or trivlist leaves the count as it is.
// - \let copies are followed to what they copy. comment, and a \let copy of
//   it (\let\solution=\comment, Math Ma/Mb), prints nothing: its items are
//   recorded as hidden.
//
// The numbers (s251), pinned by pdflatex (v2/test/list-numbers-cases.mjs, run
// by _work/_s251_numbers.mjs, 135 of 135 held; M1-M12 of s249 among them):
// - Every numbered list (enumerate, enumerate*, a \newlist of type enumerate)
//   starts at start= (default 1) unless it resumes. A plain \item adds one and
//   prints the label; \item[x] prints x and adds nothing; \item[] prints nothing.
//   An author's command with no arguments and no condition whose body makes
//   items (\plainitem, \circleitem, \calcitem's \refstepcounter + \item[..])
//   is run step by step at the command (the walk's fallback hook); its items
//   are recorded with `via`, and \labelenumi in their marker is the label now.
// - The label: the list's own label= (or a short form such as (a) as the FIRST
//   option, with shortlabels), else the one resume* carries, else \setlist for
//   that name and level, then for that name, then for that level, then for all
//   lists, else the level default 1. (a) i. A. enumerate* takes enumerate's
//   \setlist. \setlist* adds keys; \setlist replaces them; both end with
//   their group. \setenumerate[n] is \setlist[enumerate,n].
// - resume carries on from the list of the same environment name that ENDED
//   last, at any level; that count is kept only until the group around the
//   list closes (a list inside {...} or inside an author's wrapper environment
//   leaves nothing outside it). enumerate* has its own chain; a \let copy goes
//   by its own name. resume=name / series=name carry a series, kept past any
//   group. resume* also takes the label. \setcounter between lists is ignored.
// - The tool cannot be sure — and the list is left alone and reported — when
//   the count changes mid-list (\setcounter, \addtocounter, \stepcounter,
//   \refstepcounter on its counter, or an author's command that holds one or
//   holds \item in a way the tool does not follow), when resume and start=
//   are written together, when an option
//   or label is one it does not read, when the list opens inside a command's
//   argument or its \begin and \end are not in the same group or file, when
//   an environment around it is "at least", and when it resumes a list the
//   tool could not follow.
//
// The piece counts during the reading (177.4): the reader calls begin() from
// its \begin hook, before the walk opens the frame, and end() from its \end
// hook before the walk closes it; the "put back" steps ride on the store's
// frames (store.onClose, 180.3).
// Not built yet (carried): \setlistdepth and \renewlist limits, \ifthenelse
// branches (179.3), \restartlist, label*=, \setlist with resume or series.

import { HIDING_ENVS } from "./store.mjs";
import { readGroup, readBracket } from "./structure.mjs";
import { readOptions, analyzeLabel, formatCount, counterChanges, DEFAULT_LABELS, counterName, splitKeys } from "./list-numbers.mjs";

const finding = (rule, level, span, file, message, detail) =>
  ({ rule, channel: "attention", level, kind: "literal", file: file ?? null, span: span || null, message, detail: detail || {} });

// Built-in environments. own: the kind whose own count it steps; limit: the
// own count past which LaTeX refuses it.
const LISTS = new Map([
  ["enumerate", { own: "enumerate", limit: 4 }], ["itemize", { own: "itemize", limit: 4 }],
  ["description", { own: null }], ["quote", { own: null }], ["quotation", { own: null }],
  ["verse", { own: null }], ["thebibliography", { own: null }], ["list", { own: null }],
]);
const TRIVLISTS = new Set(["center", "flushleft", "flushright", "trivlist", "proof", "tabbing"]);
// Environments that leave both counts as they are and hold no list machinery
// of their own (s182: \parbox, p-columns, figures, sloppypar, align keep the
// count). Anything not here, not built in and not in the store is "at least".
const NEUTRAL = new Set(["document", "figure", "figure*", "table", "table*", "tabular", "tabular*", "tabularx",
  "array", "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline",
  "multline*", "flalign", "flalign*", "split", "cases", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix",
  "smallmatrix", "aligned", "gathered", "displaymath", "math", "eqnarray", "eqnarray*", "subequations",
  "multicols", "multicols*", "tikzpicture", "picture", "titlepage", "sloppypar", "small", "footnotesize",
  "scriptsize", "tiny", "large", "Large", "LARGE", "huge", "Huge", "normalsize", "bfseries", "itshape",
  "verbatim", "verbatim*", "lstlisting", "minted", "frame", "columns", "column"]);
const MAX_FOLLOW = 12;
// s251: a braced group after these is not a choice of what runs: \item takes
// no braced argument, and the font commands always print their argument.
const PLAIN_GROUP = new Set(["item", "emph", "textbf", "textit", "textrm", "textsf", "texttt", "textup", "textsc", "underline", "mbox"]);

// #1..#9 in tokens replaced by the author's arguments; null when one is missing.
function substitute(toks, args) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "Parameter") {
      const d = toks[k + 1] && toks[k + 1].kind === "Other" && /^[1-9]$/.test(toks[k + 1].text) ? +toks[k + 1].text : 0;
      if (!d || !args || !args[d - 1]) return null;
      out.push(...args[d - 1]); k++; continue;
    }
    out.push(t);
  }
  return out;
}

export function createListDepth() {
  const regs = { L: 0, MP: 0 };   // the real overall count, and the one minipages share
  let cur = "L", mpGen = 0;        // which count \@listdepth points at; global writes to MP
  let own = new Map();             // kind -> own count (local)
  let owner = null;                // { kind, env, ownKey, list } of the innermost list or trivlist
  let atLeast = null;              // { environment, why, file, start } while a place is "at least"
  let hidden = false;              // inside comment or a \let copy of it: LaTeX prints nothing
  const cls = { name: null, options: [] };
  const enumitem = { loaded: false, loadonly: false, shortlabels: false };
  const newlists = new Map();      // name -> { type, max }
  const items = [], findings = [], flagged = new Set();
  // s251: the numbers
  const lists = [];                // one record per list opened (not hidden)
  const chain = new Map();         // environment name -> what its last list left for resume (local)
  const series = new Map();        // series name -> the same, kept past groups
  const setlists = new Map();      // "name,level" ("*" for any) -> [option tokens], local
  const opened = [];               // per \begin that opened lists: { depth, name, tokens, i, file, recs }

  function scopedSet(map, key, value, store) {
    const had = map.has(key), prev = map.get(key);
    if (store && store.depth() > 0) store.onClose(() => { if (had) map.set(key, prev); else map.delete(key); });
    map.set(key, value);
  }

  function noteLoad(isClass, name, options) {
    if (isClass) { cls.name = name; cls.options = options.slice(); return; }
    if (name === "enumitem") {
      enumitem.loaded = true;
      if (options.includes("loadonly")) enumitem.loadonly = true;
      if (options.includes("shortlabels")) enumitem.shortlabels = true;
    }
  }
  function noteNewlist(name, type, max) { newlists.set(name, { type: type.replace(/\*$/, ""), inline: /\*$/.test(type), max }); }

  // The steps an environment takes at its \begin, in order:
  // { list: kind, ownKey, limit, env, opts?, optsWhy?, viaBody? } | { triv: env } | { minipage } | { hidden } | { unknown: env, why }.
  // args: the author's arguments at this \begin (top level only), for #1 in a body.
  function stepsOf(name, store, seen, args) {
    if (seen.size > MAX_FOLLOW || seen.has(name)) return [{ unknown: name, why: "its definition calls itself" }];
    const r = store.resolve(name), rec = r.record;
    // an environment definition, or a \let copy of one (the copy carries its body)
    if (rec && (rec.kind === "environment" || rec.kind === "alias") && rec.body && rec.body.beginBody) {
      const next = new Set(seen); next.add(name);
      return followTokens(rec.body.beginBody, store, next, name, args).map((s) => Object.assign(s, { viaBody: true }));
    }
    if (rec && rec.form === "newtheorem") return [{ triv: name }];
    // \let\x\enumerate: a copy of a name the store does not hold ("frozen",
    // aliasOf kept), or a chain that ends at one. Math Ma/Mb's handout.sty
    // hides solutions with \let\solution=\comment (s250 census).
    const base = rec ? (rec.kind === "frozen" && rec.aliasOf ? rec.aliasOf : null) : r.chain[r.chain.length - 1];
    if (rec && !base) return [{ unknown: name, why: "\\" + name + " is defined (" + (rec.form || rec.kind) + "), but not as an environment the tool can read" }];
    const n = base || name;
    if (HIDING_ENVS.has(n)) return [{ hidden: true }];
    if (newlists.has(n)) { const nl = newlists.get(n); return [{ list: n, ownKey: n, limit: nl.max, env: name }]; }
    if (LISTS.has(n)) {
      const b = LISTS.get(n);
      if (n === "description" && enumitem.loaded && !enumitem.loadonly) return [{ list: n, ownKey: "description", limit: Infinity, env: name }];
      return [{ list: n, ownKey: b.own, limit: b.limit ?? Infinity, env: name }];
    }
    if (enumitem.loaded && /^(enumerate|itemize|description)\*$/.test(n)) {
      const k = n.slice(0, -1), key = k === "description" ? (enumitem.loadonly ? null : "description") : k;
      return [{ list: n, ownKey: key, limit: k === "description" ? Infinity : 4, env: name }];
    }
    if (TRIVLISTS.has(n)) return [{ triv: name }];
    if (n === "minipage") return [{ minipage: true }];
    if (n === "abstract") return abstractSteps(name);
    if (NEUTRAL.has(n)) return [];
    return [{ unknown: name, why: "the tool has no code for it (a package it does not read)" }];
  }
  function abstractSteps(name) {
    const o = cls.options, twocol = o.includes("twocolumn");
    if (cls.name === "article") return o.includes("titlepage") || twocol ? [] : [{ list: "quotation", ownKey: null, limit: Infinity, env: name }];
    if (cls.name === "report") return o.includes("notitlepage") && !twocol ? [{ list: "quotation", ownKey: null, limit: Infinity, env: name }] : [];
    if (cls.name === "amsart") return [{ list: "quotation", ownKey: null, limit: Infinity, env: name }];
    return [{ unknown: name, why: "this class's abstract is not one the tool knows" }];
  }
  // An author's begin code, read as LaTeX would run it, as far as it can be.
  // A conditional matters only when the code also takes a step: one that
  // picks nothing but fonts or words leaves the count as it is (s250 census).
  function followTokens(toks, store, seen, env, args) {
    const steps = [];
    let cond = null;
    const give = (why) => [...steps, { unknown: env, why }];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind !== "ControlWord") continue;
      if (/^if/.test(t.name)) { cond = cond || "a condition (\\" + t.name + ")"; continue; }
      if (t.name === "list") { steps.push({ list: "list", ownKey: null, limit: Infinity, env }); continue; }
      if (t.name === "trivlist") { steps.push({ triv: env }); continue; }
      if (t.name === "begin") {
        let j = k + 1; while (j < toks.length && toks[j].kind === "Space") j++;
        if (!toks[j] || toks[j].kind !== "BeginGroup") return give("a \\begin with no name");
        let e = j + 1, text = "";
        while (e < toks.length && toks[e].kind !== "EndGroup") { if (toks[e].kind === "Parameter") return give("an argument names the environment it opens"); text += toks[e].text; e++; }
        const inner = stepsOf(text.trim(), store, seen, null);
        // s251: the options written after this \begin, the author's arguments put in
        const b = readBracket(toks, e + 1), first = inner.find((s) => s.list);
        if (first && !first.viaBody) {
          if (b) { const o = substitute(toks.slice(b.open + 1, b.close), args); if (o) first.opts = o; else first.optsWhy = "an argument of \\begin{" + env + "} the tool cannot read fills its options"; }
          else first.opts = [];
        }
        steps.push(...inner);
        k = b && first ? b.close : e; continue;
      }
      if (t.name === "end") { while (k < toks.length && toks[k].kind !== "EndGroup") k++; continue; }
      // \enumerate, \center ... written as commands; an author's own command
      const rec = store.resolve(t.name).record;
      if (!rec && (LISTS.has(t.name) || TRIVLISTS.has(t.name) || t.name === "minipage" || newlists.has(t.name))) {
        const inner = stepsOf(t.name, store, seen, null), first = inner.find((s) => s.list);
        if (first && !first.viaBody) first.optsWhy = "it is opened as \\" + t.name + ", whose options the tool does not read";
        steps.push(...inner); continue;
      }
      if (rec && rec.kind === "macro" && Array.isArray(rec.body) && !seen.has("\\" + t.name) && seen.size <= MAX_FOLLOW) {
        const next = new Set(seen); next.add("\\" + t.name);
        steps.push(...followTokens(rec.body, store, next, env, null));
      }
    }
    // which branch's lists run is not known, so none of them is counted
    return cond && steps.length ? [{ unknown: env, why: cond + " picks which lists it opens" }] : steps;
  }

  // The author's arguments at \begin{name}, read from the document; null when
  // the definition takes arguments the tool does not read.
  function readArgs(name, tokens, from, store) {
    const rec = store.resolve(name).record;
    if (!rec || !rec.params || !rec.params.length) return [];
    const args = [];
    let j = from;
    for (let p = 0; p < rec.params.length; p++) {
      const slot = rec.params[p];
      if (slot.type === "optional" && slot.open === "[") {
        const b = readBracket(tokens, j);
        if (b) { args.push(tokens.slice(b.open + 1, b.close)); j = b.close + 1; } else args.push(rec.defaultOf[p] || []);
      } else if (slot.type === "mandatory") {
        const g = readGroup(tokens, j);
        if (!g) return null;
        args.push(tokens.slice(g.open + 1, g.close)); j = g.close + 1;
      } else return null;
    }
    return args;
  }

  const span = (tokens, i) => ({ start: tokens[i].start, end: tokens[i].end });
  // \begin{name}: apply its steps now; the store puts them back when the
  // frame about to open closes.
  function begin(name, ctx, line) {
    const { tokens, i, file, store } = ctx;
    const ng = readGroup(tokens, i + 1);
    const args = ng ? readArgs(name, tokens, ng.close + 1, store) : null;
    const steps = stepsOf(name, store, new Set(), args);
    if (!steps.length) return;
    // s251: a built-in list's own options follow its name in the document
    const firstList = steps.find((s) => s.list);
    if (firstList && !firstList.viaBody && ng) { const b = readBracket(tokens, ng.close + 1); firstList.opts = b ? tokens.slice(b.open + 1, b.close) : []; }
    const inArgument = argumentGroup(tokens, i, store);
    const saved = { own: new Map(own), owner, atLeast, hidden };
    const undo = [], recs = [];
    for (const s of steps) {
      if (s.unknown) { if (!atLeast) atLeast = { environment: s.unknown, why: s.why, file, start: tokens[i].start }; continue; }
      if (s.hidden) { hidden = true; continue; }
      if (s.triv) { owner = { kind: "trivlist", env: s.triv, ownKey: null, list: null }; continue; }
      if (s.minipage) { undo.push({ minipage: { cur, mp: regs.MP } }); cur = "MP"; regs.MP = 0; undo[undo.length - 1].minipage.gen = mpGen; continue; }
      if (s.ownKey) {
        if ((own.get(s.ownKey) || 0) >= s.limit) { tooDeep(tokens, i, file, name, s.ownKey + " is already " + s.limit + " deep"); continue; }
        own.set(s.ownKey, (own.get(s.ownKey) || 0) + 1);
      }
      if (regs[cur] > 5) tooDeep(tokens, i, file, name, "six lists are already open");
      else { regs[cur]++; if (cur === "MP") mpGen++; }
      undo.push({ list: true });
      const rec = hidden ? null : openList(s, { file, line, start: tokens[i].start, name, inArgument, store });
      if (rec) recs.push(rec);
      owner = { kind: s.list, env: s.env, ownKey: s.ownKey, list: rec };
    }
    const entry = recs.length ? { depth: store.depth(), name, tokens, i, file, recs, closed: false } : null;
    if (entry) opened.push(entry);
    store.onClose(() => {
      for (let k = undo.length - 1; k >= 0; k--) {
        const u = undo[k];
        if (u.list) { regs[cur]--; if (cur === "MP") mpGen++; }
        else if (u.minipage) { if (mpGen === u.minipage.gen) regs.MP = u.minipage.mp; cur = u.minipage.cur; }
      }
      own = saved.own; owner = saved.owner; atLeast = saved.atLeast; hidden = saved.hidden;
      if (entry) closeLists(entry, store);
    }, { next: true });
  }
  // A \begin written inside a command's argument (\solnot{\begin{enumeratecols}{3}}):
  // which list LaTeX opens there depends on the command.
  function argumentGroup(tokens, i, store) {
    const fr = store.frames(), top = fr[fr.length - 1];
    if (!top || top.kind !== "group" || top.name || top.at == null || top.at >= i || !tokens[top.at] || tokens[top.at].kind !== "BeginGroup") return null;
    let p = top.at - 1; while (p >= 0 && (tokens[p].kind === "Space" || tokens[p].kind === "Comment")) p--;
    const t = tokens[p];
    if (t && t.kind === "ControlWord") return PLAIN_GROUP.has(t.name) ? null : "\\" + t.name;
    if (t && (t.kind === "EndGroup" || (t.kind === "Other" && t.text === "]"))) return "a command";
    return null;
  }

  // s251: one list's record, its label and the count it starts from.
  function openList(s, at) {
    const base = s.list.replace(/\*$/, "");
    const numbered = base === "enumerate" || (newlists.has(base) && newlists.get(base).type === "enumerate");
    const level = s.ownKey ? own.get(s.ownKey) : null;
    const rec = { id: lists.length, file: at.file, line: at.line ?? null, start: at.start, env: s.env, kind: s.list, level,
                  numbered, counter: numbered ? counterName(base === "enumerate" ? "enum" : base, level) : null,
                  style: null, short: null, exact: null, first: null, count: 0, sure: true, why: null,
                  direct: !s.viaBody, series: null, carried: null, hadStart: false };
    lists.push(rec);
    if (!numbered) return rec;
    const unsure = (why) => { if (rec.sure) { rec.sure = false; rec.why = why; } };
    if (atLeast) unsure("an environment around it (\\begin{" + atLeast.environment + "}) is one the tool cannot follow");
    if (at.inArgument) unsure("it opens inside the argument of " + at.inArgument + ", which decides what LaTeX runs");
    if (s.optsWhy) unsure(s.optsWhy);
    const optToks = s.opts || [];
    if (optToks.length && !enumitem.loaded) unsure("it has options but enumitem is not loaded");
    const o = readOptions(optToks, { shortlabels: enumitem.shortlabels });
    if (o.why) unsure(o.why);
    // \setlist: all lists, this level, this name, this name and level (later wins)
    let setLabel = null, setStart = null;
    for (const slot of ["*,*", "*," + level, base + ",*", base + "," + level]) {
      for (const toks of setlists.get(slot) || []) {
        const so = readOptions(toks, { setlist: true });
        if (so.why) unsure("a \\setlist for it: " + so.why);
        if (so.label) setLabel = so.label;
        if (so.start != null) setStart = so.start;
      }
    }
    // where the count starts
    let from = null;
    if (o.resume) {
      const prev = o.series ? series.get(o.series) : chain.get(s.env);
      if (o.series && !prev) unsure("resume=" + o.series + " names a series the tool has not seen");
      if (prev && !prev.sure) unsure("it carries on from a list the tool cannot follow");
      if (setStart != null) unsure("resume with a \\setlist start=: the tool does not guess which wins");
      if (o.resumeStar && prev && prev.hadStart) unsure("resume* would repeat the earlier list's start=");
      from = prev ? prev.count : 0;
      if (o.resumeStar && prev) rec.carried = prev.label;
    } else from = (o.start ?? setStart ?? 1) - 1;
    rec.hadStart = o.start != null;
    rec.series = o.series;
    const label = o.label || rec.carried || setLabel || DEFAULT_LABELS[level - 1] || null;
    rec.ownLabel = o.label || rec.carried;
    if (!label) unsure("it has no label (a \\newlist needs one from \\setlist or label=)");
    else {
      const a = analyzeLabel(label);
      if (a.why) unsure(a.why);
      else { rec.style = a.style; rec.short = a.short; rec.exact = a.exact; rec.before = a.before; rec.after = a.after; }
    }
    rec.count = from; rec.first = from + 1;
    return rec;
  }

  // \end{name}: its \begin must be the innermost thing open, in the same file;
  // and nothing between may change the count behind the walk's back.
  function end(name, ctx) {
    const { tokens, i, store } = ctx;
    const e = opened[opened.length - 1];
    if (!e || e.closed) return;
    const fr = store.frames(), top = fr[fr.length - 1];
    if (!(fr.length === e.depth + 1 && top && top.kind === "env" && top.name === name)) return;
    e.closed = true;
    for (const rec of e.recs) {
      if (!rec.numbered || !rec.sure) continue;
      if (e.tokens !== tokens) { rec.sure = false; rec.why = "its \\begin and \\end are in different files"; continue; }
      const why = scanBody(tokens.slice(e.i, i + 1), rec, store);
      if (why) { rec.sure = false; rec.why = why; }
    }
  }
  function scanBody(toks, L, store) {
    const counter = L.counter;
    for (const c of counterChanges(toks)) if (c.counter === counter) return "\\" + c.command + "{" + counter + "} changes its count mid-list";
    const seen = new Set();
    const holds = (body, depth) => {
      if (depth > MAX_FOLLOW) return false;
      for (const t of body) {
        if (t.kind !== "ControlWord") continue;
        if (t.name === "item") return true;
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        const rec = store.resolve(t.name).record;
        if (rec && rec.kind === "macro" && Array.isArray(rec.body) && holds(rec.body, depth + 1)) return true;
      }
      return counterChanges(body).some((c) => c.counter === counter);
    };
    for (const t of toks) {
      if (t.kind !== "ControlWord" || t.name === "item") continue;
      const rec = store.resolve(t.name).record;
      if (rec && rec.kind === "macro" && Array.isArray(rec.body)) {
        // an item command the walk follows wherever it sits (command()), here or in a sub-list
        if (!(rec.params && rec.params.length) && itemPlan(rec.body, L)) continue;
        seen.clear(); seen.add(t.name);
        if (holds(rec.body, 1)) return "\\" + t.name + " holds an \\item or changes the count, and the walk does not look inside it";
      }
    }
    return null;
  }
  // The frame has closed: what each list leaves for a later resume.
  function closeLists(e, store) {
    const top = opened.pop();
    if (top !== e) { const k = opened.indexOf(e); if (k >= 0) opened.splice(k, 1); }
    for (let k = e.recs.length - 1; k >= 0; k--) {
      const rec = e.recs[k];
      if (!rec.numbered) continue;
      if (!e.closed && rec.sure) { rec.sure = false; rec.why = "its \\begin and \\end are not in the same group"; }
      const left = { count: rec.count, sure: rec.sure, label: rec.ownLabel, hadStart: rec.hadStart };
      if (rec.series) series.set(rec.series, left);
      // a list opened inside an author's environment ends inside its group: nothing is left outside
      if (rec.direct) scopedSet(chain, rec.env, left, store);
    }
  }

  // \setlist[names,levels]{keys}, \setlist*, \setenumerate[levels]{keys}.
  function setlist(ctx, form) {
    const { tokens, i, store } = ctx;
    let j = i + 1, star = false;
    if (form === "setlist" && tokens[j] && tokens[j].kind === "Other" && tokens[j].text === "*") { star = true; j++; }
    const b = readBracket(tokens, j);
    const g = readGroup(tokens, b ? b.close + 1 : j);
    if (!g) return;
    const names = [], levels = [];
    if (form === "setenumerate") names.push("enumerate");
    for (const k of b ? splitKeys(tokens.slice(b.open + 1, b.close)) : []) (/^\d+$/.test(k.name) ? levels : names).push(k.name);
    const keys = tokens.slice(g.open + 1, g.close);
    for (const n of names.length ? names : ["*"]) for (const l of levels.length ? levels : ["*"]) {
      const slot = n + "," + l;
      scopedSet(setlists, slot, star ? [...(setlists.get(slot) || []), keys] : [keys], store);
    }
  }

  function tooDeep(tokens, i, file, env, why) {
    findings.push(finding("lists/too-deeply-nested", "author-error", span(tokens, i), file,
      "\\begin{" + env + "} is one list too deep (" + why + "); LaTeX stops with \"Too deeply nested\" and its items stay in the list around it.",
      { environment: env }));
  }

  function item(ctx, line) {
    const { tokens, i } = ctx;
    const b = readBracket(tokens, i + 1);
    pushItem(ctx, line, b ? tokens.slice(b.open + 1, b.close) : null, null);
  }
  // s251: an author's command inside a numbered list whose body makes items
  // (handout.sty's \plainitem, \circleitem; the problem sets' \calcitem):
  // its steps are run here, at the command, as LaTeX would run them.
  function command(ctx, lineAt) {
    const L = owner && owner.list;
    if (!L || !L.numbered || hidden) return;
    const { tokens, i, store } = ctx, name = tokens[i].name;
    const rec = store.resolve(name).record;
    if (!rec || rec.kind !== "macro" || !Array.isArray(rec.body) || (rec.params && rec.params.length)) return;
    const plan = itemPlan(rec.body, L);
    if (!plan) return;
    for (const s of plan) {
      if (s.step) L.count++;
      else pushItem(ctx, lineAt(), s.custom, name);
    }
  }
  // The steps of a body that makes items: [{ step } | { custom: tokens|null }];
  // null when it makes none or does something the tool does not follow (a
  // condition, another counter change, a command of its own) — the \end scan
  // then leaves the list alone.
  function itemPlan(body, L) {
    const plan = [];
    for (let k = 0; k < body.length; k++) {
      const t = body[k];
      if (t.kind !== "ControlWord") continue;
      if (/^if/.test(t.name)) return null;
      if (t.name === "item") {
        const b = readBracket(body, k + 1);
        plan.push({ custom: b ? body.slice(b.open + 1, b.close) : null });
        if (b) k = b.close;
        continue;
      }
      const ch = counterChanges(body.slice(k, k + 1 + groupLength(body, k + 1)))[0];
      if (ch) {
        if (ch.counter !== L.counter && !(L.kind.replace(/\*$/, "") === "enumerate" && /^enum\\romannumeral\s*\\@enumdepth$/.test(ch.counter))) continue;
        if (ch.command !== "refstepcounter" && ch.command !== "stepcounter") return null;
        plan.push({ step: true }); continue;
      }
    }
    return plan.some((s) => !s.step) ? plan : null;
  }
  const groupLength = (toks, j) => { const g = readGroup(toks, j); return g ? g.close - j + 1 : 0; };
  // The marker an \item[..] prints: its text, with enumitem's current label
  // (\labelenumi, or \csname labelenum\romannumeral\@enumdepth\endcsname) put in.
  function renderCustom(toks, L) {
    let out = "";
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const here = L && L.style ? () => L.before + formatCount(L.count, L.style) + L.after : null;
      if (t.kind === "ControlWord" && t.name === "csname") {
        let e = k + 1, nm = "";
        while (e < toks.length && !(toks[e].kind === "ControlWord" && toks[e].name === "endcsname")) { if (toks[e].kind !== "Space") nm += toks[e].text; e++; }
        if (here && L.kind.replace(/\*$/, "") === "enumerate" && /^labelenum\\romannumeral\\@enumdepth$/.test(nm)) { out += here(); k = e; continue; }
        return { why: "its marker builds a name (\\csname " + nm + ") the tool does not follow" };
      }
      if (here && t.kind === "ControlWord" && t.name === "label" + L.counter) { out += here(); continue; }
      out += t.text;
    }
    return { text: out.trim() };
  }

  function pushItem(ctx, line, customToks, via) {
    const { tokens, i, file } = ctx;
    const rec = { file, line, start: tokens[i].start, end: tokens[i].end, overall: regs[cur],
                  kind: owner ? owner.kind : null, env: owner ? owner.env : null,
                  level: owner && owner.ownKey ? own.get(owner.ownKey) : null, atLeast: !!atLeast, hidden,
                  list: null, number: null, label: null, custom: null, via };
    if (atLeast && !hidden) {          // a hidden item prints nothing: no finding is worth making
      rec.kind = null; rec.env = null; rec.level = null;
      const key = atLeast.file + ":" + atLeast.start;
      if (!flagged.has(key)) {
        flagged.add(key);
        findings.push(finding("lists/depth-at-least", "unsupported", { start: atLeast.start, end: atLeast.start }, atLeast.file,
          "\\begin{" + atLeast.environment + "}: " + atLeast.why + ", so its items are at least " + rec.overall + " lists deep, perhaps more.",
          { environment: atLeast.environment, why: atLeast.why }));
      }
    }
    // s251: the number and marker
    if (customToks) rec.custom = customToks.map((t) => t.text).join("").trim();
    const L = owner && owner.list;
    if (L && !hidden) {
      rec.list = L.id;
      if (atLeast && L.sure && L.numbered) { L.sure = false; L.why = "an \\item inside \\begin{" + atLeast.environment + "}, which the tool cannot follow"; }
      if (rec.custom !== null) {
        if (L.numbered && via) rec.number = L.count;            // \calcitem stepped the count itself
        const r = renderCustom(customToks, L.numbered ? L : null);
        if (r.why) { if (L.sure && L.numbered) { L.sure = false; L.why = r.why; } }
        else rec.label = r.text;
      } else if (L.numbered) {
        L.count++; rec.number = L.count;
        const f = L.style ? formatCount(L.count, L.style) : null;
        if (f === null) { if (L.sure) { L.sure = false; L.why = L.why || "count " + L.count + " cannot be printed in its style"; } }
        else rec.label = L.before + f + L.after;
      }
    }
    items.push(rec);
  }

  function result() {
    const all = findings.slice();
    for (const L of lists) if (L.numbered && !L.sure)
      all.push(finding("lists/numbers-unsure", "unsupported", { start: L.start, end: L.start }, L.file,
        "\\begin{" + L.env + "}: the tool cannot be sure of its numbers (" + L.why + "), so it leaves this list as it is.",
        { environment: L.env, why: L.why }));
    // s252: enumitem's state at the end, for the rewrite (a short form needs enumitem)
    return { items, lists, findings: all, enumitem: { ...enumitem } };
  }

  return { noteLoad, noteNewlist, begin, end, item, command, setlist, result };
}
