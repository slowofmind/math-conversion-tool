// v2/a11y/check.mjs — session a11y-04. The accessibility checker's two modes,
// and the entries it hands back (DECISIONS 2026-10-26: D1 A, one chain with
// each step also runnable alone; D3 A, one shared finding format; D4 A, one map
// back to the original; findings "marking a problem inside an author's command
// at both the call and the definition").
//
// Plain terms:
//   checkRun(run, originals)     WITH the preprocessor: reads each -pp text of a
//                                run (what Pandoc will read), and places every
//                                finding in the author's ORIGINAL file through
//                                v2/source-map.mjs. A problem found in a command
//                                the preprocessor wrote out is reported at each
//                                call and once at the command's definition; the
//                                entries share one link id.
//   checkOriginals(files)        ALONE: the original files with the
//                                preprocessor's fixes off. Positions are already
//                                in the original. Author commands are not
//                                written out, so a problem inside one is not
//                                seen; where the preprocessor would change what
//                                Pandoc gets, the finding says so.
// Both read the document in its reading order (the entry, then each file an
// \input / \include / \subfile reads, at the place it reads it), so heading
// levels are judged over the whole document.
//
// Entries have v2/findings.mjs's shape, source "checker"; `from.list` says
// which text was read ("pp" or "original"). Not hooked into runProject or the
// preprocessor's report (the combined report is a later piece).
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).
import { classifyFiles, readDocument, INCLUDE_ONE, INCLUDE_TWO } from "../reader.mjs";
import { readGroup, readBracket } from "../structure.mjs";
import { groupText } from "../definition.mjs";
import { buildSourceMap, mapPosition, mapRange } from "../source-map.mjs";
import { mapper } from "../expand-body.mjs";
import { inventoryOf } from "./inventory.mjs";
import { runChecks } from "./checks.mjs";
import { partFixApplies } from "../transforms/part-chapter.mjs";
import { WORDING, inCommand } from "./wording.mjs";

function lineStarts(text) {
  const s = [0];
  for (let j = 0; j < text.length; j++) if (text.charCodeAt(j) === 10) s.push(j + 1);
  return s;
}
function lineColumn(starts, off) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
  return { line: lo + 1, column: off - starts[lo] + 1 };
}

// The document class: the entry's \documentclass, or a subfile's parent's.
function classOf(entry, project, reader) {
  const of = (p) => {
    const info = project.byPath.get(p);
    if (!info) return null;
    const ts = info.tokens;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].kind !== "ControlWord" || ts[i].name !== "documentclass") continue;
      const o = readBracket(ts, i + 1), g = readGroup(ts, o ? o.close + 1 : i + 1);
      return g ? groupText(ts, g).trim() : null;
    }
    return null;
  };
  const c = of(entry);
  if (c !== "subfiles") return c;
  const row = reader.record.find((r) => r.file === entry && r.what === "load subfiles" && r.parent);
  return row ? of(row.parent) : c;
}

// One document's reading: its inventories in reading order, and the merged
// lists the checks read. texts: the texts read (the -pp texts, or the originals).
function readDocumentFor(texts, entry) {
  const project = classifyFiles(texts);
  const reader = readDocument(entry, texts, { project });
  const cls = classOf(entry, project, reader);
  const opts = { exam: cls === "exam", hidden: reader.summary.hiddenEnvironments || [] };
  // the files each include read, by the including file and line, in order
  const reads = new Map();
  for (const r of reader.record) {
    if (!r.target) continue;                 // s285: the reader names the opened file as a field
    const cmd = String(r.what || "").split(" ")[0];
    if (!INCLUDE_ONE.has(cmd) && !INCLUDE_TWO.has(cmd)) continue;
    const key = r.file + "\u0001" + r.line;
    if (!reads.has(key)) reads.set(key, []);
    reads.get(key).push(r.target);
  }
  const inventories = new Map(), order = [], visited = new Set();
  const doc = { cls, headings: [], bold: [], images: [], tables: [], tagging: { metadata: false, on: false, headerRows: false } };
  const visit = (file) => {
    if (visited.has(file) || !project.byPath.has(file)) return;
    visited.add(file); order.push(file);
    const inv = inventoryOf(project.byPath.get(file).tokens, opts);
    inventories.set(file, inv);
    for (const k of ["bold", "images", "tables"]) for (const x of inv[k]) doc[k].push(Object.assign({ file }, x));
    for (const k of ["metadata", "on", "headerRows"]) doc.tagging[k] = doc.tagging[k] || inv.tagging[k];
    const ls = lineStarts(texts.get(file) || ""), used = new Map();
    const seq = [...inv.headings.map((h) => ({ h })), ...inv.includes.map((x) => ({ x }))].sort((a, b) => (a.h || a.x).start - (b.h || b.x).start);
    for (const s of seq) {
      if (s.h) { doc.headings.push(Object.assign({ file }, s.h)); continue; }
      const key = file + "\u0001" + lineColumn(ls, s.x.start).line;
      const list = reads.get(key) || [], n = used.get(key) || 0;
      used.set(key, n + 1);
      if (n < list.length) visit(list[n]);
    }
  };
  visit(entry);
  return { project, reader, doc, inventories, order };
}

