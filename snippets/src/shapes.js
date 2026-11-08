// src/shapes.js — structure recognition: which parts of the selection are
// the operands, and in which order they go.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 2 ("Structure
// recognition", "Operand order", "Arity check", "When no shape fits").
//
// How it decides, in plain terms:
//   1. Every shape below reads the selection and offers READINGS: "the
//      operands are these pieces, in this role order". A selection can have
//      several readings (in \log_b x the operand is x, or b and x).
//   2. Only readings with as many operands as the concept takes are kept.
//   3. A reading that would leave letters or numbers out of every operand
//      (a "lossy" reading: they would not be read aloud) is kept only with
//      evidence. So is a reading where the base and the script could each be
//      the operand (e^x). Evidence is the concept's own kernel form in the
//      Reference tool (the same shape, with the operands marked) or, for
//      scripts, the concept's fixity (postfix: the base; indexed: the script).
//   4. When the kernel form has the same shape but marks other pieces,
//      that reading is dropped: the form disagrees.
//   5. One reading left: use it. None, or several that differ: the author
//      marks the operands ("needs-operands"). The tool never guesses.
// Operand ORDER: from the kernel form when it confirmed the reading; otherwise
// the reading order (with a warning when there are two or more operands).
// Scripts are always in TeX's order, subscript then superscript, however they
// are typed, so ^{1}_{0} cannot flip a range.
// [CLAUDE 2026-11-08] Evidence and order now come from the kernel forms in the
// slim copy (Ginev's example and the wording are not in it); the matching is
// unchanged: a form's \MathMLarg markers play the part the example's \arg
// markers did.
import { contentTerms, parseMath } from './latex-parse.js';
import { kernelFormsOf } from './concepts.js';
import { locateSelection, trimRange } from './checks.js';

// ---- Vocabulary (data, extend as concepts need) ------------------------------
const SIZES = /^[bB]igg?[lrm]?$/;
const CHAR_DELIM = { '(': '(', ')': ')', '[': '[', ']': ']', '|': '|' };
const CMD_DELIM = { '{': '{', '}': '}', lbrace: '{', rbrace: '}', langle: '<', rangle: '>',
  lbrack: '[', rbrack: ']', llbracket: '[[', rrbracket: ']]', vert: '|', lvert: '|', rvert: '|',
  Vert: '‖', lVert: '‖', rVert: '‖', '|': '‖', lfloor: 'L', rfloor: 'J', lceil: 'C', rceil: 'D' };
const OPENS = new Set(['(', '[', '{', '<', '[[', 'L', 'C']);
const CLOSES = new Set([')', ']', '}', '>', ']]', 'J', 'D']);
const PAIRS = { '(': [')', ']', '['], '[': [')', ']', '['], ']': [')', ']', '['], '{': ['}'], '<': ['>'],
  '|': ['|'], '‖': ['‖'], '[[': [']]'], L: ['J'], C: ['D'] };
export const LARGE_OPS = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'iiiint', 'oint', 'oiint',
  'idotsint', 'lim', 'liminf', 'limsup', 'bigcup', 'bigcap', 'bigvee', 'bigwedge', 'bigoplus', 'bigotimes',
  'bigodot', 'biguplus', 'bigsqcup', 'max', 'min', 'sup', 'inf', 'esssup', 'essinf']);
const INTEGRALS = new Set(['int', 'iint', 'iiint', 'iiiint', 'oint', 'oiint', 'idotsint']);
export const INFIX_OPS = new Set(['times', 'cdot', 'ast', 'star', 'circ', 'bullet', 'otimes', 'oplus', 'odot',
  'wedge', 'vee', 'cup', 'cap', 'setminus', 'to', 'rightarrow', 'longrightarrow', 'Rightarrow', 'mapsto',
  'searrow', 'nearrow', 'swarrow', 'nwarrow', 'downarrow', 'uparrow', 'rightrightarrows', 'rightharpoonup',
  'leftrightarrow', 'mid', 'nmid', 'overset', 'underset', 'stackrel', 'xrightarrow']);
