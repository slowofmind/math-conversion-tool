// v2/store.mjs — Stage 3 of the v2 rebuild. DESIGN-V2 §4.3, §5.2.
//
// Plain terms: a notebook of what every command and environment means at
// each point of a file, kept the way TeX keeps it. A definition made inside
// {...} or inside an environment disappears when that group closes;
// \global (and \gdef, \xdef) writes through every open group. The notebook
// outlives a file: a .sty read by \usepackage defines at the document's
// current depth, so the walk over one file pushes no frame of its own
// (decision 1). Option contexts are named, not lexical: while
// beginOption("handout", "sols") is active, every record written carries
// viaOption "handout[sols]" so a later diff can say what an option changed.
//
// Two tables — definitions and flags — one stack of frames (each a map of
// name → previous record, replayed on close), an ordered list of events,
// snapshot() and diff(). Records are never mutated: a redefinition is a new
// record, so a snapshot is a shallow copy and diff compares identity.
//
// Clash rules are the FORMS table's `clash` column (definition.mjs), measured
// on Pandoc 3.11 (probes B7, B9–B11, C3, C5): the \newcommand family keeps
// the FIRST definition (store/already-defined); \renewcommand of an unknown
// name defines it (store/renew-undefined); \providecommand of a known name
// is a no-op; \def, \let and the Declare* forms overwrite;
// \DeclareRobustCommand overwrites as TeX does but Pandoc keeps the first,
// so it raises store/pandoc-ignores-redefinition (C3). \let copies the
// target's record as it stands (kind alias) or freezes an undefined target
// (kind frozen) — decision 4, 495 corpus save-and-redefine sites.
//
// walkDefinitions(tokens, file, store) walks ONE token list: it jumps over
// every recognised statement (bodies are never walked into), steps over
// \DeclareOption{..}{..} bodies and \ifthenelse{..}{..}{..} branches into a
// `skipped` list (Stage 4 and Stage 5 decide those), and does not interpret
// plain-TeX \ifX..\else..\fi (both branches walked, last wins — a Stage 5
// refinement). Findings here start "store/" and "walk/".

import { skipSpaces, readGroup } from "./structure.mjs";
import { FORMS, readDefinition, readFlagStatement, groupText } from "./definition.mjs";

// Environments whose body is hidden from the output; a name whose record
// resolves to one of these (through aliases) is a hidden environment.
export const HIDING_ENVS = new Set(["comment"]);

const finding = (rule, level, span, file, message, detail) =>
  ({ rule, channel: "attention", level, kind: "literal", file: file ?? null, span: span || null, message, detail: detail || {} });

