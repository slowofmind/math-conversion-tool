// v2/unknown-calls.mjs — session 289. Commands nobody understands, in running
// text: step 5 of PLAN-REPORT-ORDER-s284 (signed off 2026-10-31).
//
// Plain terms: this pass changes nothing. It reads the author's own files by
// tokens and, for each command called in the running text, asks three
// questions: is it defined in a file the document reads; is it in Pandoc's
// table; is it LaTeX's own or the document class's (data/latex-names.json,
// v2/latex-names.mjs)? A call that fails all three is dropped by Pandoc, so it
// is reported through the unknown-construct rule (decide.mjs, collectAndReport)
// with where it comes from: a package the tool and Pandoc do not support, or no
// file the document reads. An environment begun in running text is asked the
// same and, when unknown, reported as environment-wrapped (Pandoc keeps its
// body). Pandoc's own "Skipped" line names the same call at the same place;
// the combined report pairs the two (combined.mjs PAIRS).
//
// WHAT IS NOT RUNNING TEXT, found from the tokens (as _work/_s283_refine.mjs
// placeOf did): the preamble (before the file's \begin{document}, or a file
// opened from a preamble line) and after \end{document}; a definition
// statement; a drawing (an environment structure.mjs isPictureEnv names);
// math ($, $$, \( \), \[ \], Pandoc's math environments); an environment this
// version hides; the test of \ifthenelse and \whiledo, and the branch the
// version does not print (transforms/ifthen.mjs chooseBranch); an argument
// Pandoc's table says is not text ({num}{unit} of \SI: only slots named text or
// content are); and the arguments of a command Pandoc's table does not hold
// and the files do not define - Pandoc skips such a call whole with its
// arguments (measured: \raisebox{2ex-\height}{x}, \tikz{\draw ..},
// \ifSubfilesClassLoaded{..}{..}, _work/_s289-cases.txt), so a call inside
// is lost with it and not told again.
//
// Limits said now: a command Pandoc reads although its table does not list it
// (\fbox, s283) is treated like one it skips, so a call inside its argument is
// not told. Calls of LaTeX's own commands are never told here, even where
// Pandoc skips them with their text (\raisebox{..}{x}); step 7's levels decide
// those. The packages are the reader's load rows; a comment inside a
// \usepackage{..} list (s288) is taken out of the name by tokens here, and the
// reader itself is unchanged.
//
// Like surface.mjs, it reads and writes nothing and names no module that
// touches a disk: the capability table and the names list are handed in.
import { tokenize, profileFor } from "./tokenizer.mjs";
import { readGroup, readBracket, skipSp, matchEnvironment, findMath, isPictureEnv } from "./structure.mjs";
import { readDefinition, isDefinitionForm, groupText } from "./definition.mjs";
import { chooseBranch, ifThenState } from "./transforms/ifthen.mjs";

const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? groupText(ts, g).trim() : null; };

// A name as the reader recorded it, without the comments a \usepackage{..}
// list can carry ("etoolbox    % for csvlist", s288): by tokens.
function cleanName(raw) {
  return tokenize(String(raw), { profile: profileFor("x.tex") }).tokens
    .filter((t) => t.kind !== "Comment" && t.kind !== "Space" && t.kind !== "Newline").map((t) => t.text).join("");
}

// The packages and classes the document loads, in load order, from the
// reader's rows ("load NAME"), and those it found outside the project.
export function loadsOf(reader) {
  const loads = [], outside = [];
  for (const r of reader.record || []) {
    if (!String(r.what).startsWith("load ") || r.what === "load subfiles" && r.parent) continue;
    const name = cleanName(r.what.slice(5));
    if (!name || loads.includes(name)) continue;
    loads.push(name);
    if (String(r.effect).startsWith("not in this project")) outside.push(name);
  }
  return { loads, outside };
}

// The slots of a command in Pandoc's table ("[opts]{file}" -> [{bracket, text}]),
// from its first row with an argument shape; null when the table gives none.
function tableSlots(capability, name) {
  for (const r of capability.rowsFor(name)) {
    const spec = String(r.args || "");
    if (!spec) continue;
    const slots = [];
    for (let j = 0; j < spec.length; j++) {
      const close = spec[j] === "{" ? "}" : spec[j] === "[" ? "]" : null;
      if (!close) continue;
      const k = spec.indexOf(close, j + 1);
      if (k < 0) break;
      const word = spec.slice(j + 1, k);
      slots.push({ bracket: spec[j] === "[", text: word === "text" || word === "content" });
      j = k;
    }
    return slots;
  }
  return null;
}

