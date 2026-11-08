// test/gen-fixtures.mjs — one fixture per Reference-tool example, for one
// subject group.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 1. Run:
//   node test/gen-fixtures.mjs            (group calculus-analysis)
// Writes test/fixtures/examples-<group>.json. Re-run when the concept export
// changes; then run test/verify-fixtures.mjs before anything else.
//
// Each example in the export is Ginev-style LaTeX with operand markers,
// \arg{name}{x} (and \intent{name}{x} for symbols). From it we make:
//   source   the example with the markers taken out, inside $...$;
//   select   the whole example (the notation);
//   expect   the kernel text: \MathMLintent{concept($n1,..)}{...\MathMLarg{n1}{x}...}
//            Operand names and their ORDER come from the export's `operands`
//            (the example's own names are matched to them by position in the
//            example's intent value). The only change to the example's layout
//            is a brace pair round an operand that sits as an unbraced script
//            or command argument (x^\arg{a}{2}), which TeX needs.
//   operands the operand texts in concept order, with which occurrence in the
//            selection each one is (for the "author marks the operands" path).
// Expected texts that the converter shows to be wrong are corrected in
// OVERRIDES below, each with the measurement that showed it.
// [CLAUDE 2026-11-08] Now built from the slim copy's kernel forms (each concept's default form),
// not Ginev's examples: the forms were made from those examples and converter-checked, and they
// carry the names, fixity and operand positions the core now uses. The form's notation, markers
// taken out, is the source; the expected text is \MathMLintent{<form's intent>}{<notation with
// \MathMLarg marks>}. Concepts without a kernel form are skipped (listed with the reason).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORT = join(HERE, '../../math-conversion/intent-concepts-slim.json');
const GROUP = process.argv[2] ?? 'calculus-analysis';

// concept -> { text, note } : expected text corrected after test/verify-fixtures.mjs
export const OVERRIDES = {};

function groupEnd(s, i) {
  for (let k = i, d = 0; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '{') d++;
    else if (s[k] === '}' && --d === 0) return k + 1;
  }
  return -1;
}

/** Strip markers. Returns { plain, kernelBody, markers:[{home, content, plainStart}] }. */
export function readExample(tex, nameFor) {
  const re = /\\(arg|intent|MathMLarg|MathMLintent)(?![A-Za-z])\s*\{/g;
  let plain = '', body = '', i = 0;
  const markers = [];
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(tex);
    if (!m) break;
    const nameOpen = m.index + m[0].length - 1;
    const nameEnd = groupEnd(tex, nameOpen);
    let k = nameEnd;
    while (/\s/.test(tex[k])) k++;
    if (nameEnd < 0 || tex[k] !== '{') return null;
    const cEnd = groupEnd(tex, k);
    if (cEnd < 0) return null;
    const before = tex.slice(i, m.index);
    plain += before; body += before;
    const home = tex.slice(nameOpen + 1, nameEnd - 1).trim();
    const inner = readExample(tex.slice(k + 1, cEnd - 1), nameFor);
    if (!inner) return null;
    // taking the marker out must not glue a command to a letter: \cdot\arg{y}{Y} -> \cdot Y.
    // The space goes in the expected text too: it is the author's source, kept as written.
    if (/\\[A-Za-z]+$/.test(plain) && /^[A-Za-z]/.test(inner.plain)) { plain += ' '; body += ' '; }
    if (m[1] === 'arg' || m[1] === 'MathMLarg') {
      // unbraced script / command argument: x^\arg{a}{2}  ->  x^{\MathMLarg{a}{2}}
      const prev = body.replace(/\s+$/, '');
      const bare = /[\^_]$/.test(prev) || /\\(?:hat|bar|vec|dot|ddot|tilde|sqrt|overline|widehat|widetilde)$/.test(prev);
      markers.push({ home, content: inner.plain, plainStart: plain.length });
      for (const im of inner.markers) markers.push({ ...im, plainStart: im.plainStart + plain.length });
      const arg = `\\MathMLarg{${nameFor(home)}}{${inner.kernelBody}}`;
      body += bare ? `{${arg}}` : arg;
    } else {
      for (const im of inner.markers) markers.push({ ...im, plainStart: im.plainStart + plain.length });
      body += inner.kernelBody;
    }
    plain += inner.plain;
    i = cEnd;
  }
  plain += tex.slice(i); body += tex.slice(i);
  return { plain, kernelBody: body, markers };
}