const INFIX_CHARS = new Set(['*']);
const POSTFIX_OPS = new Set(['downarrow', 'uparrow', 'searrow', 'nearrow']);
// Binary operators and relations: a prefix operator's operand or a sum's body
// must not contain one at its top level (\sin x + y is (\sin x) + y).
const BINOP_CHARS = new Set(['+', '-', '=', '<', '>']);
const BINOP_CMDS = new Set(['pm', 'mp', 'cdot', 'times', 'le', 'ge', 'leq', 'geq', 'ne', 'neq', 'approx',
  'equiv', 'sim', 'simeq', 'cong', 'to', 'rightarrow', 'Rightarrow', 'iff', 'implies', 'in', 'notin',
  'subset', 'subseteq', 'supset', 'supseteq', 'll', 'gg', 'propto', 'div']);
// Commands that are symbols, not content, when deciding what would go unread.
const SYMBOL_CMDS = /\\(?:circ|dagger|ddagger|dag|ddag|ast|star|top|bot|intercal|prime|perp|times|cdot|pm|mp|sharp|flat|natural|bullet|backprime|left|right|[bB]igg?[lrm]?)(?![A-Za-z])/g;
const SPACE_CMDS = /\\(?:[,;:! ]|quad|qquad|limits|nolimits)(?![A-Za-z])/g;

// ---- Small helpers -------------------------------------------------------------
const rangeOf = terms => ({ start: terms[0].start, end: terms.at(-1).end });
const hasScripts = t => !!(t.sub || t.sup || t.primes);
function rowRange(row) {
  if (!row) return null;
  const ct = contentTerms(row);
  return ct.length ? { start: ct[0].start, end: ct.at(-1).end } : null;
}
/** Would this stretch of LaTeX be read aloud as something (a letter, digit,
 *  Greek letter, \infty ...)? Symbols such as * \dagger \circ ' + do not count. */
function hasContent(src, r) {
  if (!r) return false;
  const s = src.slice(r.start, r.end).replace(SYMBOL_CMDS, '').replace(SPACE_CMDS, '')
    .replace(/\\[^A-Za-z]/g, '').replace(/\\[A-Za-z]+/g, 'X');
  return /[A-Za-z0-9]/.test(s);
}
const isCmd = (t, set) => t && t.base.kind === 'command' && set.has(t.base.name);
const isChar = (t, set) => t && t.base.kind === 'char' && set.has(t.base.ch);

function delimOf(src, t) {
  const b = t.base;
  if (b.kind === 'char') return CHAR_DELIM[b.ch] ?? null;
  if (b.kind !== 'command') return null;
  if ((b.name === 'mathopen' || b.name === 'mathclose') && b.args[0]) {
    const inner = src.slice(b.args[0].start, b.args[0].end).trim();
    return inner.startsWith('\\') ? CMD_DELIM[inner.slice(1)] ?? null : CHAR_DELIM[inner] ?? null;
  }
  return CMD_DELIM[b.name] ?? null;
}
const delimText = text => text === '.' ? '.' : text.startsWith('\\') ? CMD_DELIM[text.slice(1)] ?? null : CHAR_DELIM[text] ?? null;
const isSize = t => t && t.base.kind === 'command' && SIZES.test(t.base.name) && !hasScripts(t);

/** Delimiter starting at terms[i] (with an optional \big before it). */
function delimAt(src, T, i) {
  if (isSize(T[i]) && T[i + 1]) { const d = delimOf(src, T[i + 1]); if (d) return { d, from: i, to: i + 1 }; }
  if (!T[i]) return null;
  const d = delimOf(src, T[i]);
  return d ? { d, from: i, to: i } : null;
}
/** Delimiter ending at terms[j] (with an optional \big before it). */
function delimBefore(src, T, j) {
  if (!T[j]) return null;
  const d = delimOf(src, T[j]);
  if (!d) return null;
  return isSize(T[j - 1]) ? { d, from: j - 1, to: j } : { d, from: j, to: j };
}

/** Bracket depth stays >= 0 and ends at 0; no top-level `bar` inside. */
function encloses(src, inner, bar = null) {
  let depth = 0;
  for (const t of inner) {
    const d = delimOf(src, t);
    if (!d) continue;
    if (OPENS.has(d)) depth++;
    else if (CLOSES.has(d)) { if (--depth < 0) return false; }
    else if (bar && d === bar && depth === 0) return false;
  }
  return depth === 0;
}

/** Split terms at top-level , or ; (not inside nested brackets). Null if an item is empty. */
function splitItems(src, terms) {
  const items = [[]];
  let depth = 0;
  for (const t of terms) {
    const d = delimOf(src, t);
    if (d && OPENS.has(d)) depth++;
    else if (d && CLOSES.has(d)) depth--;
    if (depth === 0 && t.base.kind === 'char' && (t.base.ch === ',' || t.base.ch === ';') && !hasScripts(t)) items.push([]);
    else items.at(-1).push(t);
  }
  return items.some(x => !x.length) ? null : items.map(rangeOf);
}

