// test/lib/mathml.mjs — a tiny reader for the MathML the Baseline converter
// writes, and the checks every kernel text must pass.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5. Test-only code: the
// snippet core itself never converts anything.
//
// The checks (plan section 5, steps 1 and 4):
//   - the intent value comes out exactly as written (the full value, not just
//     the concept name), so the operand list stays in the concept's order;
//   - every operand named in the value comes out as exactly ONE element with
//     that arg, inside the labelled element;
//   - that element holds exactly the operand: its text equals the text of the
//     operand converted on its own (this is what catches A_i^T, where the
//     operand swallows the superscript);
//   - no label is lost (as many intent attributes as \MathMLintent commands);
//   - no converter error.
import { pathToFileURL } from 'node:url';

export const BASELINE = 'C:/Users/nim022/Desktop/mma-code/Accessible-STEM-Project/pandoc-for-math-conversion/math-conversion/mathjax-bundle-baseline.js';

let bundle = null;
export async function tex2mml(tex) {
  bundle ??= await import(pathToFileURL(BASELINE).href);
  return bundle.tex2mml(tex, false);
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
               : (ENT[e] ?? m));

/** Parse a MathML string into { name, attrs, children, parent } elements;
 *  text nodes are { text }. Returns the <math> element. */
export function parseMathML(s) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of s.matchAll(re)) {
    if (m[5] !== undefined) {
      const t = decode(m[5]);
      if (t.trim()) stack.at(-1).children.push({ text: t.trim() });
      continue;
    }
    if (m[1]) { stack.pop(); continue; }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const el = { name: m[2], attrs, children: [], parent: stack.at(-1) };
    stack.at(-1).children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root.children.find(c => c.name === 'math') ?? root.children[0];
}

export function* walk(el) {
  if (!el || el.text !== undefined) return;
  yield el;
  for (const c of el.children) yield* walk(c);
}

/** All the text an element holds, in order, with no spaces. */
export function textOf(el) {
  if (el.text !== undefined) return el.text.replace(/\s+/g, '');
  return el.children.map(textOf).join('');
}

const isInside = (el, anc) => { for (let e = el; e; e = e.parent) if (e === anc) return true; return false; };

/** Operand names in an intent value's TOP-LEVEL operand list:
 *  "evaluate($f,$lo,$hi)" -> ['f','lo','hi']; "blue-box" -> []. */
export function topLevelOperands(value) {
  const open = value.indexOf('(');
  if (open < 0) return [];
  const names = [];
  let depth = 0, start = open + 1;
  for (let i = open; i < value.length; i++) {
    const c = value[i];
    if (c === '(') { if (depth++ === 0) start = i + 1; }
    else if (c === ')' || (c === ',' && depth === 1)) {
      const item = value.slice(start, i).trim();
      const m = /^\$([A-Za-z_][\w.-]*)$/.exec(item);
      if (m) names.push(m[1]);
      start = i + 1;
      if (c === ')') depth--;
    }
  }
  return names;
}

const countLabels = tex => (tex.match(/\\MathMLintent(?![A-Za-z])/g) || []).length;

/**
 * Convert a kernel text and check it.
 *   kernel:   the full kernel text (may include text around the label)
 *   value:    the intent value the label must carry, e.g. "evaluate($f,$lo,$hi)"
 *   operands: { name: operandTex } — the operand texts as the author wrote them
 *   notation: the selection without markup (optional): the label must cover it
 * Returns { ok, problems: [string], mml, summary }.
 */
export async function checkKernel({ kernel, value, operands = {}, notation = null }) {
  const problems = [];
  let mml;
  try { mml = await tex2mml(kernel); }
  catch (e) { return { ok: false, problems: [`converter threw: ${e.message}`], mml: '', summary: '' }; }
  if (/<merror|data-mjx-error/.test(mml)) problems.push('converter error in output');
  const math = parseMathML(mml);
  const all = [...walk(math)];
  const labelled = all.filter(e => e.attrs.intent !== undefined);
  const want = countLabels(kernel);
  if (labelled.length !== want)
    problems.push(`${want} label(s) written, ${labelled.length} intent attribute(s) in the MathML: a label was lost or merged`);
  const host = labelled.find(e => e.attrs.intent === value);
  if (!host) {
    problems.push(`no element carries intent="${value}" (found: ${labelled.map(e => JSON.stringify(e.attrs.intent)).join(', ') || 'none'})`);
  } else {
    const names = topLevelOperands(value);
    const given = Object.keys(operands);
    if (names.join() !== given.join())
      problems.push(`operand list in value [${names}] differs from the expected operands [${given}]`);
    for (const name of names) {
      const hits = all.filter(e => e.attrs.arg === name && isInside(e, host));
      if (hits.length !== 1) { problems.push(`operand ${name}: ${hits.length} element(s) with arg="${name}" inside the label (want exactly 1)`); continue; }
      if (operands[name] === undefined) continue;
      const alone = textOf(parseMathML(await tex2mml(operands[name])));
      const got = textOf(hits[0]);
      if (got !== alone) problems.push(`operand ${name}: element <${hits[0].name}> holds "${got}", the operand alone is "${alone}" (swallowed or split)`);
    }
    if (notation !== null) {
      const alone = textOf(parseMathML(await tex2mml(notation)));
      const got = textOf(host);
      if (got !== alone) problems.push(`label covers "${got}", the notation alone is "${alone}"`);
    }
  }
  const summary = all.filter(e => e.attrs.intent !== undefined || e.attrs.arg !== undefined)
    .map(e => `${e.name}${e.attrs.intent !== undefined ? `[intent=${e.attrs.intent}]` : ''}${e.attrs.arg !== undefined ? `[arg=${e.attrs.arg}]` : ''}`).join(' ');
  return { ok: problems.length === 0, problems, mml, summary };
}