// A finding and its wording, as an entry of the shared format.
function entryOf(raw, where, mode, extra = {}) {
  const w = WORDING[raw.id], v = w.variants[raw.variant];
  return { source: "checker", kind: w.kind, visible: true, level: v.level || w.level, rule: "a11y/" + raw.id, where, label: w.label,
           message: v.message(raw.data) + (extra.suffix || ""),
           fixes: v.fixes(raw.data).map((d) => ({ description: d, mayApply: "source", replayable: false, applied: false })),
           ways: (v.ways || w.ways).map((x) => ({ way: x.way, serves: [...x.serves], rank: x.rank })), rank: raw.rank,
           from: { list: mode, channel: null, level: null }, link: extra.link || null };
}
const whereIn = (file, ls, start, end, written = null) => {
  const a = lineColumn(ls, start), b = lineColumn(ls, end);
  return { file, line: a.line, column: a.column, start, end, endLine: b.line, endColumn: b.column, written };
};

// checkOriginals(files, { entry, encourage }) -> { entries, entry, files: [read order] }
export function checkOriginals(files, options = {}) {
  const texts = files instanceof Map ? files : new Map(Object.entries(files || {}));
  const entry = options.entry || classifyFiles(texts).documents[0];
  const r = readDocumentFor(texts, entry);
  const store = r.reader.store;
  r.doc.mode = "original";
  r.doc.isAuthorCommand = (name) => { const rec = store.lookup(name); return !!rec && !!rec.origin && texts.has(rec.origin.file); };
  // session 274: would the preprocessor write this document's \part headings as \chapter (the same rule)?
  r.doc.partFixed = partFixApplies({ cls: r.doc.cls, usesChapter: !!store.lookup("chapter") ||
    r.order.some((f) => r.project.byPath.get(f).tokens.some((t) => t.kind === "ControlWord" && t.name === "chapter")) });
  const raw = runChecks(r.doc, { encourage: !!options.encourage });
  const starts = new Map(), ls = (f) => { if (!starts.has(f)) starts.set(f, lineStarts(texts.get(f) || "")); return starts.get(f); };
  return { entry, files: r.order, entries: raw.map((x) => entryOf(x, whereIn(x.file, ls(x.file), x.start, x.end), "original")) };
}

// Session 274: a finding at text the preprocessor replaced, with the command
// word the author wrote there (\part, where the -pp copy has \chapter) in its
// data's `name`, the star kept.
function asWritten(raw, text, range) {
  const m = /^\\([A-Za-z]+)$/.exec(text.slice(range.start, range.end));
  if (!m || !raw.data || typeof raw.data.name !== "string") return raw;
  return Object.assign({}, raw, { data: Object.assign({}, raw.data, { name: raw.data.name.replace(/^[A-Za-z]+/, m[1]) }) });
}

const sameHead = (a, b) => !!a && !!b && a.cw === b.cw && a.env === b.env;