/** A fence round the whole of T: { open, close, inner:[terms], scripts: term|null }. */
function fenceSpan(src, T) {
  if (T.length === 1 && T[0].base.kind === 'leftright') {
    const b = T[0].base;
    return { open: delimText(b.open.text), close: delimText(b.close.text), inner: contentTerms(b.row), scripts: T[0] };
  }
  const o = delimAt(src, T, 0), c = delimBefore(src, T, T.length - 1);
  if (!o || !c || c.from <= o.to || hasScripts(T[o.to])) return null;
  if (!(PAIRS[o.d] ?? []).includes(c.d)) return null;
  const inner = T.slice(o.to + 1, c.from);
  const bar = o.d === '|' || o.d === '‖' ? o.d : null;
  if (!encloses(src, inner, bar)) return null;
  return { open: o.d, close: c.d, inner, scripts: T.at(-1) };
}

const hasBinop = T => T.some(t => isChar(t, BINOP_CHARS) || isCmd(t, BINOP_CMDS));
/** Could this term be an operator or function name (a head)? */
function isHead(src, t) {
  const b = t.base;
  if (b.kind === 'char') return /[A-Za-z]/.test(b.ch);
  if (b.kind === 'group') return true;
  if (b.kind !== 'command') return false;
  if (delimOf(src, t) || SIZES.test(b.name) || LARGE_OPS.has(b.name) || INFIX_OPS.has(b.name) ||
      b.name === 'MathMLintent' || b.name === 'MathMLarg' || b.name === 'intent' || b.name === 'iarg') return false;
  return true;
}
const scriptRanges = t => [t.sub, t.sup].filter(Boolean).map(rowRange);

// A reading.  needs: null | 'evidence' (only with the example or fixityOk)
const reading = (shape, variant, ops, { lossy = false, needs = null, fixityOk = null } = {}) =>
  ({ shape, variant, ops, lossy, needs, fixityOk });

// ---- Shapes --------------------------------------------------------------------
// Each: (src, T, conceptArity) => [reading]. T = the selection's terms, no spacing.

/** Fences and bars: (a, b)  [0,1)  ]a,b[  \left[..\right)  |x|  \lVert A\rVert_{HS}  \{f, x\} */
function fenced(src, T) {
  const f = fenceSpan(src, T);
  if (!f || !f.open || f.open === '.' || !f.inner.length) return [];
  const items = splitItems(src, f.inner);
  if (!items) return [];
  const s = f.scripts, sub = rowRange(s?.sub), sup = rowRange(s?.sup);
  const out = [reading('fenced', 'items', items, { lossy: hasContent(src, sub) || hasContent(src, sup) })];
  if (sub && !sup) out.push(reading('fenced', 'items+sub', [...items, sub]));
  if (sup && !sub) out.push(reading('fenced', 'items+sup', [...items, sup]));
  if (sub && sup) out.push(reading('fenced', 'items+sub+sup', [...items, sub, sup]));
  return out;
}

/** Function application: \operatorname{Re}(z)  W(f, g)  D_n(x)  A^{n}(X)  \mathcal{L}\{f\}  \tanh\left(..\right) */
function application(src, T) {
  if (T.length < 2) return [];
  let k, inner;
  const last = T.at(-1);
  if (last.base.kind === 'leftright' && !hasScripts(last)) {
    const o = delimText(last.base.open.text);
    if (!o || o === '.' || o === '|' || o === '‖') return [];
    k = T.length - 1; inner = contentTerms(last.base.row);
  } else {
    const c = delimBefore(src, T, T.length - 1);
    if (!c || hasScripts(last) || !CLOSES.has(c.d)) return [];
    let depth = 0, j = c.from - 1;
    for (; j >= 0; j--) {
      const d = delimOf(src, T[j]);
      if (d && CLOSES.has(d)) depth++;
      else if (d && OPENS.has(d)) { if (depth-- === 0) break; }
    }
    if (j < 0) return [];
    const o = delimOf(src, T[j]);
    if (!(PAIRS[o] ?? []).includes(c.d)) return [];
    k = isSize(T[j - 1]) ? j - 1 : j;
    inner = T.slice(j + 1, c.from);
  }
  if (k !== 1 || !inner.length || !isHead(src, T[0])) return [];
  const h = T[0], items = splitItems(src, inner);
  if (!items) return [];
  const hs = scriptRanges(h);
  const out = [reading('apply', 'args', items, { lossy: hs.some(r => hasContent(src, r)) || h.primes > 0 })];
  if (hs.length && hs.every(r => hasContent(src, r)) && !h.primes) out.push(reading('apply', 'scripts+args', [...hs, ...items]));
  return out;
}

