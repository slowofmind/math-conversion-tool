// code-figure-detect.js — predicts, WITHOUT compiling, how many figures drawn in code a project
// holds: the figures the extraction compile (extraction-run.js, memoize) would capture.
// Plain data in, plain data out: no UI, no engine, no project model. Design and evidence:
// code-image-detection\NOTE-CODE-IMAGE-DETECTION.md (build plan step 1; tikz-cd guard 2026-10-01).
// Gate: busytex-tikz-harness\test-detect.mjs.
//
// COUNTED, once per USE, outermost only, in document text (after \begin{document} in a file with
// \documentclass; all of a .tex/.ltx/.tikz/.pgf file without one; never .sty/.cls/.def/.cfg):
//   tikzpicture, \tikz (braced and semicolon forms), forest, picture, pgfpicture, circuitikz;
//   tikzcd only when the guard allows its registration; and the project's own environments and
//   commands that draw, followed through definitions to any depth (a definition draws if its body
//   uses a drawing construct or another drawing definition). A savebox counts once.
// NOT COUNTED: comments; verbatim-like blocks, \verb, \lstinline; \iffalse..\fi (so figures the
//   rewriter has already extracted, which it comments out, drop out by themselves); text inside
//   definitions; pictures whose own options say `remember picture` (memoize declines them);
//   package loads by themselves (a file can load tikz and draw nothing).
// A PREDICTION: memoize stays the ground truth. Decorations drawn with \tikz (circled terms,
// icons, row spacers) ARE counted, because memoize captures them (decoration detection is parked
// until the preflight design, 2026-09-09). A command that draws twice counts once per use.
import { readBalancedGroup } from './latex-scanner.js';

export const MODULE_VERSION = '1.0.0';

// Drawing constructs the extraction captures (picture, pgfpicture and circuitikz once step 2
// registers them). tikzcd is handled apart: see the guard below.
const DRAW_ENVS = new Set(['tikzpicture', 'picture', 'pgfpicture', 'circuitikz', 'forest']);
// Blanked before scanning: their content is shown as code, never drawn.
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'BVerbatim',
  'LVerbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*']);
// Surroundings where \mmzset{auto={tikzcd}{memoize, verbatim}} was MEASURED to compile
// (code-image-detection\_work\tools-probe6/7/7b/7c/7d). Anything else blocks the registration.
// Theorem-like environments the project declares are added at run time.
const CD_SAFE_ENVS = new Set(['document', 'center', 'flushleft', 'flushright', 'figure', 'table',
  'equation', 'equation*', 'displaymath', 'subequations', 'tabular', 'minipage', 'enumerate',
  'itemize', 'description', 'quote', 'proof', 'multicols', 'tcolorbox', 'frame[fragile]']);
// Real conditionals, for matching \iffalse with its \fi. \iff, \ifthenelse and the like are
// ordinary commands; conditionals made with \newif are found in the project and added.
const TEX_CONDITIONALS = new Set(['if', 'ifcat', 'ifnum', 'ifdim', 'ifodd', 'ifvmode', 'ifhmode',
  'ifmmode', 'ifinner', 'ifvoid', 'ifhbox', 'ifvbox', 'ifx', 'ifeof', 'iftrue', 'iffalse',
  'ifcase', 'ifdefined', 'ifcsname', 'iffontchar', 'ifincsname', 'ifpdfprimitive', 'ifabsnum',
  'ifabsdim', 'ifpdf', 'ifxetex', 'ifluatex', 'ifPDFTeX', 'ifXeTeX', 'ifLuaTeX']);

// One token at a time: \begin{X} / \end{X}, a control word, a control symbol (so \\ is consumed
// whole and its second backslash never starts a command), or a brace.
const TOKEN = /\\(?:(begin|end)\s*\{([^{}]*)\}|([A-Za-z@]+)|[^A-Za-z@])|([{}])/g;