export function createStore() {
  const definitions = new Map();   // name → record
  const flags = new Map();         // name → { family, value, form, file }
  const frames = [];               // { kind: "group" | "env", name, at, undo: Map, flagUndo: Map }
  const events = [];               // ordered list of every write, open and close
  let option = null;               // "pkg[opt]" while an option handler runs

  // Write `rec` under `name`, remembering the previous value in the innermost
  // frame; \global writes through — set now and forget every frame's undo
  // entry for that name so no close can bring the old meaning back.
  function write(table, undoKey, name, rec, global) {
    if (global) { for (const f of frames) f[undoKey].delete(name); }
    else if (frames.length) { const top = frames[frames.length - 1]; if (!top[undoKey].has(name)) top[undoKey].set(name, table.get(name)); }
    table.set(name, rec);
  }
  const stamp = (def, file) => Object.assign({}, def, { origin: Object.assign({}, def.origin, { file: file ?? def.origin.file }), viaOption: option });

  // ---- definitions -------------------------------------------------------
  function lookup(name) { return definitions.get(name); }
  // Follow aliasOf until a non-alias record or an unknown name.
  function resolve(name) {
    const chain = [name]; let rec = definitions.get(name);
    while (rec && rec.kind === "alias" && rec.aliasOf && !chain.includes(rec.aliasOf)) { chain.push(rec.aliasOf); rec = definitions.get(rec.aliasOf); }
    return { record: rec, chain };
  }

  // define(def, { file }) applies the form's clash rule and writes. Returns
  // { written, record, findings }. A kind alias record goes through let().
  function define(def, ctx) {
    const file = ctx && ctx.file, fnd = [];
    if (def.kind === "alias") return letDef(def, file);
    const row = FORMS.get(def.form), clash = row ? row.clash : "overwrite";
    const existing = definitions.get(def.name);
    const rec = stamp(def, file);
    const span = rec.origin ? { start: rec.origin.start, end: rec.origin.end } : null;
    if (existing && clash === "ignore") {
      fnd.push(finding("store/already-defined", "author-error", span, file, "\\" + def.name + " is already defined; \\" + def.form + " keeps the first definition (TeX errors, Pandoc keeps the first).", { name: def.name, form: def.form, firstForm: existing.form, first: existing.origin }));
      events.push({ type: "ignored", name: def.name, form: def.form, depth: frames.length, option, file });
      return { written: false, record: existing, findings: fnd };
    }
    if (existing && clash === "provide") {
      events.push({ type: "provided-noop", name: def.name, form: def.form, depth: frames.length, option, file });
      return { written: false, record: existing, findings: fnd };
    }
    if (!existing && clash === "renew")
      fnd.push(finding("store/renew-undefined", "author-error", span, file, "\\" + def.form + " of \\" + def.name + ", which is not defined here; it is defined anyway (TeX errors, Pandoc defines).", { name: def.name, form: def.form }));
    if (existing && clash === "robust")
      fnd.push(finding("store/pandoc-ignores-redefinition", "unsupported", span, file, "\\DeclareRobustCommand redefines \\" + def.name + " (TeX), but Pandoc keeps the first definition.", { name: def.name, first: existing.origin }));
    write(definitions, "undo", def.name, rec, !!def.global);
    events.push({ type: "define", name: def.name, form: def.form, kind: def.kind, global: !!def.global, depth: frames.length, option, file });
    return { written: true, record: rec, findings: fnd };
  }

  // \let and the copy forms (decision 4): copy the target's record as it
  // stands, or freeze an undefined target. The copy forms carry their own
  // clash rule (\NewCommandCopy of a defined name is ignored, like \newcommand).
  function letDef(def, file) {
    const fnd = [], row = FORMS.get(def.form), clash = row ? row.clash : "overwrite";
    const existing = definitions.get(def.name);
    const span = def.origin ? { start: def.origin.start, end: def.origin.end } : null;
    if (existing && clash === "ignore") {
      fnd.push(finding("store/already-defined", "author-error", span, file, "\\" + def.name + " is already defined; \\" + def.form + " keeps the first definition.", { name: def.name, form: def.form, first: existing.origin }));
      events.push({ type: "ignored", name: def.name, form: def.form, depth: frames.length, option, file });
      return { written: false, record: existing, findings: fnd };
    }
    if (!existing && clash === "renew")
      fnd.push(finding("store/renew-undefined", "author-error", span, file, "\\" + def.form + " of \\" + def.name + ", which is not defined here.", { name: def.name, form: def.form }));
    const target = def.aliasOf !== null ? definitions.get(def.aliasOf) : undefined;
    let rec;
    if (target) rec = Object.assign({}, target, { name: def.name, kind: "alias", aliasOf: def.aliasOf, form: def.form,
      global: !!def.global, source: "parsed", origin: Object.assign({}, def.origin, { file: file ?? def.origin.file }), viaOption: option });
    else rec = Object.assign(stamp(def, file), { kind: "frozen", params: [], defaultOf: {}, body: def.body });
    write(definitions, "undo", def.name, rec, !!def.global);
    events.push({ type: "define", name: def.name, form: def.form, kind: rec.kind, aliasOf: def.aliasOf, global: !!def.global, depth: frames.length, option, file });
    return { written: true, record: rec, findings: fnd };
  }

  // Hidden environments, DERIVED: every name whose record resolves — through
  // aliases, or by a frozen record's remembered target — to a hiding env.
  function hiddenEnvironments() {
    const out = [];
    for (const [name] of definitions) {
      const r = resolve(name);
      const target = r.record && r.record.kind === "frozen" ? r.record.aliasOf : r.chain[r.chain.length - 1];
      if (target && target !== name && HIDING_ENVS.has(target)) out.push(name);
    }
    return out;
  }

  // ---- frames: { and \begin{env} push; } and \end{env} pop and replay -----
  function openGroup(kind, name, at) {
    frames.push({ kind, name: name ?? null, at: at ?? null, undo: new Map(), flagUndo: new Map() });
    events.push({ type: "open", kind, name: name ?? null, depth: frames.length });
  }
  function replay(frame) {
    for (const [name, prev] of frame.undo) { if (prev === undefined) definitions.delete(name); else definitions.set(name, prev); }
    for (const [name, prev] of frame.flagUndo) { if (prev === undefined) flags.delete(name); else flags.set(name, prev); }
  }
  // A close with nothing open, or one that does not match the innermost
  // frame, is a finding, never a failure. When a matching frame sits lower
  // in the stack the frames above it are closed too (TeX would have
  // complained at each); when none matches, nothing is popped.
  function closeGroup(kind, name, at, file, span) {
    const fnd = [];
    if (!frames.length) {
      fnd.push(finding("store/unbalanced-close", "author-error", span, file, (kind === "env" ? "\\end{" + name + "}" : "}") + " with no group open.", { kind, name: name ?? null, at: at ?? null }));
      return fnd;
    }
    const matches = (f) => f.kind === kind && (kind !== "env" || f.name === name);
    let k = frames.length - 1;
    if (kind === "group" && !matches(frames[k])) k = -1;      // a stray } inside an environment is ignored (TeX: "Extra }")
    while (k >= 0 && !matches(frames[k])) k--;
    if (k < 0) {
      fnd.push(finding("store/mismatched-close", "author-error", span, file, (kind === "env" ? "\\end{" + name + "}" : "}") + " closes nothing that is open (innermost is " + describe(frames[frames.length - 1]) + ").", { kind, name: name ?? null, open: frames.map(describe) }));
      return fnd;
    }
    if (k !== frames.length - 1)
      fnd.push(finding("store/mismatched-close", "author-error", span, file, (kind === "env" ? "\\end{" + name + "}" : "}") + " arrives while " + frames.slice(k + 1).map(describe).join(", ") + " is still open; those are closed here.", { kind, name: name ?? null, closedEarly: frames.slice(k + 1).map(describe) }));
    while (frames.length > k) { const f = frames.pop(); replay(f); events.push({ type: "close", kind: f.kind, name: f.name, depth: frames.length }); }
    return fnd;
  }
  const describe = (f) => (f.kind === "env" ? "\\begin{" + f.name + "}" : f.name === "bgroup" ? "\\bgroup" : "{");
  const depth = () => frames.length;

  // ---- flags: \newif, booleans, toggles; scoped like definitions ------------
  // declareFlag(flag, { file, global }) from readFlagStatement's record.
  function declareFlag(flag, ctx) {
    const file = ctx && ctx.file, fnd = [], existing = flags.get(flag.name);
    if (existing && flag.provide) { events.push({ type: "flag-provided-noop", name: flag.name, depth: frames.length, option, file }); return { written: false, findings: fnd }; }
    if (existing && flag.family !== "newif")
      fnd.push(finding("store/flag-already-defined", "author-error", null, file, "The " + flag.family + " " + flag.name + " is already declared; \\" + flag.form + " declares it again.", { name: flag.name, form: flag.form }));
    const rec = { family: flag.family, value: !!flag.value, form: flag.form, file: file ?? null, viaOption: option };
    write(flags, "flagUndo", flag.name, rec, !!(ctx && ctx.global));
    events.push({ type: "flag-declare", name: flag.name, family: flag.family, depth: frames.length, option, file });
    return { written: true, findings: fnd };
  }
  // setFlag(name, value, { file, global }): a set of an undeclared flag is a finding and is still recorded.
  function setFlag(name, value, ctx) {
    const file = ctx && ctx.file, fnd = [], existing = flags.get(name);
    if (!existing) fnd.push(finding("store/flag-undefined", "author-error", null, file, "The flag " + name + " is set here but was never declared.", { name }));
    const rec = Object.assign({}, existing || { family: null, form: null, file: file ?? null }, { value: !!value, viaOption: option });
    write(flags, "flagUndo", name, rec, !!(ctx && ctx.global));
    events.push({ type: "flag-set", name, value: !!value, global: !!(ctx && ctx.global), depth: frames.length, option, file });
    return { written: true, findings: fnd };
  }
  // \Xtrue / \Xfalse for a declared \newif flag X → { name, value }; else null.
  function flagSetter(csName) {
    for (const [suffix, value] of [["true", true], ["false", false]]) {
      if (csName.length > suffix.length && csName.endsWith(suffix)) {
        const name = csName.slice(0, -suffix.length), f = flags.get(name);
        if (f && f.family === "newif") return { name, value };
      }
    }
    return null;
  }
  const flagValue = (name) => (flags.has(name) ? flags.get(name).value : undefined);

  // ---- option contexts, snapshot and diff --------------------------------
  function beginOption(pkg, opt) { option = pkg + "[" + (opt ?? "") + "]"; events.push({ type: "option-begin", option }); return option; }
  function endOption() { events.push({ type: "option-end", option }); option = null; }
  const currentOption = () => option;
  // A shallow copy of both tables; records are never mutated, so this is a
  // faithful picture of the moment.
  function snapshot() { return { definitions: new Map(definitions), flags: new Map(flags), depth: frames.length }; }
  // diff(a, b): names added, removed and changed between two snapshots, each
  // with the record on the later side (or the earlier, for removed).
  function diff(a, b) {
    const out = { added: [], removed: [], changed: [], flags: { added: [], removed: [], changed: [] } };
    const tables = [["definitions", out], ["flags", out.flags]];
    for (const [key, o] of tables) {
      for (const [name, rec] of b[key]) {
        if (!a[key].has(name)) o.added.push({ name, record: rec });
        else if (a[key].get(name) !== rec) o.changed.push({ name, record: rec, before: a[key].get(name) });
      }
      for (const [name, rec] of a[key]) if (!b[key].has(name)) o.removed.push({ name, record: rec });
    }
    return out;
  }

  return { define, lookup, resolve, has: (n) => definitions.has(n), names: () => [...definitions.keys()],
           openGroup, closeGroup, depth, frames: () => frames.map((f) => ({ kind: f.kind, name: f.name, at: f.at })),
           declareFlag, setFlag, flagSetter, flagValue, flags: () => new Map(flags),
           beginOption, endOption, currentOption, snapshot, diff, hiddenEnvironments, events };
}