/** Prefix operator: \sinh x  \nabla f  \log_b x  D_{v} f  \operatorname{p.v.} X  \mathcal{F}_c f */
function prefix(src, T) {
  if (T.length < 2 || !isHead(src, T[0])) return [];
  const h = T[0], rest = T.slice(1);
  if (fenceSpan(src, rest)) return [];                // \sinh(x): application reads it
  if (hasBinop(rest) || isCmd(rest[0], INFIX_OPS) || isChar(rest[0], INFIX_CHARS)) return [];
  if (rest.some(t => isSize(t) || (delimOf(src, t) && hasScripts(t))) || !encloses(src, rest)) return [];
  const r = rangeOf(rest), hs = scriptRanges(h);
  const out = [reading('prefix', 'rest', [r], { lossy: hs.some(x => hasContent(src, x)) || h.primes > 0 })];
  if (hs.length && hs.every(x => hasContent(src, x)) && !h.primes) out.push(reading('prefix', 'scripts+rest', [...hs, r]));
  return out;
}

/** One infix operator between two sides: f * g  x \to a  f_n \rightrightarrows f */
function infix(src, T) {
  const at = T.flatMap((t, i) => (isCmd(t, INFIX_OPS) || isChar(t, INFIX_CHARS)) ? [i] : []);
  if (at.length !== 1 || at[0] === 0 || at[0] === T.length - 1) return [];
  const i = at[0];
  return [reading('infix', 'sides', [rangeOf(T.slice(0, i)), rangeOf(T.slice(i + 1))])];
}

/** A trailing operator symbol: x \downarrow */
function postfixOp(src, T) {
  if (T.length < 2 || !isCmd(T.at(-1), POSTFIX_OPS) || hasScripts(T.at(-1))) return [];
  return [reading('postfix', 'operand', [rangeOf(T.slice(0, -1))])];
}

/** Large operators: \sum_{i=1}^{n} a_i  \int_a^b f(x)\,dx  \lim_{x\to a}  \prod_{a}^{b} */
function largeOp(src, T) {
  const h = T[0];
  if (!isCmd(h, LARGE_OPS)) return [];
  const sc = scriptRanges(h), scC = sc.some(r => hasContent(src, r));
  const body = T.slice(1);
  if (!body.length) return sc.length ? [reading('largeop', 'scripts', sc, { needs: 'evidence', fixityOk: ['prefix'] })] : [];
  const out = [];
  if (INTEGRALS.has(h.base.name) && body.length >= 3) {
    const d = body.at(-2), v = body.at(-1);
    const isD = d && !hasScripts(d) && ((d.base.kind === 'char' && d.base.ch === 'd') ||
      (d.base.kind === 'command' && /^(mathrm|operatorname|mathit)$/.test(d.base.name) && src.slice(d.base.args[0].start, d.base.args[0].end).trim() === 'd'));
    if (isD && v) {
      const ig = rangeOf(body.slice(0, -2)), vr = { start: v.start, end: v.end };
      out.push(reading('largeop', 'scripts+integrand+var', [...sc, ig, vr]));
      out.push(reading('largeop', 'scripts+integrand', [...sc, ig], { lossy: true }));
      out.push(reading('largeop', 'integrand', [ig], { lossy: true }));
      out.push(reading('largeop', 'integrand+var', [ig, vr], { lossy: scC }));
      return out;
    }
  }
  if (hasBinop(body)) return [];
  const br = rangeOf(body);
  out.push(reading('largeop', 'scripts+body', [...sc, br]));
  out.push(reading('largeop', 'body', [br], { lossy: scC }));
  if (sc.length) out.push(reading('largeop', 'scripts', sc, { lossy: true }));
  return out;
}

