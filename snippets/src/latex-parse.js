// src/latex-parse.js — read LaTeX math the way TeX groups it.
// [CLAUDE 2026-11-02] Track C of the overnight plan (section 5): a fresh
// snippet core. No imports; runs in the browser and in Node.
//
// Two jobs:
//   findMathRegions(doc)  where the math is in a document ($..$, \(..\),
//                         \[..\], $$..$$, math environments);
//   parseMath(doc, s, e)  the math between s and e as a TREE of rows and
//                         terms, every node with its offsets in the document.
//
// The tree follows TeX, not appearance:
//   row   { kind:'row', start, end, terms:[term], braced, mode, parent }
//         The contents of a brace group, an argument, a script, a \left..\right,
//         an environment cell, or the whole region. `braced` is false for an
//         argument written without braces (\hat f, x^2): the writer must add
//         them. `mode` is 'math', 'text' (\text{..}), 'name' (\operatorname{..})
//         or 'raw' (the label and operand-name arguments of \MathMLintent /
//         \MathMLarg).
//   term  { kind:'term', start, end, base, sub, sup, primes, row }
//         One base and the scripts TeX attaches to it. sub / sup are rows.
//   items (term.base):
//     char     one character: a letter, digit or symbol (TeX does NOT pair
//              ( ) or [ ]: they are characters, and shapes pair them later)
//     command  \name or \symbol with its arguments: { name, args:[row], opt:[row] }
//     group    { .. } with its row
//     leftright \left<d> row \right<d>: { open, close, row }
//     env      \begin{name} .. \end{name}: { name, cells:[[row]] } (rows of cells)
//     space    spacing: \, \; \: \! \quad \qquad ~ \  (and \limits / \nolimits)
//     sep      & or \\ outside an environment (kept so checks can see them)
// Returns null when the math does not parse (unbalanced braces, a \left with
// no \right, an \end with no \begin ...).

// Commands whose arguments we know. [required, optional?]. Everything else
// takes no arguments, so a brace group after an unknown command is its own
// group (user macros such as \abs{x} read as \abs followed by {x}).
export const ARG_COUNTS = {
  frac: 2, dfrac: 2, tfrac: 2, cfrac: 2, binom: 2, dbinom: 2, tbinom: 2,
  overset: 2, underset: 2, stackrel: 2, sqrt: [1, 1], xrightarrow: [1, 1], xleftarrow: [1, 1],
  hat: 1, widehat: 1, bar: 1, overline: 1, underline: 1, vec: 1, dot: 1, ddot: 1, dddot: 1,
  tilde: 1, widetilde: 1, check: 1, breve: 1, acute: 1, grave: 1, mathring: 1,
  overrightarrow: 1, overleftarrow: 1, overbrace: 1, underbrace: 1,
  mathbf: 1, mathrm: 1, mathit: 1, mathsf: 1, mathtt: 1, mathcal: 1, mathbb: 1, mathfrak: 1,
  mathscr: 1, boldsymbol: 1, bm: 1, mathop: 1, mathopen: 1, mathclose: 1, mathord: 1,
  mathbin: 1, mathrel: 1, operatorname: 1, 'operatorname*': 1,
  text: 1, textrm: 1, textit: 1, textbf: 1, mbox: 1, textsf: 1, texttt: 1, textup: 1,
  MathMLintent: 2, MathMLarg: 2, intent: 2, iarg: [1, 1],
  boxed: 1, phantom: 1, hphantom: 1, vphantom: 1, color: 1, textcolor: 2,
};
const TEXT_COMMANDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox', 'textsf', 'texttt', 'textup']);
// Arguments that are not math: the label value and the operand name.
const RAW_FIRST_ARG = new Set(['MathMLintent', 'MathMLarg', 'intent', 'color', 'textcolor']);
// The argument is a function NAME (\operatorname{arcoth}): its letters are not
// separate pieces of math, so nothing inside may be selected or marked.
const NAME_COMMANDS = new Set(['operatorname', 'operatorname*']);
// Font commands: their letters are pieces of math, but part of a word
// (the o of \mathrm{Log}) is refused.
export const FONT_COMMANDS = new Set(['mathrm', 'mathit', 'mathsf', 'mathtt', 'mathbf', 'mathcal', 'mathbb',
  'mathfrak', 'mathscr', 'boldsymbol', 'bm']);