// ---- walkDefinitions(tokens, file, store) --------------------------------
// Walks ONE token list and fills the store. Returns { findings, skipped,
// statements }. No frame is pushed at the file boundary; groups the file
// leaves open are reported (walk/group-left-open) and left open, as TeX
// would carry them into the next file.
const isWord = (t, name) => !!t && t.kind === "ControlWord" && t.name === name;
const spanOf = (tokens, open, close) => ({ start: tokens[open].start, end: tokens[Math.min(close, tokens.length - 1)].end });

// \DeclareOption{opt}{body} or \DeclareOption*{body}: the groups to step over.
function declareOptionExtent(tokens, i) {
  let k = skipSpaces(tokens, i + 1), star = false;
  if (tokens[k] && tokens[k].kind === "Other" && tokens[k].text === "*") { star = true; k++; }
  const g1 = readGroup(tokens, k);
  if (!g1) return null;
  if (star) return { option: "*", close: g1.close };
  const g2 = readGroup(tokens, g1.close + 1);
  return g2 ? { option: groupText(tokens, g1), close: g2.close } : null;
}
// \ifthenelse{test}{then}{else}: three groups.
function ifthenelseExtent(tokens, i) {
  const g1 = readGroup(tokens, i + 1); if (!g1) return null;
  const g2 = readGroup(tokens, g1.close + 1); if (!g2) return null;
  const g3 = readGroup(tokens, g2.close + 1); if (!g3) return null;
  return { test: groupText(tokens, g1), close: g3.close };
}
const skipBlanks = (tokens, i) => { while (i < tokens.length && (tokens[i].kind === "Space" || tokens[i].kind === "Comment")) i++; return i; };