/** Evaluation bar: F(x)\Big|_{0}^{1}  F|_0^1  \left.F\right|_a^b  [F(x)]_a^b  f(x)\big|_{x=0} */
function evalBar(src, T) {
  const last = T.at(-1);
  if (!last?.sub) return [];
  let body;
  if (T.length === 1 && last.base.kind === 'leftright') {
    const o = delimText(last.base.open.text), c = delimText(last.base.close.text);
    if (!((o === '.' && c === '|') || (o === '[' && c === ']'))) return [];
    body = contentTerms(last.base.row);
  } else if (delimOf(src, last) === '|') {
    body = T.slice(0, isSize(T.at(-2)) ? -2 : -1);
  } else if (delimOf(src, last) === ']' && delimOf(src, T[0]) === '[') {
    body = T.slice(1, -1);
    if (!encloses(src, body)) return [];
  } else return [];
  if (!body.length) return [];
  return [reading('evalbar', 'body+limits', [rangeOf(body), ...scriptRanges(last)])];
}

/** One term with scripts or primes: z^*  f'  f_n'  A^{\circ}  H^{p}  {A}^{r} */
function scripted(src, T) {
  if (T.length !== 1) return [];
  const t = T[0], b = t.base;
  if (!hasScripts(t) || b.kind === 'empty' || b.kind === 'leftright' || isCmd(t, LARGE_OPS)) return [];
  const baseR = b.kind === 'group' ? rowRange(b.row) : { start: b.start, end: b.end };
  if (!baseR) return [];
  const sub = rowRange(t.sub), sup = rowRange(t.sup);
  const subC = hasContent(src, sub), supC = hasContent(src, sup);
  const out = [reading('scripted', 'base', [baseR], { lossy: subC || supC, fixityOk: ['postfix'] })];
  if (t.sub && (t.sup || t.primes) && b.kind !== 'group') {
    const subEnd = t.sub.groupEnd ?? t.sub.end;
    out.push(reading('scripted', 'base+sub', [{ start: b.start, end: subEnd }], { lossy: supC, fixityOk: ['postfix'] }));
  }
  const scripts = [t.sub && sub, t.sup && sup].filter(Boolean);
  if (scripts.length && (!t.sub || subC) && (!t.sup || supC) && !t.primes)
    out.push(reading('scripted', 'scripts', scripts, { needs: 'evidence', fixityOk: ['indexed'] }));
  const simple = b.kind === 'char' || (b.kind === 'command' && !b.args.length);
  if (simple && scripts.length && (!t.sub || subC) && (!t.sup || supC) && !t.primes)
    out.push(reading('scripted', 'base+scripts', [baseR, ...scripts]));
  return out;
}

/** One command and its arguments: \hat{f}  \overline{z}  \dot{x}  \bar z  \binom{n}{k} */
function commandArgs(src, T) {
  if (T.length !== 1) return [];
  const t = T[0], b = t.base;
  if (b.kind !== 'command' || !b.args.length || hasScripts(t) || /^(MathMLintent|MathMLarg|intent|iarg|text\w*|mbox)$/.test(b.name)) return [];
  const args = b.args.map(rowRange);
  if (args.some(a => !a)) return [];
  return [reading('command', 'args', args, { lossy: b.opt.some(o => hasContent(src, rowRange(o))) })];
}

export const SHAPES = Object.freeze([fenced, application, prefix, infix, postfixOp, largeOp, evalBar, scripted, commandArgs]);

/** All readings of the selection (offsets in the document). */
export function readingsOf(src, T) {
  const out = [];
  for (const shape of SHAPES) for (const r of shape(src, T)) if (r.ops.length && r.ops.every(Boolean)) out.push(r);
  return out;
}

/** The selection as terms; a selected base (A in A^T) as a term of its own. */
export function selectionTerms(loc) {
  if (!loc.cut) return loc.terms.filter(t => t.base.kind !== 'space' && t.base.kind !== 'sep');
  const t = loc.terms[0];
  if (loc.cut === 'base') return [{ kind: 'term', base: t.base, sub: null, sup: null, primes: 0, start: t.base.start, end: t.base.end, row: t.row }];
  return [{ kind: 'term', base: t.base, sub: t.sub, sup: null, primes: 0, start: t.start, end: t.sub.groupEnd ?? t.sub.end, row: t.row }];
}

// ---- Evidence from the Reference tool's kernel forms -------------------------------
/** Take the operand markers out of LaTeX: { plain, markers:[{ home, start, end }] }.
 *  Reads Ginev's \arg{name}{x} / \intent{..}{..} and the kernel's \MathMLarg / \MathMLintent. */