const isLetter = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = c => isLetter(c) || c === 64;   // letters and @
const isSpace = ch => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
const now = () => (globalThis.performance && performance.now) ? performance.now() : Date.now();
const skipWs = (s, i) => { while (i < s.length && isSpace(s[i])) i++; return i; };
function readWord(s, i, at) {
  let j = i;
  while (j < s.length && (at ? isNameChar(s.charCodeAt(j)) : isLetter(s.charCodeAt(j)))) j++;
  return j;
}
/** { ... } starting at i: index AFTER the closing brace, or -1. */
function readBrace(s, i) {
  if (s[i] !== '{') return -1;
  const g = readBalancedGroup(s, i);
  return g ? g.endIndex + 1 : -1;
}
/** [ ... ] starting at i, nested [ ] and { } respected: index AFTER ']', or -1. */
function readBracket(s, i) {
  if (s[i] !== '[') return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') depth++;
    else if (c === ']') { if (--depth === 0) return j + 1; }
    else if (c === '{') { const g = readBalancedGroup(s, j); if (!g) return -1; j = g.endIndex; }
  }
  return -1;
}

/**
 * A copy of the text, SAME LENGTH and same line breaks, with everything that is never drawn
 * blanked to spaces: comments, verbatim-like blocks, \verb / \lstinline, and \iffalse branches.
 * One left-to-right pass, so a % inside verbatim does not start a comment and a \begin{verbatim}
 * inside a comment does not start verbatim. FIND in the masked copy; positions match the original.
 */
export function maskForDetection(text, newifs = new Set()) {
  const n = text.length;
  const out = text.split('');
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '%') { let e = text.indexOf('\n', i); if (e === -1) e = n; blank(i, e); i = e; continue; }
    if (ch !== '\\') { i++; continue; }
    const j = readWord(text, i + 1, false);
    if (j === i + 1) { i += 2; continue; }              // control symbol: \%  \\  \{  ...
    const word = text.slice(i + 1, j);
    if (word === 'begin') {
      const m = /^\s*\{([A-Za-z*]+)\}/.exec(text.slice(j, j + 60));
      if (m && VERBATIM_ENVS.has(m[1])) {
        const tok = '\\end{' + m[1] + '}';
        const k = text.indexOf(tok, j + m[0].length);
        const stop = k === -1 ? n : k + tok.length;
        blank(i, stop); i = stop; continue;
      }
    } else if (word === 'verb' || word === 'lstinline') {
      let k = j;
      if (word === 'verb' && text[k] === '*') k++;
      if (word === 'lstinline' && text[k] === '[') { const c = readBracket(text, k); if (c !== -1) k = c; }
      const d = text[k];
      if (d !== undefined && !isSpace(d) && !isLetter(text.charCodeAt(k))) {
        const close = (word === 'lstinline' && d === '{') ? '}' : d;
        let e = text.indexOf(close, k + 1);
        const nl = text.indexOf('\n', k + 1);
        if (e === -1 || (nl !== -1 && nl < e)) e = (nl === -1 ? n : nl) - 1;
        blank(i, e + 1); i = e + 1; continue;
      }
    } else if (word === 'iffalse') {
      const e = skipFalseBranch(text, j, newifs);
      blank(i, e); i = e; continue;
    }
    i = j;
  }
  return out.join('');
}

/** From just after \iffalse: the index after its matching \fi, or after an \else at the same
 *  level (the \else branch IS typeset). Comments are still comments while TeX skips. */
function skipFalseBranch(text, i, newifs) {
  const n = text.length;
  let depth = 1, prev = '';
  while (i < n) {
    const ch = text[i];
    if (ch === '%') { const e = text.indexOf('\n', i); i = e === -1 ? n : e; continue; }
    if (ch !== '\\') { i++; continue; }
    const j = readWord(text, i + 1, true);
    if (j === i + 1) { i += 2; continue; }
    const w = text.slice(i + 1, j);
    if (w === 'fi') { if (--depth === 0) return j; }
    else if (w === 'else' && depth === 1) return j;
    else if (w.startsWith('if') && prev !== 'newif' && (TEX_CONDITIONALS.has(w) || newifs.has(w))) depth++;
    prev = w; i = j;
  }
  return n;
}

