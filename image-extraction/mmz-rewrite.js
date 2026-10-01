// mmz-rewrite.mjs — replace matched figure sources with \includegraphics,
// preserving the original as comments. Pure: text in, text + report out.
//
// TWO STRUCTURAL SAFEGUARDS, both independent of TikZ or any figure package:
//  1. OFFSET MAP. Claims are measured in INJECTED coordinates; edits are
//     applied to the ORIGINAL. toOriginal() translates, and returns null if
//     an offset lands inside our own injected text.
//  2. RECORDED-TEXT CHECKSUM. Each claim carries the exact bytes it spanned
//     at build time. Before writing, the text at the translated range must be
//     byte-identical. This is a checksum, not a pattern — it works the same
//     for tikzpicture, \axes, a custom macro, or any drawing mechanism we
//     have never seen. Mismatch => refuse, never guess.
//
// Edits are applied BACK TO FRONT so earlier offsets stay valid.
import { toOriginal } from './mmz-inject.js';

/** Start of the line containing `i`. */
const lineStart = (s, i) => { const j = s.lastIndexOf('\n', Math.max(0, i - 1)); return j + 1; };
/** End of the line containing `i` (index of its '\n', or end of string). */
const lineEnd = (s, i) => { const j = s.indexOf('\n', i); return j === -1 ? s.length : j; };

const commentBlock = (text, indent = '') =>
  text.split('\n').map(l => `${indent}% ${l}`).join('\n');

/**
 * Is this offset inside a wrapper whose CONTENT Pandoc discards?
 * Discovered 2026-09-05 on Exam 2 Practice 2: dc-fig-006 sits inside
 *   \newsavebox{\graph} \sbox{\graph}{ ...figure... }  ...  \usebox{\graph}
 * The rewrite is CORRECT — the image lands exactly where the source was — but
 * Pandoc drops \sbox contents, so the figure never reaches the output. This
 * is a PRE-EXISTING Pandoc limitation, not a rewriter bug, so it is a WARNING
 * (rewrite still proceeds) rather than a refusal.
 * Not exhaustive by design: the general safety net is the Pandoc round-trip.
 */
const OPAQUE = ['sbox', 'savebox', 'usebox', 'raisebox', 'resizebox', 'scalebox'];
export function opaqueWrapperAt(text, offset) {
  let depth = 0;
  for (let i = offset - 1; i >= 0 && offset - i < 4000; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        const before = text.slice(Math.max(0, i - 60), i);
        const m = /\\([a-zA-Z]+)\s*(?:\{\\[a-zA-Z]+\}|\[[^\]]*\])?\s*$/.exec(before);
        if (m && OPAQUE.includes(m[1])) return m[1];
      } else depth--;
    }
  }
  return null;
}

// ─── figures in math (code-image-detection step 3) ───────────────────────────────────────────
// An \includegraphics inside math is math to Pandoc and never shows. So a figure that is the
// ONLY content of a single display or of inline math takes the math delimiters with it; one that
// shares math with other content stays where it was, with a note asking the user to move it.
const MATH_ENVS = new Set(['equation', 'equation*', 'displaymath', 'math', 'align', 'align*',
  'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*',
  'eqnarray', 'eqnarray*']);
// Math that holds a single formula, so a figure can take the whole of it: opener -> closer.
const SINGLE = { '\\[': '\\]', '\\(': '\\)', '$$': '$$', '$': '$', 'equation': '\\end{equation}',
  'equation*': '\\end{equation*}', 'displaymath': '\\end{displaymath}', 'math': '\\end{math}' };

/** The innermost math open at `pos`: { kind, start, end } (end = just after its opener), or
 *  null. Comments are skipped; \\ (so \\[2pt]) and \$ are not delimiters. */
export function enclosingMath(s, pos) {
  const st = [];
  const top = () => st[st.length - 1];
  for (let i = 0; i < pos;) {
    const c = s[i];
    if (c === '%') { const e = s.indexOf('\n', i); i = e === -1 ? s.length : e; continue; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '[' || n === '(') { st.push({ kind: '\\' + n, start: i, end: i + 2 }); i += 2; continue; }
      if (n === ']' || n === ')') {
        if (top() && top().kind === (n === ']' ? '\\[' : '\\(')) st.pop();
        i += 2; continue;
      }
      const m = /^\\(begin|end)\s*\{([^{}]*)\}/.exec(s.slice(i, i + 40));
      if (m && MATH_ENVS.has(m[2].trim())) {
        const k = m[2].trim();
        if (m[1] === 'begin') st.push({ kind: k, start: i, end: i + m[0].length });
        else if (top() && top().kind === k) st.pop();
        i += m[0].length; continue;
      }
      i += 2; continue;
    }
    if (c === '$') {
      const kind = s[i + 1] === '$' ? '$$' : '$';
      if (top() && top().kind === kind) st.pop(); else st.push({ kind, start: i, end: i + kind.length });
      i += kind.length; continue;
    }
    i++;
  }
  return st.length ? top() : null;
}