const SPACING = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'enspace', 'thinspace',
  'medspace', 'thickspace', 'negthinspace', 'limits', 'nolimits', 'displaystyle', 'textstyle']);
export const MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray',
  'eqnarray*', 'displaymath', 'math'];

/** The math regions of a document: [{ start, end, contentStart, contentEnd, delim }].
 *  Comments and escaped \$ are skipped. */
export function findMathRegions(doc) {
  const regions = [];
  const envRe = new RegExp(String.raw`^\\begin\{(${MATH_ENVS.map(e => e.replace('*', '\\*')).join('|')})\}`);
  let i = 0;
  while (i < doc.length) {
    const c = doc[i];
    if (c === '%') { const n = doc.indexOf('\n', i); i = n < 0 ? doc.length : n + 1; continue; }
    if (c === '\\') {
      const two = doc.slice(i, i + 2);
      if (two === '\\(' || two === '\\[') {
        const close = two === '\\(' ? '\\)' : '\\]';
        const e = findClose(doc, i + 2, close);
        if (e < 0) return regions;
        regions.push({ start: i, end: e + 2, contentStart: i + 2, contentEnd: e, delim: two });
        i = e + 2; continue;
      }
      const m = envRe.exec(doc.slice(i, i + 40));
      if (m) {
        const endTag = `\\end{${m[1]}}`;
        const e = findClose(doc, i + m[0].length, endTag);
        if (e < 0) return regions;
        regions.push({ start: i, end: e + endTag.length, contentStart: i + m[0].length, contentEnd: e, delim: m[1] });
        i = e + endTag.length; continue;
      }
      i += 2; continue;
    }
    if (c === '$') {
      const dbl = doc[i + 1] === '$';
      const open = dbl ? 2 : 1;
      const e = findClose(doc, i + open, dbl ? '$$' : '$');
      if (e < 0) return regions;
      regions.push({ start: i, end: e + open, contentStart: i + open, contentEnd: e, delim: dbl ? '$$' : '$' });
      i = e + open; continue;
    }
    i++;
  }
  return regions;
}

/** First unescaped `close` at or after i, outside brace groups, skipping
 *  comments; -1 if none. A $ inside braces does not end math: the label
 *  value in \MathMLintent{f($a)}{..} sits inside $..$ (TeX reads the braced
 *  argument whole). */
function findClose(doc, i, close) {
  let depth = 0;
  for (let k = i; k < doc.length; k++) {
    if (doc[k] === '%') { const n = doc.indexOf('\n', k); if (n < 0) return -1; k = n; continue; }
    if (depth === 0 && doc.startsWith(close, k)) {
      if (close === '$' && doc[k + 1] === '$') return -1;   // $..$$ is malformed
      return k;
    }
    if (doc[k] === '\\') { k++; continue; }
    if (doc[k] === '{') depth++;
    else if (doc[k] === '}') depth = Math.max(0, depth - 1);
  }
  return -1;
}

// ---- Tokens -----------------------------------------------------------------
// { t: 'cs'|'char'|'open'|'close'|'sup'|'sub'|'prime'|'amp'|'space', name?, start, end }
function tokenize(doc, s, e) {
  const out = [];
  for (let i = s; i < e;) {
    const c = doc[i];
    if (c === '%') { const n = doc.indexOf('\n', i); i = n < 0 || n > e ? e : n + 1; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+\*?|.)/s.exec(doc.slice(i, Math.min(e, i + 40)));
      if (!m) return null;
      let name = m[1];
      // only \operatorname* keeps its star; for other words the star is a char
      if (name.endsWith('*') && name !== 'operatorname*') name = name.slice(0, -1);
      out.push({ t: 'cs', name, start: i, end: i + 1 + name.length });
      i += 1 + name.length; continue;
    }
    const t = c === '{' ? 'open' : c === '}' ? 'close' : c === '^' ? 'sup' : c === '_' ? 'sub'
      : c === "'" ? 'prime' : c === '&' ? 'amp' : c === '~' ? 'space' : 'char';
    out.push({ t, start: i, end: i + 1, ch: c });
    i++;
  }
  return out;
}