// ─── definitions ─────────────────────────────────────────────────────────────────────────────
const DEF_RE = new RegExp('\\\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|' +
  'def|gdef|edef|xdef|NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|' +
  'DeclareDocumentCommand|NewExpandableDocumentCommand|RenewExpandableDocumentCommand|' +
  'newenvironment|renewenvironment|NewEnviron|RenewEnviron|NewDocumentEnvironment|' +
  'RenewDocumentEnvironment|ProvideDocumentEnvironment|DeclareDocumentEnvironment|' +
  'let|NewCommandCopy|LetLtxMacro)(?![A-Za-z@])', 'g');

/** A command name after a defining command: {\name}, \name, or a control symbol -> [name, end]. */
function readCsName(m, i) {
  i = skipWs(m, i);
  if (m[i] === '{') {
    const e = readBrace(m, i);
    if (e === -1) return null;
    const mm = /^\\([A-Za-z@]+|.)$/.exec(m.slice(i + 1, e - 1).trim());
    return mm ? [mm[1], e] : null;
  }
  if (m[i] !== '\\') return null;
  const j = readWord(m, i + 1, true);
  if (j > i + 1) return [m.slice(i + 1, j), j];
  return i + 1 < m.length ? [m[i + 1], i + 2] : null;
}
/** An environment name in braces -> [name, end]. */
function readEnvName(m, i) {
  i = skipWs(m, i);
  const e = readBrace(m, i);
  if (e === -1) return null;
  const name = m.slice(i + 1, e - 1).trim();
  return /^[A-Za-z@*]+$/.test(name) ? [name, e] : null;
}
/** Skip up to two [ ] groups (argument count, default); returns [position, count] or null. */
function readOptions(m, p) {
  let count = 0;
  for (let k = 0; k < 2 && m[p] === '['; k++) {
    const e = readBracket(m, p);
    if (e === -1) return null;
    if (k === 0) count = parseInt(m.slice(p + 1, e - 1), 10) || 0;
    p = skipWs(m, e);
  }
  return [p, count];
}
/** Approximate argument count of an xparse spec (m, o, O{..}, s, t+, d(), e{^_} ...). */
function xparseArity(spec) {
  let s = spec, prev;
  do { prev = s; s = s.replace(/\{[^{}]*\}/g, ''); } while (s !== prev);
  s = s.replace(/\\[A-Za-z@]+/g, '');
  return (s.match(/[mrRvbodDOsteEgGlu]/g) || []).length;
}

/** Every definition in a masked text: { kind: 'cmd'|'env', name, arity, aliasOf?, bodies:[[a,b]],
 *  start, end }. [start, end) covers the whole definition, its name included, so a definition's
 *  own text is never mistaken for a use. Malformed definitions are skipped, never guessed. */
function findDefinitions(m) {
  const defs = [];
  const re = new RegExp(DEF_RE.source, 'g');
  let x;
  while ((x = re.exec(m)) !== null) {
    const d = readOneDefinition(m, x[1], x.index + x[0].length);
    if (d) { d.start = x.index; defs.push(d); }
  }
  return defs;
}

