// v2/source-map.mjs — session 272. A place in a -pp file back to the author's
// ORIGINAL file (sessions/INTEGRATION-REVIEW-s270.md D4; DECISIONS 2026-10-26:
// "yes, build it once in the tool, as a shared piece").
//
// Plain terms: Pandoc's log, and later the checker, point at places in the
// -pp copies the tool writes. The author never wrote those copies. This takes
// a place in any -pp file of a run - the entry, a subfile, a .sty - and says
// which original file, line and column it came from. Three things happened
// between the two texts, and they are undone in the opposite order:
//   1. a subfile converted on its own got its parent's preamble in place of
//      its \documentclass[main]{subfiles} line (v2/subfile-preamble.mjs);
//   2. the fixes' edits, each file's edit list from the walk (v2/walk.mjs);
//   3. the expander's written-out calls (v2/expand-body.mjs, its edits).
// Every answer says HOW the place relates to the author's text:
//   "author"      the author's own character, at that place;
//   "carried"     inside a fix's replacement, in a copy of the text it
//                 replaced (\long\def -> \def keeps the author's \def): the
//                 copy is the first place the replaced text occurs in the
//                 replacement, or the replacement in it, or else line by line
//                 in order (carryOf), so a wrong pick stays inside the
//                 replaced span and is always the same character;
//   "inserted"    text a fix added: the place it was added, and the range it
//                 replaced (empty for a pure insertion);
//   "written-out" text of a definition, written in place of a call: the call
//                 (an argument the author typed in the call stays "author").
// `preamble` is true when the place is in a parent preamble copied into a
// subfile: the file named is then the parent.
//
// Two steps, so that the platform can hold the map without the tool:
//   buildSourceMap(run, originals) -> plain data (JSON-safe), made once per run
//   mapPosition(map, file, { offset } | { line, column })   one place
//   mapRange(map, file, start, end)                          a range
// Lines and columns count from 1; a column counts the string's characters
// (UTF-16 units, a tab is one). Pandoc's own column rule (tabs to stops of 8)
// is for the step that reads Pandoc's log, not this one.
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).

// The offsets where each line begins.
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

// The verbatim copies a replacement holds of the text it replaced, as
// [{ rep, orig, n }]: where in the replacement, where in the replaced text, how
// long. The whole replaced text inside the replacement, or the replacement
// inside it; failing both (a version choice with another choice folded inside
// it), each line of the replacement found in the replaced text after the line
// before it - in order, so a line can only go forward.
function carryOf(was, rep) {
  if (was.length) { const k = rep.indexOf(was); if (k >= 0) return [{ rep: k, orig: 0, n: was.length }]; }
  if (rep.length) { const k = was.indexOf(rep); if (k >= 0) return [{ rep: 0, orig: k, n: rep.length }]; }
  const out = [];
  let r = 0, o = 0;
  while (r < rep.length) {
    const nl = rep.indexOf("\n", r), stop = nl < 0 ? rep.length : nl + 1;
    const line = rep.slice(r, stop);
    if (line.trim()) { const k = was.indexOf(line, o); if (k >= 0) { out.push({ rep: r, orig: k, n: line.length }); o = k + line.length; } }
    r = stop;
  }
  return out;
}

// buildSourceMap(run, originals)
//   run        runProject's result
//   originals  Map (or object) name -> the author's text, as given to runProject
export function buildSourceMap(run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const xedits = run.expansion && run.expansion.changed ? run.expansion.edits : new Map();
  const written = (p) => (run.expansion && run.expansion.files && run.expansion.files.has(p) ? run.expansion.files.get(p) : orig.get(p));
  const files = {}, lines = {};
  for (const [p, out] of run.output) {
    const before = written(p);
    const slot = run.walk && run.walk.byFile.get(p);
    const walk = slot ? [...slot.edits.list()].sort((a, b) => a.start - b.start || a.end - b.end).map((e) => ({
      start: e.start, end: e.end, len: e.replacement.length, by: e.by,
      carry: carryOf(before.slice(e.start, e.end), e.replacement) })) : [];
    const expand = (xedits.get(p) || []).map((e) => ({
      start: e.start, end: e.end, len: e.text.length, name: e.name,
      pieces: e.pieces.map((x) => [x.eFrom, x.eTo, x.oFrom]) }));
    const sp = run.splice && run.splice.file === p ? run.splice : null;
    files[p] = { lines: lineStarts(out), walk, expand,
                 splice: sp ? { parent: sp.parent, cutStart: sp.cut.start, cutEnd: sp.cut.end, take: sp.take } : null };
    if (orig.has(p)) lines[p] = lineStarts(orig.get(p));
  }
  return { version: 1, entry: run.entry, files, lines };
}