/** "real-part($value)" -> ['value']. */
export function intentOperands(value) {
  const open = value?.indexOf('(') ?? -1;
  if (open < 0) return [];
  return value.slice(open + 1, value.lastIndexOf(')')).split(',').map(s => s.trim().replace(/^\$/, '')).filter(Boolean);
}

/** The form whose arity is n: { arity, operands, wording }. */
export function formFor(rec, n) {
  const forms = (rec.forms ?? []).filter(f => typeof f.arity === 'number');
  const f = forms.find(x => x.arity === n);
  if (f) return f;
  if (rec.arity === n) return { arity: n, operands: rec.operands ?? [], wording: rec.wording };
  return null;
}

const occurrence = (hay, needle, at) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && i <= at; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};

function main() {
  const data = JSON.parse(readFileSync(EXPORT, 'utf8'));
  const recs = data.concepts.filter(r => (r.groups ?? []).includes(GROUP));
  const fixtures = [], skipped = [];
  for (const r of recs) {
    if (r.notUsed) { skipped.push({ concept: r.concept, why: 'marked not used' }); continue; }
    const kf = (r.forms ?? []).find(f => f.default) ?? (r.forms ?? [])[0];
    if (!kf) { skipped.push({ concept: r.concept, why: r.readsWithoutMarkup ? 'reads without markup' : 'no kernel form' }); continue; }
    const pre = `\\MathMLintent{${kf.intent}}{{`;
    if (!kf.tex.startsWith(pre) || !kf.tex.endsWith('}}')) { skipped.push({ concept: r.concept, why: 'kernel form not in the \\MathMLintent{..}{{..}} shape' }); continue; }
    const homes = kf.operands;
    const ex = readExample(kf.tex.slice(pre.length, -2), h => h);
    if (!ex) { skipped.push({ concept: r.concept, why: 'kernel form LaTeX does not parse' }); continue; }
    const top = ex.markers.filter(m => homes.includes(m.home));
    if (top.length !== homes.length || new Set(top.map(m => m.home)).size !== homes.length) {
      skipped.push({ concept: r.concept, why: `kernel form marks ${top.length} operand(s) for ${homes.length} in its intent value` }); continue;
    }
    const select = ex.plain.trim();
    const lead = ex.plain.length - ex.plain.trimStart().length;
    const ordered = homes.map(h => top.find(m => m.home === h));
    const fx = {
      id: `${r.concept}--example`,
      concept: r.key ?? r.concept,
      from: 'kernel form',
      source: `$${select}$`,
      select,
      expect: { text: `\\MathMLintent{${kf.intent}}{${ex.kernelBody.trim()}}`, auto: 'ready-or-needs-operands' },
      operands: ordered.map(m => ({ text: m.content, nth: occurrence(select, m.content, m.plainStart - lead) })),
    };
    if (OVERRIDES[r.concept]) Object.assign(fx.expect, OVERRIDES[r.concept]);
    fixtures.push(fx);
  }
  const out = {
    meta: {
      generator: 'test/gen-fixtures.mjs', group: GROUP, generated: new Date().toISOString(),
      export: { layout: data.meta.layout, generator: data.meta.generator, core: data.meta.builtFrom?.coreCommit,
        annotations: data.meta.builtFrom?.annotationsUpdated, forms: data.meta.builtFrom?.formsUpdated },
      recordsInGroup: recs.length, fixtures: fixtures.length, skipped: skipped.length,
    },
    skipped, fixtures,
  };
  mkdirSync(join(HERE, 'fixtures'), { recursive: true });
  writeFileSync(join(HERE, `fixtures/examples-${GROUP}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(`${GROUP}: ${recs.length} records, ${fixtures.length} fixtures, ${skipped.length} skipped`);
  const why = {};
  for (const s of skipped) why[s.why.replace(/\d+/g, 'N')] = (why[s.why.replace(/\d+/g, 'N')] ?? 0) + 1;
  console.log(why);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