// Pandoc's skip of a command it does not know: the command, then [..] and {..}
// groups each after at most one line break (structure.mjs skipSp). Returns the
// index of the last token and whether any {..} group holds something.
function skipOf(ts, i) {
  let last = i, content = false;
  for (;;) {
    const b = readBracket(ts, last + 1);
    if (b) { last = b.close; continue; }
    const at = skipSp(ts, last + 1);
    if (!ts[at] || ts[at].kind !== "BeginGroup") break;
    const g = readGroup(ts, at);
    if (!g) break;
    for (let k = g.open + 1; k < g.close; k++) if (!["Space", "Newline", "Comment"].includes(ts[k].kind)) { content = true; break; }
    last = g.close;
  }
  return { last, content };
}

// Defined anywhere in the files read: the store's last state, or any definition
// it ever wrote. A \newcommand inside an environment is local in TeX and gone
// at its end, but Pandoc's macros are global and it reads the call (X11).
function definedIn(store) {
  const ever = new Set((store.events || []).filter((e) => e.type === "define").map((e) => e.name));
  return (name) => !!store.lookup(name) || ever.has(name);
}

// The ranges of token indices in one file that are not running text.
function zonesOf(ts, { store, hidden, state, capability, body, ending }) {
  const defined = definedIn(store);
  const zones = [];
  const add = (open, close) => { if (close >= open) zones.push([open, close]); };
  if (body > 0) add(0, body - 1);
  if (ending != null) add(ending, ts.length - 1);
  for (const m of findMath(ts)) add(m.open, m.close);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind !== "ControlWord") continue;
    if (isDefinitionForm(t.name) || t.name === "global" || t.name === "long") {
      const d = readDefinition(ts, i);
      if (d && d.close > i) { add(i, d.close); i = d.close; }
      continue;
    }
    if (t.name === "begin") {
      const name = envName(ts, i);
      if (name !== null && (isPictureEnv(name) || hidden.has(name))) { const env = matchEnvironment(ts, i); if (env) add(i, env.close); }
      continue;
    }
    if (t.name === "ifthenelse") {
      const ch = chooseBranch(ts, i, state);
      if (!ch) continue;
      if (ch.keep) { add(i, ch.keep[0] - 1); add(ch.keep[1] + 1, ch.close); } else add(i, ch.close);
      continue;
    }
    if (t.name === "whiledo") { const g = readGroup(ts, i + 1); if (g) add(i, g.close); continue; }
    const slots = tableSlots(capability, t.name);
    if (slots) {                                                    // a command Pandoc reads: its non-text arguments
      let j = i;
      for (const s of slots) {
        const a = s.bracket ? readBracket(ts, j + 1) : readGroup(ts, j + 1);
        if (!a) { if (s.bracket) continue; break; }
        if (!s.text) add(a.open, a.close);
        j = a.close;
      }
      continue;
    }
    if (t.name !== "end" && !capability.recognized(t.name) && !defined(t.name)) {  // one Pandoc skips whole, arguments and all
      const s = skipOf(ts, i);
      if (s.last > i) add(i + 1, s.last);
    }
  }
  return zones;
}

// The token index of the file's \begin{document} and \end{document}, or null.
function documentMarks(ts) {
  let begin = null, end = null;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].kind !== "ControlWord" || (ts[i].name !== "begin" && ts[i].name !== "end")) continue;
    if (envName(ts, i) !== "document") continue;
    if (ts[i].name === "begin" && begin === null) begin = i;
    else if (ts[i].name === "end" && end === null) end = i;
  }
  return { begin, end };
}

// The calls of these names (and \begin{..} of these environments) left in running
// text in one -pp file, by the same zones: [{ name, env, start }]. The tool's own
// tags (\ppflag ..) are not in the store nor Pandoc's table, so a call inside one
// is inside a command Pandoc skips whole, and does not count (session 289, X8).
export function reachedCalls({ tokens, reader, capability, names }) {
  const ts = tokens, m = documentMarks(ts);
  const zones = zonesOf(ts, { store: reader.store, hidden: new Set(reader.summary && reader.summary.hiddenEnvironments || []),
    state: ifThenState(reader.summary && reader.summary.flags || {}), capability, body: m.begin === null ? 0 : m.begin + 1, ending: m.end });
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind !== "ControlWord" || zones.some(([a, b]) => a <= i && i <= b)) continue;
    if (t.name === "begin") { const n = envName(ts, i); if (n !== null && names.has(n)) out.push({ name: n, env: true, start: t.start }); }
    else if (names.has(t.name)) out.push({ name: t.name, env: false, start: t.start });
  }
  return out;
}