/** For a figure at [from, to) inside math `enc`: when it is the only content (spaces, \label,
 *  \nonumber, \notag and one trailing . , ; aside), the range of the whole math, the punctuation
 *  to keep after the image, and the labels that go with it. Otherwise null. */
function wholeMath(s, enc, from, to) {
  const close = SINGLE[enc.kind];
  if (!close) return null;
  const c = s.indexOf(close, to);
  if (c === -1) return null;
  const labels = [];
  const strip = t => t.replace(/\\label\s*\{([^{}]*)\}/g, (m, l) => { labels.push(l); return ''; })
    .replace(/\\(?:nonumber|notag)(?![A-Za-z])/g, '');
  const before = strip(s.slice(enc.end, from)), after = /^\s*([.,;]?)\s*$/.exec(strip(s.slice(to, c)));
  if (!/^\s*$/.test(before) || !after) return null;
  return { from: enc.start, to: c + close.length, punct: after[1], labels };
}

/**
 * Plan one edit. Returns {ok, edit|reason}.
 * Two placement shapes:
 *  - 'block'  : the claim occupies whole lines (nothing but whitespace before
 *               it on its first line and after it on its last). Comment the
 *               whole line range, then add the image on its own line.
 *  - 'inline' : the claim is embedded in other material (e.g.
 *               \scalebox{0.75}{\graphcommand{...}}). Replace exactly the
 *               claim span in place and put the commented original on its own
 *               line above. NEVER comment a whole line here — that would kill
 *               the surrounding content.
 */
function planEdit(original, claim, id, imageRef, label = id) {
  const from = toOriginal(claim.start, planEdit.insertions);
  const to = toOriginal(claim.end, planEdit.insertions);
  if (from === null || to === null)
    return { ok: false, reason: 'offset lands inside injected text' };

  const actual = original.slice(from, to);
  if (actual !== claim.text)
    return { ok: false, reason: 'CHECKSUM MISMATCH — text at translated range ' +
      `differs (expected ${claim.text.length} chars, found ${actual.length}); ` +
      `expected starts "${claim.text.slice(0, 40).replace(/\n/g, '\\n')}", ` +
      `found starts "${actual.slice(0, 40).replace(/\n/g, '\\n')}"` };

  // A figure in math (step 3): it takes the whole math when it is all the math holds; otherwise
  // it stays where it was and a note asks the user to move it. Checksum above is on the figure.
  let a = from, b = to, tail = '', note = null;
  const enc = enclosingMath(original, from);
  if (enc) {
    const w = wholeMath(original, enc, from, to);
    if (w) {
      a = w.from; b = w.to; tail = w.punct;
      if (w.labels.length) note = { id: label, kind: 'label', labels: w.labels, at: a };
    } else note = { id: label, kind: 'in-math', math: enc.kind, at: from };
  }
  const ls = lineStart(original, a);
  const le = lineEnd(original, b);
  const prefix = original.slice(ls, a);
  const suffix = original.slice(b, le);
  const indent = (/^[ \t]*/.exec(prefix) || [''])[0];
  const img = `\\includegraphics{${imageRef(id)}}` + tail;
  const header = `%%% ${label} — figure extracted; original source preserved below`;

  if (/^\s*$/.test(prefix) && /^\s*$/.test(suffix)) {
    return { ok: true, note, edit: {
      from: ls, to: le, shape: 'block',
      insert: `${indent}${header}\n${commentBlock(original.slice(ls, le), '')}\n${indent}${img}`,
    } };
  }
  return { ok: true, note, edit: {
    from: a, to: b, shape: 'inline',
    insert: img,
    preline: `${indent}${header}\n${commentBlock(original.slice(a, b), indent)}\n`,
    prelineAt: ls,
  } };
}

/**
 * Rewrite the ORIGINAL source.
 * @param original    the user's text (NOT the injected text)
 * @param insertions  from buildInjected()
 * @param rows        matchExterns() rows
 * @param unmatched   matchExterns() unmatchedClaims — left untouched, reported
 * @param opts.imageRef  id -> reference written into \includegraphics{...}.
 *                       Default is EXTENSIONLESS so one rewritten source stays
 *                       valid for both the PDF (docx) and SVG (html) paths;
 *                       the final choice is deferred until the MuPDF/Lua
 *                       vector-PDF-to-SVG filter is integrated.
 * @param opts.externCount  memoize's own "produced N new externs" count, for
 *                       reconciliation. Mismatch => refuse.
 * @returns {{ok, rewritten, report}}  ok=false means NOTHING was written.
 */
