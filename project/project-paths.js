// project-paths.js — conversion copies. Pandoc's LaTeX reader resolves \input-family targets (and
// the Lua filters resolve image paths) from the project ROOT and nowhere else: not the document's
// folder, not the resource path, not the including file's folder (measured:
// project-paths\_work\probe-paths.txt). So before a conversion, the text of the document being
// converted, and of every file it reaches, is given with each such path written from the root,
// resolved the way TeX would from the document's own folder. Used ONLY for the text handed to
// Pandoc: the project's files are never changed. Only path text inside a line changes, so line
// numbers in Pandoc's messages still match the files. Plan: project-paths\NOTE-PROJECT-PATHS.md.
import { maskForDetection } from '../image-extraction/code-figure-detect.js';

export const MODULE_VERSION = '1.0.0';

// \input-family commands are followed (their targets are read too); the rest are only rewritten.
const CMD = /\\(input|includestandalone|include|subfile|subimport|import|includegraphics|includesvg|lstinputlisting|inputminted|graphicspath)(?![A-Za-z@])/g;
const TWO_ARGS = new Set(['import', 'subimport', 'inputminted']);
const TEX_KIND = new Set(['input', 'include', 'subfile', 'includestandalone']);
const IMAGE_KIND = new Set(['includegraphics', 'includesvg']);
// graphicx's own list, plus .svg and .gif (PDF images and the Resolve filter).
const IMG_EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.mps', '.jbig2', '.jb2',
  '.PDF', '.PNG', '.JPG', '.JPEG', '.SVG'];
// Just before a command that is being DEFINED, not used: \providecommand\includegraphics,
// \renewcommand{\input}, \let\include\relax.
const DEFINING = /\\(?:(?:new|renew|provide)command|(?:New|Renew|Provide|Declare)DocumentCommand|DeclareRobustCommand|[gex]?def|let)\*?\s*\{?\s*$/;

const now = () => (globalThis.performance && performance.now) ? performance.now() : Date.now();
const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);              // '' at the root, else 'a/b/'
const asBase = d => (d ? d.replace(/\/?$/, '/') : '');
const hasExt = p => /\.[A-Za-z0-9]+$/.test(p.slice(p.lastIndexOf('/') + 1));
const lineAt = (text, i) => { let n = 1; for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) n++; return n; };

/**
 * The folders a document's references are looked for in, before the root: its own folder, then
 * (enclosing on, the default) each folder enclosing it, nearest first. 'a/b/doc.tex' -> ['a/b/', 'a/'];
 * a document at the root -> []. Conversion uses it here; the extraction run gives the compile the
 * same list as \input@path (image-extraction/extraction-run.js earlyBlockFor).
 */
export function searchFolders(master, { enclosing = true } = {}) {
  const D = dirOf(String(master || ''));
  const out = D ? [D] : [];
  if (enclosing) for (let d = dirOf(D.slice(0, -1)); d; d = dirOf(d.slice(0, -1))) out.push(d);
  return out;
}

/** 'a/./b/../c' -> 'a/c'; null when it climbs out of the project or is absolute. */
function norm(p) {
  if (/^(\/|[A-Za-z]:)/.test(p)) return null;
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}
/** { ... } at i: index AFTER the matching brace, or -1. */
function group(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return j + 1;
  }
  return -1;
}
/** [ ... ] at i, braces inside respected: index AFTER ']', or -1. */
function bracket(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') { const e = group(s, j); if (e < 0) return -1; j = e - 1; continue; }
    if (c === '[') d++; else if (c === ']' && --d === 0) return j + 1;
  }
  return -1;
}

/**
 * Every path-bearing command in the text, found in the masked copy (comments, verbatim, \verb and
 * \iffalse branches never count). Each: { cmd, start, end, from, args: [{ a, b }] } where a..b is
 * the inside of a braced argument (or TeX's brace-less \input name, with bare: true; then from..end
 * is the stretch replaced by "{path}"). The file argument is the LAST one.
 */