export function walkDefinitions(tokens, file, store, hooks) {
  const findings = [], skipped = [], statements = [];
  const commands = (hooks && hooks.commands) || null;
  const startDepth = store.depth();
  const take = (list, span) => { for (const f of list) { f.file = file; if (span && !f.span) f.span = span; findings.push(f); } };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "BeginGroup") { store.openGroup("group", null, i); i++; continue; }
    if (t.kind === "EndGroup") { take(store.closeGroup("group", null, i, file, spanOf(tokens, i, i))); i++; continue; }
    if (t.kind !== "ControlWord") { i++; continue; }
    if (commands && commands.has(t.name)) {
      const next = commands.get(t.name)({ tokens, i, file, store, findings, skipped, statements });
      if (typeof next === "number") { i = next; continue; }
    }
    if (t.name === "bgroup") { store.openGroup("group", "bgroup", i); i++; continue; }
    if (t.name === "egroup") { take(store.closeGroup("group", "bgroup", i, file, spanOf(tokens, i, i))); i++; continue; }
    if (t.name === "begin" || t.name === "end") {
      const g = readGroup(tokens, i + 1);
      if (g) {
        const name = groupText(tokens, g);
        if (t.name === "begin") store.openGroup("env", name, i); else take(store.closeGroup("env", name, i, file, spanOf(tokens, i, g.close)));
        i = g.close + 1; continue;
      }
      i++; continue;
    }
    if (t.name === "DeclareOption") {                       // Stage 4 decides which options run
      const e = declareOptionExtent(tokens, i);
      if (e) { skipped.push({ kind: "DeclareOption", option: e.option, open: i, close: e.close, start: tokens[i].start, end: tokens[e.close].end }); i = e.close + 1; continue; }
    }
    if (t.name === "ifthenelse") {                          // Stage 5 decides the branch
      const e = ifthenelseExtent(tokens, i);
      if (e) { skipped.push({ kind: "ifthenelse", test: e.test, open: i, close: e.close, start: tokens[i].start, end: tokens[e.close].end }); i = e.close + 1; continue; }
    }
    // flags: \newif..., \newboolean{..}, \toggletrue{..}; \Xtrue / \Xfalse through the store; \global before either
    let k = i, global = false;
    if (t.name === "global") { const n = skipBlanks(tokens, i + 1); if (tokens[n] && tokens[n].kind === "ControlWord" && (readFlagStatement(tokens, n) || store.flagSetter(tokens[n].name))) { k = n; global = true; } }
    const fl = readFlagStatement(tokens, k);
    if (fl) {
      take(fl.findings);
      if (fl.flag) {
        const r = fl.flag.action === "declare" ? store.declareFlag(fl.flag, { file, global }) : store.setFlag(fl.flag.name, fl.flag.value, { file, global });
        take(r.findings, spanOf(tokens, i, fl.close));
        statements.push({ kind: "flag", form: fl.flag.form, name: fl.flag.name, start: tokens[i].start, end: tokens[fl.close].end, written: r.written });
      }
      i = fl.close + 1; continue;
    }
    const setter = store.flagSetter(tokens[k].name);
    if (setter) {
      const r = store.setFlag(setter.name, setter.value, { file, global });
      take(r.findings, spanOf(tokens, i, k));
      statements.push({ kind: "flag", form: tokens[k].name, name: setter.name, start: tokens[i].start, end: tokens[k].end, written: true });
      i = k + 1; continue;
    }
    // definitions: the whole statement is jumped, body included
    const d = readDefinition(tokens, i);
    if (d) {
      take(d.findings);
      const st = { kind: d.def ? d.def.kind : "unusable", form: d.def ? d.def.form : tokens[i].name, name: d.def ? d.def.name : null, start: tokens[d.open].start, end: tokens[d.close].end, written: false };
      if (d.def) { const r = store.define(d.def, { file }); take(r.findings); st.written = r.written; }
      statements.push(st);
      i = d.close + 1; continue;
    }
    i++;
  }
  if (store.depth() > startDepth && !(hooks && hooks.quietLeftOpen))
    findings.push(finding("walk/group-left-open", "author-error", null, file, (store.depth() - startDepth) + " group(s) opened in this file are still open at its end: " + store.frames().slice(startDepth).map((f) => (f.kind === "env" ? "\\begin{" + f.name + "}" : "{")).join(", ") + ".", { open: store.frames().slice(startDepth) }));
  return { findings, skipped, statements };
}