function readOneDefinition(m, w, p) {
  if (/^(newcommand|renewcommand|providecommand|DeclareRobustCommand)$/.test(w)) {
    p = skipWs(m, p); if (m[p] === '*') p++;
    const nm = readCsName(m, p); if (!nm) return null;
    const o = readOptions(m, skipWs(m, nm[1])); if (!o) return null;
    const b = readBrace(m, o[0]); if (b === -1) return null;
    return { kind: 'cmd', name: nm[0], arity: o[1], bodies: [[o[0] + 1, b - 1]], end: b };
  }
  if (/^(def|gdef|edef|xdef)$/.test(w)) {
    if (m[skipWs(m, p)] !== '\\') return null;
    const nm = readCsName(m, p); if (!nm) return null;
    const k = m.indexOf('{', nm[1]);
    if (k === -1 || k - nm[1] > 300) return null;
    const b = readBrace(m, k); if (b === -1) return null;
    const params = m.slice(nm[1], k);
    return { kind: 'cmd', name: nm[0], arity: (params.match(/#[1-9]/g) || []).length,
             bodies: [[k + 1, b - 1]], end: b };
  }
  if (/DocumentCommand$/.test(w)) {
    const nm = readCsName(m, p); if (!nm) return null;
    const q = skipWs(m, nm[1]);
    const sp = readBrace(m, q); if (sp === -1) return null;
    const r = skipWs(m, sp);
    const b = readBrace(m, r); if (b === -1) return null;
    return { kind: 'cmd', name: nm[0], arity: xparseArity(m.slice(q + 1, sp - 1)),
             bodies: [[r + 1, b - 1]], end: b };
  }
  if (w === 'newenvironment' || w === 'renewenvironment') {
    p = skipWs(m, p); if (m[p] === '*') p++;
    const nm = readEnvName(m, p); if (!nm) return null;
    const o = readOptions(m, skipWs(m, nm[1])); if (!o) return null;
    const b1 = readBrace(m, o[0]); if (b1 === -1) return null;
    const q = skipWs(m, b1);
    const b2 = readBrace(m, q); if (b2 === -1) return null;
    return { kind: 'env', name: nm[0], bodies: [[o[0] + 1, b1 - 1], [q + 1, b2 - 1]], end: b2 };
  }
  if (w === 'NewEnviron' || w === 'RenewEnviron') {
    const nm = readEnvName(m, p); if (!nm) return null;
    const o = readOptions(m, skipWs(m, nm[1])); if (!o) return null;
    const b = readBrace(m, o[0]); if (b === -1) return null;
    const bodies = [[o[0] + 1, b - 1]];
    let end = b;
    const q = skipWs(m, b);                                // optional [end code]
    if (m[q] === '[') { const e = readBracket(m, q); if (e !== -1) { bodies.push([q + 1, e - 1]); end = e; } }
    return { kind: 'env', name: nm[0], bodies, end };
  }
  if (/DocumentEnvironment$/.test(w)) {
    const nm = readEnvName(m, p); if (!nm) return null;
    const sp = readBrace(m, skipWs(m, nm[1])); if (sp === -1) return null;
    const q1 = skipWs(m, sp);
    const b1 = readBrace(m, q1); if (b1 === -1) return null;
    const q2 = skipWs(m, b1);
    const b2 = readBrace(m, q2); if (b2 === -1) return null;
    return { kind: 'env', name: nm[0], bodies: [[q1 + 1, b1 - 1], [q2 + 1, b2 - 1]], end: b2 };
  }
  // \let\a\b, \let\a=\b, \NewCommandCopy{\a}{\b}, \LetLtxMacro\a\b: \a draws if \b does
  const a = readCsName(m, p); if (!a) return null;
  let q = skipWs(m, a[1]); if (m[q] === '=') q = skipWs(m, q + 1);
  const t = readCsName(m, q); if (!t) return null;
  return { kind: 'cmd', name: a[0], aliasOf: t[0], bodies: [], end: t[1] };
}

/** Does a picture's own option list say `remember picture`? memoize declines those pictures. */
function remembers(s, i) {
  i = skipWs(s, i);
  if (s[i] !== '[') return false;
  const e = readBracket(s, i);
  return /remember\s+picture(?!\s*=\s*false)/.test(s.slice(i, e === -1 ? i + 300 : e));
}

/** What a definition's bodies use: a drawing construct directly, and which names they refer to. */
function analyse(m, bodies) {
  const use = { direct: false, cmds: new Set(), envs: new Set() };
  for (const [a, b] of bodies) {
    const s = m.slice(a, b);
    const re = new RegExp(TOKEN.source, 'g');
    let x;
    while ((x = re.exec(s)) !== null) {
      const after = x.index + x[0].length;
      if (x[1] === 'begin') {
        const e = x[2].trim();
        if (DRAW_ENVS.has(e)) { if (!(e === 'tikzpicture' && remembers(s, after))) use.direct = true; }
        else use.envs.add(e);
      } else if (x[3] === 'tikz') { if (!remembers(s, after)) use.direct = true; }
      else if (x[3]) use.cmds.add(x[3]);
    }
  }
  return use;
}

/** The project's drawing definitions: repeat until nothing new is found, so a definition that
 *  draws only through other definitions is found however deep the chain. */
function closure(defs) {
  const drawCmd = new Set(), drawEnv = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of defs) {
      const set = d.kind === 'env' ? drawEnv : drawCmd;
      if (set.has(d.name) || (d.kind === 'env' && (DRAW_ENVS.has(d.name) || d.name === 'tikzcd')) ||
          (d.kind === 'cmd' && d.name === 'tikz')) continue;
      const draws = d.aliasOf ? drawCmd.has(d.aliasOf)
        : d.use.direct || [...d.use.cmds].some(c => drawCmd.has(c)) || [...d.use.envs].some(e => drawEnv.has(e));
      if (draws) { set.add(d.name); changed = true; }
    }
  }
  return { drawCmd, drawEnv };
}