export function referencesIn(text) {
  const masked = maskForDetection(text);
  const found = [];
  const ws = j => { while (j < masked.length && /\s/.test(masked[j])) j++; return j; };
  CMD.lastIndex = 0;
  let m;
  while ((m = CMD.exec(masked))) {
    const cmd = m[1];
    if (DEFINING.test(masked.slice(Math.max(0, m.index - 40), m.index))) continue;
    let i = m.index + m[0].length;
    if (masked[i] === '*') i++;
    if (cmd === 'input' && (masked[i] === ' ' || masked[i] === '\t')) {      // TeX's \input name
      let j = i; while (masked[j] === ' ' || masked[j] === '\t') j++;
      if (masked[j] !== '{') {
        let k = j; while (k < masked.length && !/[\s{}\\%]/.test(masked[k])) k++;
        if (k > j) found.push({ cmd, start: m.index, from: i, end: k, bare: true, args: [{ a: j, b: k }] });
        CMD.lastIndex = Math.max(k, CMD.lastIndex);
        continue;
      }
    }
    let j = ws(i);
    while (masked[j] === '[') { const e = bracket(masked, j); if (e < 0) break; j = ws(e); }
    const need = TWO_ARGS.has(cmd) ? 2 : 1, args = [];
    for (let n = 0; n < need; n++) {
      if (n) j = ws(j);
      if (masked[j] !== '{') break;
      const e = group(masked, j);
      if (e < 0) break;
      let a = j + 1, b = e - 1;                        // trimmed in the masked copy: a comment
      while (a < b && /\s/.test(masked[a])) a++;       // inside the braces ({% then a new line)
      while (b > a && /\s/.test(masked[b - 1])) b--;   // is blanked there, so falls outside
      args.push({ a, b });
      j = e;
    }
    if (args.length === need) found.push({ cmd, start: m.index, end: j, args });
    CMD.lastIndex = Math.max(j, CMD.lastIndex);
  }
  return found;
}