// files       [{ path, tokens }]: the author's own files (no .sty/.cls), in reading order
// store       the reader's definition store; reader its result (record, summary)
// capability  the built Pandoc table; latexNames createLatexNames(..)'s object
// decide      createDecide(..)'s object: findings are made by decide.unknown
// documentclass  the document's class (a subfile's parent's)
// Returns { findings, byName, total }: findings in the shape every rule gives
// (decide.toFindings), each with detail.origin { from: "package", name } or
// { from: "nowhere"[, notInList: [..]] }.
export function findUnknownCalls({ files, reader, capability, latexNames, decide, documentclass } = {}) {
  if (!capability || typeof capability.recognized !== "function") throw new Error("findUnknownCalls: a built capability table is needed");
  if (!latexNames || typeof latexNames.originOf !== "function") throw new Error("findUnknownCalls: the names list is needed");
  const store = reader.store;
  const hidden = new Set(reader.summary && reader.summary.hiddenEnvironments || []);
  const state = ifThenState(reader.summary && reader.summary.flags || {});
  const { loads, outside } = loadsOf(reader);
  const notInList = outside.filter((n) => !latexNames.knowsPackage(n) && !latexNames.knowsClass(n));
  const cls = documentclass || null;

  // whether a file without its own \begin{document} is read in a preamble: where it is opened from
  const marks = new Map(files.map((f) => [f.path, documentMarks(f.tokens)]));
  const tokensOf = new Map(files.map((f) => [f.path, f.tokens]));
  const inPreamble = (file, seen = new Set()) => {
    const m = marks.get(file);
    if (m && m.begin !== null) return false;
    const row = (reader.record || []).find((r) => r.target === file && Number.isInteger(r.at));
    if (!row || seen.has(file)) return false;
    seen.add(file);
    const om = marks.get(row.file), ots = tokensOf.get(row.file);
    if (om && om.begin !== null && ots) return row.at < ots[om.begin].start;
    return inPreamble(row.file, seen);
  };

  const defined = definedIn(store);
  const originOf = (name) => {
    if (defined(name) || capability.recognized(name)) return false;
    const o = latexNames.originOf(name, { documentclass: cls, packages: loads });
    if (o && (o.from === "kernel" || o.from === "class")) return false;
    if (o) return { from: "package", name: o.name };
    return notInList.length ? { from: "nowhere", notInList } : { from: "nowhere" };
  };
  const sentence = (o) => o.from === "package"
    ? "It comes from the package " + o.name + ", which neither the tool nor Pandoc supports."
    : "It is defined in no file the document reads." + (o.notInList
      ? " The document also loads " + o.notInList.join(", ") + ", which the tool's list of packages does not know; it may come from there." : "");

  // a subfile converted alone reads only its parent's preamble (reader.mjs D6; combined.mjs unreadParts)
  const parents = new Set(reader.mode === "subfile-alone"
    ? (reader.record || []).filter((r) => r.what === "load subfiles" && r.parent).map((r) => r.parent) : []);

  const findings = [];
  for (const f of files) {
    const ts = f.tokens, m = marks.get(f.path);
    if (parents.has(f.path) || inPreamble(f.path)) continue;
    const zones = zonesOf(ts, { store, hidden, state, capability, body: m.begin === null ? 0 : m.begin + 1, ending: m.end });
    const outsideText = (k) => zones.some(([a, b]) => a <= k && k <= b);
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t.kind !== "ControlWord" || outsideText(i) || t.name.includes("@")) continue;
      if (t.name === "end" || t.name === "ifthenelse" || t.name === "whiledo") continue;
      if (t.name === "begin") {
        const name = envName(ts, i);
        if (!name || name === "document" || isPictureEnv(name)) continue;
        const o = originOf(name);
        if (!o) continue;
        const g = readGroup(ts, i + 1);
        const a = decide.unknown({ by: "unknown-calls", name, shape: "environment", hasContent: true, file: f.path,
                                   span: { start: t.start, end: ts[g.close].end }, detail: { origin: o }, origin: sentence(o) });
        findings.push(...decide.toFindings(a));
        continue;
      }
      const o = originOf(t.name);
      if (!o) continue;
      const s = skipOf(ts, i);
      const a = decide.unknown({ by: "unknown-calls", name: t.name, shape: "inline_command", hasContent: s.content, file: f.path,
                                 span: { start: t.start, end: ts[s.last].end }, detail: { origin: o }, origin: sentence(o) });
      findings.push(...decide.toFindings(a));
    }
  }
  const counts = new Map();
  for (const x of findings) counts.set(x.detail.name, (counts.get(x.detail.name) || 0) + 1);
  const byName = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name, count]) => ({ name, count }));
  return { findings, byName, total: findings.length };
}