export function rewrite(original, insertions, rows, unmatched = [], opts = {}) {
  const imageRef = opts.imageRef || (id => id);
  // the name shown in the marker comment and the notes (default: the id, as before 1.2.0)
  const labelOf = opts.labelOf || (id => id);
  const report = { edits: [], refusals: [], untouched: [], warnings: [], notes: [], ok: true, reason: '' };
  planEdit.insertions = insertions;

  // --- gate 1: reconciliation -------------------------------------------
  const matched = rows.filter(r => r.status === 'matched');
  const bad = rows.filter(r => r.status !== 'matched');
  if (bad.length) {
    report.ok = false;
    report.reason = `${bad.length} extern(s) not cleanly matched ` +
      `(${bad.map(r => r.id + ':' + r.status).join(', ')})`;
  }
  if (opts.externCount != null && opts.externCount !== rows.length) {
    report.ok = false;
    report.reason += (report.reason ? '; ' : '') +
      `extern count mismatch: memoize reported ${opts.externCount}, ` +
      `manifest has ${rows.length}`;
  }

  // --- plan every edit before applying any ------------------------------
  const planned = [];
  for (const r of matched) {
    if (r.claim.inDefinition) {
      report.refusals.push({ id: r.id, reason: 'claim is inside a macro definition' });
      report.ok = false; continue;
    }
    const p = planEdit(original, r.claim, r.id, imageRef, labelOf(r.id) || r.id);
    if (!p.ok) { report.refusals.push({ id: r.id, reason: p.reason }); report.ok = false; continue; }
    if (p.note) report.notes.push(p.note);
    const opaque = opaqueWrapperAt(original, p.edit.from);
    if (opaque) report.warnings.push({ id: r.id, wrapper: opaque,
      reason: `figure sits inside \\${opaque}{...}; Pandoc discards that ` +
        `content, so this image will NOT reach the output. Rewrite is correct; ` +
        `the limitation is downstream.` });
    planned.push({ id: r.id, confidence: r.confidence, ...p.edit });
  }
  for (const c of unmatched)
    report.untouched.push({ kind: c.kind, name: c.name,
      lines: `${c.startLine}-${c.endLine}`,
      reason: 'no extern — suppressed by build mode; left live deliberately' });

  if (!report.ok) return { ok: false, rewritten: null, report };
  return { ok: true, rewritten: applyEdits(original, planned, report), report };
}

/** Apply planned edits BACK TO FRONT so earlier offsets stay valid. */
function applyEdits(original, planned, report) {
  // overlap check — two figures must never claim overlapping text
  const sorted = [...planned].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].from < sorted[i - 1].to)
      throw new Error(`overlapping edits: ${sorted[i - 1].id} and ${sorted[i].id}`);

  let out = original;
  for (const e of [...planned].sort((a, b) => b.from - a.from)) {
    if (e.shape === 'inline') {
      out = out.slice(0, e.from) + e.insert + out.slice(e.to);
      out = out.slice(0, e.prelineAt) + e.preline + out.slice(e.prelineAt);
    } else {
      out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    }
    report.edits.push({ id: e.id, shape: e.shape, confidence: e.confidence,
                        from: e.from, to: e.to,
                        prelineAt: e.shape === 'inline' ? e.prelineAt : e.from });
  }
  report.edits.reverse();
  return out;
}

/**
 * Idempotency guard: has this source already been rewritten?
 * Cheap and format-independent — looks for our own header marker.
 */
export function alreadyRewritten(text) {
  // both the dc-fig-NNN markers written before 1.2.0 and the <file>-fig-NN ones
  return /^\s*%%%\s+\S*-fig-\d+\s+—\s+figure extracted/m.test(text);
}

/** CodeMirror 6 changeset spec, for applying the same edits in the editor. */
export function toCM6Changes(planned) {
  const specs = [];
  for (const e of planned) {
    if (e.shape === 'inline') {
      specs.push({ from: e.prelineAt, to: e.prelineAt, insert: e.preline });
      specs.push({ from: e.from, to: e.to, insert: e.insert });
    } else {
      specs.push({ from: e.from, to: e.to, insert: e.insert });
    }
  }
  return specs.sort((a, b) => a.from - b.from);
}

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.2.0';