export function stripMarkers(tex) {
  let plain = '', i = 0;
  const markers = [];
  const re = /\\(arg|intent|MathMLarg|MathMLintent)(?![A-Za-z])\s*\{/g;
  const groupEnd = (s, k) => { for (let d = 0; k < s.length; k++) { if (s[k] === '\\') { k++; continue; } if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return k + 1; } return -1; };
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(tex);
    if (!m) break;
    const nOpen = m.index + m[0].length - 1, nEnd = groupEnd(tex, nOpen);
    let k = nEnd;
    while (k > 0 && /\s/.test(tex[k])) k++;
    if (nEnd < 0 || tex[k] !== '{') return null;
    const cEnd = groupEnd(tex, k);
    if (cEnd < 0) return null;
    plain += tex.slice(i, m.index);
    const inner = stripMarkers(tex.slice(k + 1, cEnd - 1));
    if (!inner) return null;
    if (/\\[A-Za-z]+$/.test(plain) && /^[A-Za-z]/.test(inner.plain)) plain += ' ';
    const at = plain.length;
    for (const im of inner.markers) markers.push({ ...im, start: im.start + at, end: im.end + at });
    if (m[1] === 'arg' || m[1] === 'MathMLarg') {
      const lead = inner.plain.length - inner.plain.trimStart().length;
      markers.push({ home: tex.slice(nOpen + 1, nEnd - 1).trim(), start: at + lead, end: at + inner.plain.trimEnd().length });
    }
    plain += inner.plain;
    i = cEnd;
  }
  return { plain: plain + tex.slice(i), markers };
}

const intentNames = v => {
  const o = v?.indexOf('(') ?? -1;
  return o < 0 ? [] : v.slice(o + 1, v.lastIndexOf(')')).split(',').map(s => s.trim().replace(/^\$/, '')).filter(Boolean);
};

/** The notation inside a kernel form: \MathMLintent{<intent>}{{<body>}} -> <body>, or null. */
export function kernelBody(form) {
  if (!form?.kernel || !form.intent) return null;
  const pre = `\\MathMLintent{${form.intent}}{{`;
  return form.kernel.startsWith(pre) && form.kernel.endsWith('}}') ? form.kernel.slice(pre.length, -2) : null;
}

const evidenceCache = new WeakMap();
/** For a concept: Map "shape/variant/count" -> { status: 'confirmed', perm, form } | { status: 'contradicted' }.
 *  perm[i] = the concept position of the reading's i-th operand. Built from each kernel form: its
 *  notation is read like a selection, and each reading is checked against the form's \MathMLarg marks.
 *  [CLAUDE 2026-11-08] Was exampleEvidence (Ginev's example + its intent value). */
export function formEvidence(rec) {
  if (evidenceCache.has(rec)) return evidenceCache.get(rec);
  const map = new Map();
  evidenceCache.set(rec, map);
  for (const form of kernelFormsOf(rec).filter(f => f.arity > 0)) {   // every notation the Reference gives
    const homes = form.operands;
    const body = kernelBody(form);
    const ex = body ? stripMarkers(body) : null;
    if (!ex) continue;
    const top = ex.markers.filter(m => homes.includes(m.home));
    if (top.length !== homes.length) continue;
    const doc = `$${ex.plain}$`;
    const tree = parseMath(doc, 1, doc.length - 1);
    if (!tree) continue;
    const sel = trimRange(doc, 1, doc.length - 1);
    const loc = locateSelection(tree, sel.start, sel.end);
    if (loc.code) continue;
    for (const r of readingsOf(doc, selectionTerms(loc))) {
      if (r.ops.length !== homes.length) continue;
      const key = `${r.shape}/${r.variant}/${r.ops.length}`;
      const perm = r.ops.map(op => {
        const m = top.find(mk => mk.start + 1 === op.start && mk.end + 1 === op.end);
        return m ? homes.indexOf(m.home) : -1;
      });
      const ok = perm.every(p => p >= 0) && new Set(perm).size === perm.length;
      // lossy: the form's own notation leaves pieces unread (kept so a form without that cannot
      // vouch for a selection that would leave pieces unread: \sin x is no evidence for \sin^2 x)
      if (ok) { if (map.get(key)?.status !== 'confirmed') map.set(key, { status: 'confirmed', perm, form, lossy: !!r.lossy }); }
      else if (!map.has(key)) map.set(key, { status: 'contradicted' });
    }
  }
  return map;
}