// ---- Parser -----------------------------------------------------------------
export function parseMath(doc, s = 0, e = doc.length) {
  const toks = tokenize(doc, s, e);
  if (!toks) return null;
  let p = 0;
  const fail = () => { throw new SyntaxError('parse'); };

  // Read terms until a stop token. Returns a row.
  function row(start, stop, opts = {}) {
    const r = { kind: 'row', start, end: start, terms: [], braced: opts.braced ?? true, mode: opts.mode ?? 'math' };
    while (p < toks.length) {
      const tk = toks[p];
      if (stop(tk)) break;
      if (tk.t === 'close') fail();
      const term = readTerm(r);
      if (term) r.terms.push(term);
    }
    r.end = r.terms.length ? r.terms.at(-1).end : start;
    return r;
  }

  function readTerm(parentRow) {
    const tk = toks[p];
    let base;
    if (tk.t === 'sup' || tk.t === 'sub' || tk.t === 'prime') {
      base = { kind: 'empty', start: tk.start, end: tk.start };   // a script with no base: {}^{\circ}
    } else base = readItem();
    const term = { kind: 'term', start: base.start, end: base.end, base, sub: null, sup: null, primes: 0, row: parentRow };
    base.term = term;
    if (base.kind === 'space' || base.kind === 'sep') return term;
    for (;;) {
      const nx = toks[p];
      if (!nx) break;
      if (nx.t === 'cs' && (nx.name === 'limits' || nx.name === 'nolimits')) { p++; term.end = nx.end; continue; }
      if (nx.t === 'prime') { p++; term.primes++; term.end = nx.end; continue; }
      if (nx.t === 'sup' || nx.t === 'sub') {
        p++;
        const which = nx.t;
        if (term[which]) fail();                        // double script: TeX error
        const arg = readArgument();
        arg.marker = nx.start;
        term[which] = arg; term.end = arg.groupEnd ?? arg.end;
        continue;
      }
      break;
    }
    return term;
  }

  // An argument: a braced group's row, or one token as an unbraced row.
  function readArgument(mode = 'math') {
    const tk = toks[p];
    if (!tk) fail();
    if (tk.t === 'open') {
      p++;
      const r = row(tk.end, x => x.t === 'close', { mode });
      if (!toks[p] || toks[p].t !== 'close') fail();
      r.groupStart = tk.start; r.groupEnd = toks[p].end;
      r.start = tk.end; r.end = toks[p].start;
      p++;
      return r;
    }
    if (tk.t === 'close' || tk.t === 'sup' || tk.t === 'sub' || tk.t === 'amp') fail();
    const r = { kind: 'row', start: tk.start, end: tk.end, terms: [], braced: false, mode };
    const item = readItem(true);
    const term = { kind: 'term', start: item.start, end: item.end, base: item, sub: null, sup: null, primes: 0, row: r };
    item.term = term;
    r.terms.push(term); r.end = item.end;
    return r;
  }

  function readItem(single = false) {
    const tk = toks[p++];
    if (tk.t === 'open') {
      const r = row(tk.end, x => x.t === 'close');
      const cl = toks[p];
      if (!cl || cl.t !== 'close') fail();
      p++;
      r.start = tk.end; r.end = cl.start;
      return { kind: 'group', start: tk.start, end: cl.end, row: r };
    }
    if (tk.t === 'amp') return { kind: 'sep', start: tk.start, end: tk.end, sep: '&' };
    if (tk.t === 'space') return { kind: 'space', start: tk.start, end: tk.end };
    if (tk.t === 'char') return { kind: 'char', start: tk.start, end: tk.end, ch: tk.ch };
    if (tk.t === 'prime') return { kind: 'char', start: tk.start, end: tk.end, ch: "'" };
    // control sequence
    const name = tk.name;
    if (name === '\\') return { kind: 'sep', start: tk.start, end: tk.end, sep: '\\\\' };
    if (SPACING.has(name)) return { kind: 'space', start: tk.start, end: tk.end, name };
    if (name === 'left' && !single) {
      const open = readDelimiter();
      const r = row(open.end, x => x.t === 'cs' && x.name === 'right');
      const rt = toks[p];
      if (!rt) fail();
      p++;
      const close = readDelimiter();
      r.start = open.end; r.end = rt.start;
      return { kind: 'leftright', start: tk.start, end: close.end, open, close, row: r };
    }
    if (name === 'right' || name === 'end') fail();
    if (name === 'begin' && !single) {
      const nm = readName();
      const env = { kind: 'env', start: tk.start, end: 0, name: nm.name, cells: [[]] };
      if (/^(alignat|array|tabular)/.test(nm.name) && toks[p]?.t === 'open') readArgument('raw');
      for (;;) {
        const cellStart = toks[p]?.start ?? e;
        const r = row(cellStart, x => x.t === 'amp' || (x.t === 'cs' && (x.name === '\\' || x.name === 'end')));
        r.start = cellStart; if (!r.terms.length) r.end = cellStart;
        env.cells.at(-1).push(r);
        const nx = toks[p];
        if (!nx) fail();
        p++;
        if (nx.t === 'amp') continue;
        if (nx.name === '\\') { env.cells.push([]); continue; }
        const endName = readName();
        if (endName.name !== nm.name) fail();
        env.end = endName.end;
        break;
      }
      return env;
    }
    const spec = ARG_COUNTS[name];
    const item = { kind: 'command', name, start: tk.start, end: tk.end, args: [], opt: [] };
    if (spec !== undefined) {
      const [req, opt] = Array.isArray(spec) ? spec : [spec, 0];
      if (opt && toks[p]?.t === 'char' && toks[p].ch === '[') item.opt.push(readOptional());
      for (let k = 0; k < req; k++) {
        const mode = TEXT_COMMANDS.has(name) ? 'text' : (k === 0 && RAW_FIRST_ARG.has(name)) ? 'raw'
          : NAME_COMMANDS.has(name) ? 'name' : 'math';
        if (name === 'iarg' && k === 0 && toks[p]?.t === 'char' && toks[p].ch === '[') item.opt.push(readOptional());
        const a = readArgument(mode);
        item.args.push(a);
      }
      const last = item.args.at(-1) ?? item.opt.at(-1);
      if (last) item.end = last.groupEnd ?? last.end;
    }
    return item;
  }

  function readOptional() {
    const open = toks[p++];
    const r = row(open.end, x => x.t === 'char' && x.ch === ']');
    const cl = toks[p];
    if (!cl) fail();
    p++;
    r.start = open.end; r.end = cl.start; r.groupStart = open.start; r.groupEnd = cl.end;
    return r;
  }

  function readDelimiter() {
    const tk = toks[p++];
    if (!tk || tk.t === 'open' || tk.t === 'close') fail();
    return { start: tk.start, end: tk.end, text: doc.slice(tk.start, tk.end) };
  }

  function readName() {
    const o = toks[p++];
    if (!o || o.t !== 'open') fail();
    let k = o.end;
    const c = doc.indexOf('}', k);
    if (c < 0) fail();
    while (p < toks.length && toks[p].start < c) p++;
    if (!toks[p] || toks[p].t !== 'close') fail();
    p++;
    return { name: doc.slice(k, c), end: c + 1 };
  }

  try {
    const r = row(s, () => false);
    r.start = s; r.end = e;
    link(r, null);
    return r;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

/** Give every row and item a parent pointer (rows -> owning item, items -> term). */
function link(r, parent) {
  r.parent = parent;
  for (const t of r.terms) {
    t.row = r;
    linkItem(t.base, t);
    if (t.sub) link(t.sub, t);
    if (t.sup) link(t.sup, t);
  }
}
function linkItem(it, term) {
  it.term = term;
  if (it.kind === 'group' || it.kind === 'leftright') link(it.row, it);
  if (it.kind === 'command') { for (const a of [...it.opt, ...it.args]) link(a, it); }
  if (it.kind === 'env') for (const line of it.cells) for (const c of line) link(c, it);
}

/** Every row in the tree, depth first. */
export function* allRows(r) {
  yield r;
  for (const t of r.terms) {
    yield* itemRows(t.base);
    if (t.sub) yield* allRows(t.sub);
    if (t.sup) yield* allRows(t.sup);
  }
}
function* itemRows(it) {
  if (it.kind === 'group' || it.kind === 'leftright') yield* allRows(it.row);
  if (it.kind === 'command') for (const a of [...it.opt, ...it.args]) yield* allRows(a);
  if (it.kind === 'env') for (const line of it.cells) for (const c of line) yield* allRows(c);
}

/** Every command item in the tree, in document order. */
export function* allCommands(r) {
  for (const row of allRows(r)) for (const t of row.terms) if (t.base.kind === 'command') yield t.base;
}

/** The content terms of a row: no spacing, no separators. */
export const contentTerms = r => r.terms.filter(t => t.base.kind !== 'space' && t.base.kind !== 'sep');