/** The folders a \graphicspath{{a/}{b/}} names, as written. */
function graphicsDirs(text, refs) {
  const dirs = [];
  for (const r of refs) {
    if (r.cmd !== 'graphicspath') continue;
    const inner = text.slice(r.args[0].a, r.args[0].b);
    for (let i = inner.indexOf('{'); i !== -1; i = inner.indexOf('{', i)) {
      const e = group(inner, i);
      if (e < 0) break;
      const d = inner.slice(i + 1, e - 1).trim();
      if (d && !/[\\#]/.test(d)) dirs.push(d);
      i = e;
    }
  }
  return dirs;
}

/**
 * The text Pandoc should read for `master` (the document being converted, resolved from its OWN
 * folder, as TeX would compile it) and copies of the files it reaches, each path written from the
 * root. getText(path) gives the text Pandoc would be served (null for binary files).
 * enclosing (on unless false): also try the folders enclosing the document's, nearest first, after TeX's own folder
 * and before the root (documents compiled from a project folder above them, as in Overleaf
 * snapshots; subfiles whose paths are written from their main file's folder).
 * Returns { main, copies: Map(path -> text; only reached files that change), changes: [{ file,
 * line, command, from, to }], unresolved: [{ file, line, command, ref, why }], reached, ms }.
 */
export function conversionCopies({ master, paths, getText, enclosing = true }) {
  const t0 = now();
  const S = new Set(paths);
  const D = dirOf(master);
  const ANC = searchFolders(master, { enclosing }).slice(1);   // enclosing folders, nearest first
  const texFile = c => (!hasExt(c) && S.has(c + '.tex')) ? c + '.tex' : S.has(c) ? c : S.has(c + '.tex') ? c + '.tex' : null;
  const imageFound = c => IMG_EXTS.some(e => S.has(c + e))
    || (/\.pdf$/i.test(c) && ['.svg', '.png'].some(e => S.has(c.replace(/\.pdf$/i, e))));
  const plainFound = c => (S.has(c) ? c : null);
  const resolve = (ref, bases, test) => {
    for (const b of new Set(bases.filter(x => typeof x === 'string'))) {
      const c = norm(b + ref);
      if (!c) continue;
      const hit = test(c);
      if (hit) return { written: c, file: typeof hit === 'string' ? hit : c };
    }
    return null;
  };
  const texts = new Map(), refsOf = new Map(), importBase = new Map();
  const reached = [], unresolved = [], changes = [];
  const textOf = p => {
    if (!texts.has(p)) { const t = getText(p); texts.set(p, typeof t === 'string' ? t : null); }
    return texts.get(p);
  };
  const argText = (text, g) => { const s = text.slice(g.a, g.b).trim(); return /^".*"$/.test(s) ? s.slice(1, -1) : s; };
  const whyNot = s => (/#/.test(s) ? 'inside a definition (its uses are not followed)' : /\\/.test(s) ? 'built by a macro' : null);
  const report = (p, text, r, ref, why) =>
    unresolved.push({ file: p, line: lineAt(text, r.start), command: '\\' + r.cmd, ref, why });

  // 1. Follow the \input family from the document, breadth first.
  const queue = [[master, null]], seen = new Set([master]);
  while (queue.length) {
    const [p, ib] = queue.shift();
    reached.push(p);
    const text = textOf(p);
    if (text == null) continue;
    importBase.set(p, ib);
    const refs = referencesIn(text);
    refsOf.set(p, refs);
    for (const r of refs) {
      const isImport = r.cmd === 'import' || r.cmd === 'subimport';
      if (!TEX_KIND.has(r.cmd) && !isImport) continue;
      const file = argText(text, r.args[r.args.length - 1]);
      const dir = isImport ? argText(text, r.args[0]) : '';
      const ref = isImport ? asBase(dir) + file : file;
      if (!file) continue;
      const why = whyNot(ref);
      if (why) { report(p, text, r, ref, why); continue; }
      const bases = r.cmd === 'import' ? [D, ...ANC, ''] : r.cmd === 'subimport' ? [ib || dirOf(p), D, ...ANC, ''] : [ib, D, ...ANC, ''];
      const res = resolve(ref, bases, texFile);
      if (!res) { report(p, text, r, ref, 'not found'); continue; }
      r.res = res; r.ref = ref; r.whole = isImport;
      if (!seen.has(res.file)) { seen.add(res.file); queue.push([res.file, isImport ? dirOf(res.file) : ib]); }
    }
  }

  // 2. \graphicspath folders anywhere in what the document reaches (TeX: from the document's folder).
  const gpDirs = [];
  for (const p of reached) {
    const text = textOf(p);
    if (text != null) gpDirs.push(...graphicsDirs(text, refsOf.get(p)));
  }
  // Each folder, then the \graphicspath folders under it (TeX: the name as given, then each).
  const imageBases = [D, ...ANC, ''].flatMap(b => [b, ...gpDirs.map(g => norm(b + g)).filter(n => n !== null).map(asBase)]);

  // 3. Resolve images and listings; rewrite each reached file.
  const copies = new Map();
  let main = textOf(master);
  for (const p of reached) {
    const text = textOf(p);
    if (text == null) continue;
    const ib = importBase.get(p);
    for (const r of refsOf.get(p)) {
      const image = IMAGE_KIND.has(r.cmd), listing = r.cmd === 'lstinputlisting' || r.cmd === 'inputminted';
      if (!image && !listing) continue;
      const ref = argText(text, r.args[r.args.length - 1]);
      if (!ref) continue;
      const why = whyNot(ref);
      if (why) { report(p, text, r, ref, why); continue; }
      const res = image ? resolve(ref, [ib, ...imageBases], imageFound) : resolve(ref, [ib, D, ...ANC, ''], plainFound);
      if (!res) { report(p, text, r, ref, 'not found'); continue; }
      r.res = res; r.ref = ref;
    }
    const edits = [];
    for (const r of refsOf.get(p)) {
      if (!r.res || (r.res.written === r.ref && !r.whole)) continue;   // \import always becomes \input
      const to = r.res.written;
      if (r.whole) edits.push([r.start, r.end, `\\input{${to}}`]);
      else if (r.bare) edits.push([r.from, r.end, `{${to}}`]);
      else { const g = r.args[r.args.length - 1]; edits.push([g.a, g.b, to]); }
      changes.push({ file: p, line: lineAt(text, r.start), command: '\\' + r.cmd, from: r.ref, to });
    }
    if (!edits.length) continue;
    let out = text;
    for (const [a, b, s] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + s + out.slice(b);
    if (p === master) main = out; else copies.set(p, out);
  }
  return { main, copies, changes, unresolved, reached, ms: Math.round((now() - t0) * 10) / 10 };
}