// A place in the text after a list of edits: outside every edit, the place
// before them; inside one, that edit and how far in.
function through(list, q) {
  let shift = 0;
  for (const e of list) {
    const a = e.start + shift, b = a + e.len;
    if (q < a) break;
    if (q < b) return { edit: e, off: q - a };
    shift += e.len - (e.end - e.start);
  }
  return { pos: q - shift };
}

// one step back through the walk's edits: { pos, how, by, start, end }
function backWalk(f, q) {
  const t = through(f.walk, q);
  if (!t.edit) return { pos: t.pos, how: "author", by: null, start: t.pos, end: t.pos + 1 };
  const e = t.edit, c = e.carry.find((x) => t.off >= x.rep && t.off < x.rep + x.n);
  if (c) {
    const pos = e.start + c.orig + t.off - c.rep;
    return { pos, how: "carried", by: e.by, start: pos, end: pos + 1 };
  }
  return { pos: e.start, how: "inserted", by: e.by, start: e.start, end: e.end };
}

// one step back through the expander's written-out calls
function backExpand(f, w) {
  const t = through(f.expand, w);
  if (!t.edit) return { pos: t.pos, out: false };
  const p = t.edit.pieces.find(([from, to]) => from <= t.off && t.off < to);
  if (p) return { pos: p[2] + t.off - p[0], out: false };
  return { pos: t.edit.start, out: true, start: t.edit.start, end: t.edit.end, by: "\\" + t.edit.name };
}

// mapPosition(map, file, { offset } | { line, column }) -> the answer, or
// null for a file the run did not write
//   { file, offset, line, column, how, by, range: { start, end, from, to }, preamble }
export function mapPosition(map, file, where) {
  const pp = map.files[file];
  if (!pp) return null;
  let q = where && Number.isInteger(where.offset) ? where.offset
        : pp.lines[Math.max(0, Math.min(pp.lines.length - 1, where.line - 1))] + where.column - 1;
  // 1. the parent preamble copied into a subfile
  let f = file, preamble = false;
  const s = pp.splice;
  if (s && q >= s.cutStart) {
    if (q < s.cutStart + s.take) { f = s.parent; q -= s.cutStart; preamble = true; }
    else q = q - s.take + (s.cutEnd - s.cutStart);
  }
  const fm = map.files[f];
  // 2. the fixes' edits
  const w = backWalk(fm, q);
  // 3. the written-out calls
  let how = w.how, by = w.by, start, end, offset;
  const a = backExpand(fm, w.pos);
  offset = a.pos;
  if (a.out && how !== "inserted") { how = "written-out"; by = a.by; start = a.start; end = a.end; }
  else if (how === "inserted") {
    const b = w.end > w.start ? backExpand(fm, w.end - 1) : a;
    start = a.out ? a.start : a.pos;
    end = w.end > w.start ? (b.out ? b.end : b.pos + 1) : (a.out ? a.end : a.pos);
  } else { start = offset; end = offset + 1; }
  const ls = map.lines[f];
  const at = ls ? lineColumn(ls, offset) : { line: null, column: null };
  return { file: f, offset, line: at.line, column: at.column, how, by,
           range: { start, end, from: ls ? lineColumn(ls, start) : null, to: ls ? lineColumn(ls, end) : null }, preamble };
}

const WEIGHT = { author: 0, carried: 1, "written-out": 2, inserted: 3 };

// mapRange(map, file, start, end) -> { file, start, end, from, to, how, by, preamble, split }
// end is exclusive. A range that begins in a copied parent preamble and ends
// in the subfile's own text is cut at the preamble's end (split: true).
export function mapRange(map, file, start, end) {
  const m1 = mapPosition(map, file, { offset: start });
  if (!m1) return null;
  const m2 = end > start ? mapPosition(map, file, { offset: end - 1 }) : m1;
  const split = m2.file !== m1.file || m2.preamble !== m1.preamble;
  const e = split ? m1.range.end : Math.max(m1.range.end, m2.range.end);
  const s = Math.min(m1.range.start, e);
  const worse = WEIGHT[m2.how] > WEIGHT[m1.how] && !split ? m2 : m1;
  const ls = map.lines[m1.file];
  return { file: m1.file, start: s, end: e, from: ls ? lineColumn(ls, s) : null, to: ls ? lineColumn(ls, e) : null,
           how: worse.how, by: worse.by, preamble: m1.preamble, split };
}