/** How many argument groups a use of each command may take (largest over its definitions). */
function arityTable(defs) {
  const ar = new Map(), alias = new Map();
  for (const d of defs) {
    if (d.kind !== 'cmd') continue;
    if (d.aliasOf) alias.set(d.name, d.aliasOf);
    else ar.set(d.name, Math.max(ar.get(d.name) || 0, d.arity || 0));
  }
  const arityOf = (name, depth = 0) => ar.has(name) ? ar.get(name)
    : (alias.has(name) && depth < 10) ? arityOf(alias.get(name), depth + 1) : 0;
  return arityOf;
}

function mergeSpans(list) {
  const out = [];
  for (const [s, e] of list.slice().sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out;
}
function inSpans(sp, pos) {
  let lo = 0, hi = sp.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pos < sp[mid][0]) hi = mid - 1; else if (pos >= sp[mid][1]) lo = mid + 1; else return true;
  }
  return false;
}
function lineAt(s, pos) {
  let n = 1;
  for (let i = s.indexOf('\n'); i !== -1 && i < pos; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

// ─── counting uses ───────────────────────────────────────────────────────────────────────────
/** End of a \tikz: its {braced} body, or the path up to the first ; at its own brace level. */
function tikzEnd(m, i, to) {
  let j = skipWs(m, i);
  if (m[j] === '[') { const e = readBracket(m, j); if (e === -1) return to; j = skipWs(m, e); }
  if (m[j] === '{') { const e = readBrace(m, j); return e === -1 ? to : e; }
  let depth = 0;
  for (; j < to; j++) {
    const c = m[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (depth === 0) return j; depth--; }
    else if (c === ';' && depth === 0) return j + 1;
  }
  return to;
}
/** End of a command use with up to n argument groups ([..] or {..}); a blank line stops it. */
function argsEnd(m, i, n, to) {
  let end = i;
  for (let k = 0; k < n; k++) {
    let j = i, nl = 0;
    while (j < to && isSpace(m[j])) { if (m[j] === '\n') nl++; j++; }
    if (nl > 1) break;
    const e = m[j] === '[' ? readBracket(m, j) : m[j] === '{' ? readBrace(m, j) : -1;
    if (e === -1 || e > to) break;
    end = i = e;
  }
  return end;
}

/** Outermost drawing uses in m[from, to), skipping text inside definitions. Each:
 *  { start, end, name, counted } — counted is false for a `remember picture` picture, which
 *  still hides what is nested inside it. tikzcd is reported here and decided by the caller. */
function findUses(m, from, to, defSpans, drawCmd, drawEnv, arityOf) {
  const spans = [], open = new Map();
  const re = new RegExp(TOKEN.source, 'g');
  re.lastIndex = from;
  let x;
  while ((x = re.exec(m)) !== null && x.index < to) {
    if (x[4] || inSpans(defSpans, x.index)) continue;
    const after = x.index + x[0].length;
    if (x[1]) {
      const e = x[2].trim();
      if (!(DRAW_ENVS.has(e) || drawEnv.has(e) || e === 'tikzcd')) continue;
      if (x[1] === 'begin') {
        if (!open.has(e)) open.set(e, []);
        open.get(e).push({ start: x.index, counted: !(e === 'tikzpicture' && remembers(m, after)) });
      } else {
        const st = open.get(e);
        if (st && st.length) { const o = st.pop(); spans.push({ start: o.start, end: after, name: e, counted: o.counted }); }
      }
    } else if (x[3] === 'tikz') {
      spans.push({ start: x.index, end: tikzEnd(m, after, to), name: '\\tikz', counted: !remembers(m, after) });
    } else if (x[3] && drawCmd.has(x[3])) {
      spans.push({ start: x.index, end: argsEnd(m, after, arityOf(x[3]), to), name: '\\' + x[3], counted: true });
    }
  }
  for (const [e, st] of open) for (const o of st) spans.push({ start: o.start, end: to, name: e, counted: o.counted });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let edge = -1;
  for (const s of spans) if (s.start >= edge) { kept.push(s); edge = s.end; }
  return kept;
}

// ─── tikz-cd guard (NOTE 2026-10-01) ─────────────────────────────────────────────────────────
/** What a { opens: the name of the command whose ARGUMENT it is, 'a command' after ] } or ),
 *  or null for a plain group (start of text, after an \end{...}, after \] or \), after text). */
function opener(m, i, endBrace) {
  let j = i - 1;
  while (j >= 0 && isSpace(m[j])) j--;
  if (j < 0 || j === endBrace) return null;
  const c = m[j];
  if (c === ']' || c === '}' || c === ')') return m[j - 1] === '\\' ? null : 'a command';
  let k = j;
  while (k >= 0 && isNameChar(m.charCodeAt(k))) k--;
  if (k < j && k >= 0 && m[k] === '\\') return '\\' + m.slice(k + 1, j + 1);
  return null;
}
/** Each \begin{tikzcd} in a masked text, with null when every surrounding was measured safe,
 *  otherwise a description of the first one that was not. */
function cdSurroundings(m, safe) {
  const found = [], envs = [], braces = [];
  let endBrace = -1;
  const re = new RegExp(TOKEN.source, 'g');
  let x;
  while ((x = re.exec(m)) !== null) {
    if (x[4] === '{') { braces.push(opener(m, x.index, endBrace)); continue; }
    if (x[4] === '}') { braces.pop(); continue; }
    if (!x[1]) continue;
    const name = x[2].trim();
    if (x[1] === 'end') {
      for (let k = envs.length - 1; k >= 0; k--) if (envs[k].name === name) { envs.length = k; break; }
      endBrace = x.index + x[0].length - 1;
      continue;
    }
    if (name === 'tikzcd') {
      const arg = braces.find(b => b);
      const env = envs.find(e => !safe.has(e.label));
      found.push({ pos: x.index, context: arg ? 'inside the argument of ' + arg : env ? 'inside ' + env.label : null });
    }
    let label = name;
    if (name === 'frame') {
      const o = /^\s*(?:<[^>]*>)?\s*\[([^\]]*)\]/.exec(m.slice(re.lastIndex, re.lastIndex + 200));
      if (o && /\bfragile\b/.test(o[1])) label = 'frame[fragile]';
    }
    envs.push({ name, label });
  }
  return found;
}

// ─── entry point ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{path: string, text: string}>} files  every text file in the project, with the
 *        editor's unsaved text already in place (the caller's job). Paths are project-relative.
 *        Files other than .tex .ltx .tikz .pgf (counted) and .sty .cls .def .cfg (definitions
 *        only) are ignored.
 * @returns {{ toCompile: number,
 *   byFile: Array<{path, role: 'document'|'fragment', count, kinds, notCaptured?}>,
 *   documents: string[],   // files with \documentclass and \begin{document}
 *   definitions: { environments: string[], commands: string[] },   // the project's drawing ones
 *   tikzcd: { loaded: boolean, diagrams: number, capturable: boolean,
 *             blockedBy: Array<{path, line, context}> },   // capturable = register it in step 2
 *   notCaptured: { tikzcd: number },   // diagrams present but left as code (guard)
 *   ms: number }}
 */