// checkRun(run, originals, { encourage }) -> { entries, entry, files, dropped }
//   run        runProject's result;  originals  the author's texts, as given to it
//   dropped    findings in text the preprocessor itself inserted (counted, not reported)
export function checkRun(run, originals, options = {}) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const texts = run.output;
  const r = readDocumentFor(texts, run.entry);
  r.doc.mode = "pp";
  const raw = runChecks(r.doc, { encourage: !!options.encourage });
  const sm = buildSourceMap(run, orig);
  const starts = new Map(), ls = (f) => { if (!starts.has(f)) starts.set(f, lineStarts(orig.get(f) || "")); return starts.get(f); };
  const back = run.expansion && run.expansion.changed ? mapper(run.expansion.edits) : (f, p) => ({ pos: p, exact: true });
  const store = run.reader && run.reader.store;
  const entries = [], defs = new Map(), dropped = [];
  // every inventory item's first token, mapped: for the k-th same construct inside one call
  const itemsOf = (file) => {
    const inv = r.inventories.get(file);
    return inv ? [...inv.headings, ...inv.bold, ...inv.images, ...inv.tables] : [];
  };
  for (const x of raw) {
    const head = mapPosition(sm, x.file, { offset: x.start });
    if (!head) { dropped.push({ why: "no map", raw: x }); continue; }
    // session 274: text the preprocessor put IN PLACE of the author's (\part
    // written \chapter) is reported at the author's text, naming what the
    // author wrote there; text it only added is not the author's to fix
    if (head.how === "inserted" && head.range.end > head.range.start) {
      const m = mapRange(sm, x.file, x.start, x.end);
      const end = m && m.file === head.file && !m.split ? Math.max(m.end, head.range.end) : head.range.end;
      entries.push(entryOf(asWritten(x, orig.get(head.file) || "", head.range), whereIn(head.file, ls(head.file), head.range.start, end), "pp"));
      continue;
    }
    if (head.how === "inserted") { dropped.push({ why: "inserted by the preprocessor", raw: x, by: head.by }); continue; }
    if (head.how !== "written-out") {
      const m = mapRange(sm, x.file, x.start, x.end);
      const end = m && m.file === head.file && !m.split ? Math.max(m.end, head.offset + 1) : head.range.end;
      entries.push(entryOf(x, whereIn(head.file, ls(head.file), head.offset, end), "pp"));
      continue;
    }
    // inside a command the preprocessor wrote out: the call, and the definition
    // which of the same constructs written out by this one call it is (k), to
    // pick the same one inside the definition
    const name = head.by;
    const same = itemsOf(x.file).filter((it) => {
      if (!sameHead(it.head, x.head)) return false;
      const p = mapPosition(sm, x.file, { offset: it.start });
      return p && p.how === "written-out" && p.by === name && p.range.start === head.range.start;
    }).map((it) => it.start).sort((a, b) => a - b);
    const kth = Math.max(0, same.indexOf(x.start));
    const def = definitionPlace(store, name.slice(1), x.head || {}, kth, orig, back);
    const callWhere = whereIn(head.file, ls(head.file), head.range.start, head.range.end, name);
    let link = null;
    if (def) {
      const id = "a11y/" + x.id + "@" + def.file + ":" + def.start;
      link = { id, role: "call", name };
      if (!defs.has(id)) {
        const dw = whereIn(def.file, ls(def.file), def.start, def.end);
        defs.set(id, entryOf(x, dw, "pp", { link: { id, role: "definition", name }, suffix: inCommand(name, "definition") }));
      }
    }
    entries.push(entryOf(x, callWhere, "pp", { link, suffix: inCommand(name, "call", def ? { line: lineColumn(ls(def.file), def.start).line, file: def.file } : null) }));
  }
  return { entry: run.entry, files: r.order, entries: entries.concat([...defs.values()]), dropped };
}

// Where, inside a command's definition, the k-th construct with this first
// token is - following the author's commands it calls, in order, as the
// written-out text does. Positions go back from the written-out text the store
// read to the original files. Null when the command is not the author's.
// When the construct is not found (a branch the expander settled), the
// definition statement itself.
function definitionPlace(store, name, head, k, orig, back) {
  if (!store) return null;
  const rec0 = store.lookup(name);
  if (!rec0 || !rec0.origin || !orig.has(rec0.origin.file) || !Array.isArray(rec0.body)) return null;
  const found = [], seen = new Set();
  const walk = (rec, depth) => {
    if (depth > 8 || seen.has(rec)) return;
    seen.add(rec);
    const body = rec.body, file = rec.origin.file;
    for (let i = 0; i < body.length; i++) {
      const t = body[i];
      if (t.kind !== "ControlWord") continue;
      if (head.cw !== undefined && t.name === head.cw) { found.push({ file, start: t.start, end: t.end }); continue; }
      if (head.env !== undefined && t.name === "begin") {
        const g = readGroup(body, i + 1);
        if (g && groupText(body, g).trim() === head.env) found.push({ file, start: t.start, end: body[g.close].end });
        continue;
      }
      const sub = store.lookup(t.name);
      if (sub && sub !== rec && sub.origin && orig.has(sub.origin.file) && Array.isArray(sub.body) && (sub.kind === "macro" || sub.kind === "alias")) walk(sub, depth + 1);
    }
  };
  walk(rec0, 0);
  const at = found.length ? found[Math.min(k, found.length - 1)] : { file: rec0.origin.file, start: rec0.origin.start, end: rec0.origin.end };
  const s = back(at.file, at.start, "start").pos, e = back(at.file, at.end, "end").pos;
  return { file: at.file, start: s, end: Math.max(e, s + 1), approximate: !found.length };
}