// Session 290 (PLAN-REPORT-ORDER-s284 step 6): "redefined before defined"
// (store/renew-undefined), split by who defines the name. The store tells
// every \renewcommand of a name no file read defines; most are LaTeX's, the
// class's or a loaded package's own (s283: 95%), and redefining those is fine.
// Each entry keeps its rule and gains detail.origin and detail.level: found in
// the names list -> "Everything", with a message saying so; not found -> a
// real slip, "Check", with the error pdflatex stops on for that form pinned
// beside it (TeX Live 2026, _work/_s290-probe.txt and -probe2.txt; a form not
// measured gets no line). Reads and changes nothing else.
const PDFLATEX = {
  renewcommand: (n) => "! LaTeX Error: Command \\" + n + " undefined.",
  RenewCommandCopy: (n) => "! LaTeX Error: Command \\" + n + " undefined.",
  renewenvironment: (n) => "! LaTeX Error: Environment " + n + " undefined.",
  RenewDocumentCommand: (n) => "! LaTeX cmd Error: Command '\\" + n + "' undefined.",
  RenewDocumentEnvironment: (n) => "! LaTeX cmd Error: Environment '" + n + "' undefined.",
  renewrobustcmd: (n) => "! Package etoolbox Error: \\" + n + " undefined.",
};
export function nameRedefinitions(findings, { reader, latexNames, documentclass, tokensOf = () => null } = {}) {
  if (!latexNames || typeof latexNames.originOf !== "function") throw new Error("nameRedefinitions: the names list is needed");
  const { loads } = loadsOf(reader);
  // \theX of a counter X the files make: \newcounter, or \newtheorem (a shared counter [thm] too), but not amsthm's
  // \newtheorem* and not one made later in the same file (pdflatex: _work/_s290-probe4.txt, -probe5.txt; E11-E14).
  // A counter made in another file is taken as made before.
  const counterOf = (name, f) => {
    if (!name.startsWith("the") || !reader.store) return null;
    const rec = reader.store.lookup(name.slice(3));
    if (!rec || (rec.form !== "newcounter" && rec.form !== "newtheorem") || !rec.origin) return null;
    if (rec.origin.file === f.file && f.span && rec.origin.start > f.span.start) return null;
    if (rec.form === "newtheorem") {
      const ts = tokensOf(rec.origin.file) || [];
      const k = ts.findIndex((t) => t.start === rec.origin.start);
      if (k < 0 || (ts[k + 1] && ts[k + 1].text === "*")) return null;
    }
    return { name: name.slice(3), form: rec.form };
  };
  // a local class that \LoadClass-es a standard one (the corpus's CabanaSOP.cls, E9): the classes the list knows
  // among the loads count as the document's class too, in load order
  const classes = [documentclass || null, ...loads.filter((n) => n !== documentclass && latexNames.knowsClass(n) && !latexNames.knowsPackage(n))];
  const lookUp = (name) => {
    for (const c of classes) { const o = latexNames.originOf(name, { documentclass: c, packages: loads }); if (o) return o; }
    return null;
  };
  return findings.map((f) => {
    if (f.rule !== "store/renew-undefined") return f;
    const name = f.detail.name, head = "\\" + f.detail.form + " of \\" + name;
    const o = lookUp(name), counter = o ? null : counterOf(name, f);
    if (counter)
      return Object.assign({}, f, { message: head + ": \\" + name + " prints the counter " + counter.name + ", which \\" + counter.form + " makes; redefining it is fine.",
        detail: Object.assign({}, f.detail, { origin: { from: "counter", name: counter.name }, level: "Everything", pdflatex: null }) });
    // the list holds no internal @ names (1 of 168,199, _work/_s290-split.txt), so it cannot judge them (E10)
    if (!o && name.includes("@"))
      return Object.assign({}, f, { message: head + ": \\" + name + " is an internal name (it has an @), which the tool's list of LaTeX's and the packages' names does not hold; such names are almost always LaTeX's or a package's own.",
        detail: Object.assign({}, f.detail, { origin: { from: "internal" }, level: "Everything", pdflatex: null }) });
    if (o) {
      const who = o.from === "kernel" ? " is LaTeX's own" : o.from === "class" ? " is the class " + o.name + "'s own" : " comes from the package " + o.name;
      return Object.assign({}, f, { message: head + ": \\" + name + who + "; redefining it is fine.",
        detail: Object.assign({}, f.detail, { origin: o, level: "Everything", pdflatex: null }) });
    }
    const err = PDFLATEX[f.detail.form] ? PDFLATEX[f.detail.form](name) : null;
    return Object.assign({}, f, { message: f.message + (err ? " pdflatex stops here with \"" + err + "\"" : ""),
      detail: Object.assign({}, f.detail, { origin: { from: "nowhere" }, level: "Check", pdflatex: err }) });
  });
}