export function detectCodeFigures(files) {
  const t0 = now();
  const proj = [];
  for (const f of files || []) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string') continue;
    const style = /\.(sty|cls|def|cfg)$/i.test(f.path);
    if (style || /\.(tex|ltx|tikz|pgf)$/i.test(f.path)) proj.push({ path: f.path, text: f.text, style });
  }
  const newifs = new Set();
  for (const p of proj) for (const x of p.text.matchAll(/\\newif\s*\\(if[A-Za-z@]+)/g)) newifs.add(x[1]);

  const defs = [];
  let cdLoaded = false;
  const theorems = new Set();
  for (const p of proj) {
    p.m = maskForDetection(p.text, newifs);
    p.defs = findDefinitions(p.m);
    for (const d of p.defs) { if (!d.aliasOf) d.use = analyse(p.m, d.bodies); defs.push(d); }
    p.defSpans = mergeSpans(p.defs.map(d => [d.start, d.end]));
    for (const x of p.m.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}|\\usetikzlibrary\s*\{([^}]*)\}/g)) {
      const list = (x[1] != null ? x[1] : x[2]).split(',').map(s => s.trim());
      if (x[1] != null ? list.includes('tikz-cd') : list.includes('cd')) cdLoaded = true;
    }
    for (const x of p.m.matchAll(/\\(?:newtheorem|spnewtheorem)\s*\*?\s*\{([^}]+)\}|\\declaretheorem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
      for (const n of (x[1] || x[2]).split(',')) theorems.add(n.trim());
  }
  const { drawCmd, drawEnv } = closure(defs);
  const arityOf = arityTable(defs);

  // tikz-cd: register only if loaded and EVERY diagram in the project sits somewhere measured safe
  const safe = new Set([...CD_SAFE_ENVS, ...theorems]);
  const blockedBy = [];
  let diagrams = 0;
  for (const p of proj) {
    if (!/\\begin\s*\{tikzcd\}/.test(p.m)) continue;
    for (const c of cdSurroundings(p.m, safe)) {
      diagrams++;
      const context = inSpans(p.defSpans, c.pos) ? 'inside a definition'
        : p.style ? 'in a style file' : c.context;
      if (context) blockedBy.push({ path: p.path, line: lineAt(p.m, c.pos), context });
    }
  }
  const capturable = cdLoaded && diagrams > 0 && blockedBy.length === 0;

  const byFile = [], documents = [];
  let toCompile = 0, cdLeft = 0;
  for (const p of proj) {
    if (p.style) continue;
    let from = 0, to = p.m.length, role = 'fragment';
    const dc = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.exec(p.m);
    if (dc) {
      role = 'document';
      const bd = /\\begin\s*\{document\}/g; bd.lastIndex = dc.index;
      const b = bd.exec(p.m);
      if (b) {
        from = b.index + b[0].length;
        const ed = /\\end\s*\{document\}/g; ed.lastIndex = from;
        const e = ed.exec(p.m);
        to = e ? e.index : p.m.length;
        documents.push(p.path);
      } else from = to;
    }
    let count = 0, left = 0;
    const kinds = {};
    for (const s of findUses(p.m, from, to, p.defSpans, drawCmd, drawEnv, arityOf)) {
      if (!s.counted) continue;
      if (s.name === 'tikzcd' && !capturable) { left++; continue; }
      count++; kinds[s.name] = (kinds[s.name] || 0) + 1;
    }
    toCompile += count; cdLeft += left;
    if (count || left) byFile.push(left ? { path: p.path, role, count, kinds, notCaptured: { tikzcd: left } }
                                        : { path: p.path, role, count, kinds });
  }
  return { toCompile, byFile, documents,
    definitions: { environments: [...drawEnv].sort(), commands: [...drawCmd].sort() },
    tikzcd: { loaded: cdLoaded, diagrams, capturable, blockedBy },
    notCaptured: { tikzcd: cdLeft },
    ms: Math.round((now() - t0) * 10) / 10 };
}