// ---- Choosing ------------------------------------------------------------------
const sameOps = (a, b) => a.ops.length === b.ops.length && a.ops.every((o, i) => o.start === b.ops[i].start && o.end === b.ops[i].end);
const describeOps = (src, r) => r.ops.map(o => src.slice(o.start, o.end)).join(' | ');

/**
 * ctx: { src, loc, concept }; forms: [{ arity, operands, wording, fixity }]
 * Returns { form, operands:[{start,end}] in concept order, orderFrom, shape }
 *      or { problem: { code, message }, candidates? }.
 */
export function chooseInterpretation(ctx, forms) {
  const { src, concept } = ctx;
  const arities = forms.map(f => f.arity);
  if (arities.includes(0)) {
    const form = forms.find(f => f.arity === 0);
    return { form, operands: [], orderFrom: 'none', shape: 'whole' };
  }
  const all = readingsOf(src, selectionTerms(ctx.loc));
  const fits = all.filter(r => arities.includes(r.ops.length));
  const evidence = formEvidence(concept);
  const fixities = new Set([concept.fixity, ...forms.map(f => f.fixity)].filter(Boolean));
  const kept = [], dropped = { contradicted: [], lossy: [], evidence: [] };
  for (const r of fits) {
    const e = evidence.get(`${r.shape}/${r.variant}/${r.ops.length}`);
    if (e?.status === 'contradicted') { dropped.contradicted.push(r); continue; }
    if (e?.status === 'confirmed' && (!r.lossy || e.lossy)) { kept.push({ ...r, rank: 0, perm: e.perm }); continue; }
    const byFixity = (r.fixityOk ?? []).some(f => fixities.has(f));
    if ((r.lossy || r.needs) && !byFixity) { (r.lossy ? dropped.lossy : dropped.evidence).push(r); continue; }
    kept.push({ ...r, rank: 1 });
  }
  kept.sort((a, b) => a.rank - b.rank);
  const uniq = [];
  for (const r of kept) if (!uniq.some(u => sameOps(u, r))) uniq.push(r);
  const best = uniq.length && (uniq.length === 1 || uniq[0].rank < uniq[1].rank) ? uniq[0] : null;
  const name = concept.concept;
  if (!best) {
    if (uniq.length > 1) return { problem: { code: 'ambiguous', message:
      `The selection can be read in more than one way for "${name}": ${uniq.map(r => describeOps(src, r)).join('  or  ')}. Mark the operands.` },
      candidates: uniq.map(r => r.ops.map(o => src.slice(o.start, o.end))) };
    if (dropped.contradicted.length && !dropped.lossy.length && !dropped.evidence.length) return { problem: { code: 'example-disagrees', message:
      `The Reference tool's kernel form for "${name}" marks the operands differently from how the tool reads this notation. Mark the operands.` } };
    if (dropped.lossy.length && !dropped.evidence.length) return { problem: { code: 'lossy', message:
      `Taking only ${dropped.lossy.map(r => describeOps(src, r)).join(' or ')} as the operand would leave other letters or numbers unread. Mark the operands.` } };
    if (dropped.evidence.length || dropped.lossy.length) return { problem: { code: 'ambiguous', message:
      `The tool cannot tell which part is the operand of "${name}" here (${[...dropped.evidence, ...dropped.lossy].map(r => describeOps(src, r)).join('  or  ')}). Mark the operands.` },
      candidates: [...dropped.evidence, ...dropped.lossy].map(r => r.ops.map(o => src.slice(o.start, o.end))) };
    if (all.length) return { problem: { code: 'arity-mismatch', message:
      `"${name}" takes ${arities.join(' or ')} operand(s); the selection shows ${[...new Set(all.map(r => r.ops.length))].sort().join(' or ')}. Mark the operands.` } };
    return { problem: { code: 'no-shape', message: 'No known notation shape matches the selection. Mark the operands.' } };
  }
  const n = best.ops.length, form = forms.find(f => f.arity === n);
  const operands = new Array(n);
  let orderFrom;
  if (best.perm) { best.ops.forEach((o, i) => { operands[best.perm[i]] = o; }); orderFrom = 'form'; }
  else { best.ops.forEach((o, i) => { operands[i] = o; }); orderFrom = 'reading'; }
  return { form, operands, orderFrom, shape: `${best.shape}/${best.variant}` };
}
