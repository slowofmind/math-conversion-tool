// test-sre-intent.mjs — stage 2: the page-side intent translator and the
// ClearSpeak rules inside filters/mathjax-intent-toggle.lua.
//   node test-sre-intent.mjs          (cwd: js)
// Written [CLAUDE 2026-11-01] for intent-briefing/STAGE2-BRIEF.md section 11
// step 1, BEFORE the translator existed, and seen to fail.
//
// REAL: the filter's own rules and translator code, cut out of the .lua file
// between their START/END markers, and the speech engine MathJax 4.1.3 uses
// (speech-rule-engine 5.0.0-rc.4, from the mathjax-intent-extension's
// node_modules). The rules reach SRE the way the page's worker patch delivers
// them: merged into en.json as it loads. SRE caches loaded rule files, so the
// "stock" engine (no rules of ours) and the "rules" engine run in separate
// child processes (this file, run with --speak stock|rules).
//   S1 each simple intent speaks its words made from the name (expected text
//      from probe-sre-intent-rules-out.txt, column D, probe-sre-restructured-
//      out.txt and probe-sre-intent-page-out.txt)
//   S2 the merged operand (the operand IS the whole wrapped expression) speaks
//      the words, then SRE's own reading of the operand, for every operand
//      type (the defect of STAGE2-BRIEF 4.2 item 6, to be fixed)
//   S3 every case left to SRE (property only, number operand, nested call,
//      malformed, missing arg, operand letters clashing) reads exactly as today
//   S4 MathSpeak is byte-identical, translated or not, for every case
//   S5 translator off: with our rules loaded, untranslated MathML reads
//      exactly as stock SRE (ClearSpeak), for every case
//   S6 the translator never writes ext-speech, aria-label, exact-speech or alt
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXT = 'C:/Users/nim022/Desktop/mma-code/000-BBB - new folders for LLM usage/mathjax-intent-extension';
const require = createRequire(EXT + '/package.json');
const SELF = fileURLToPath(import.meta.url);
const FILTER = fileURLToPath(new URL('../filters/mathjax-intent-toggle.lua', import.meta.url));

// ---------------------------------------------------------------------------
// Child process: speak a list of MathML strings and print the results as JSON.
if (process.argv[2] === '--speak') {
  const sre = require('speech-rule-engine');
  const MAPS = path.join(EXT, 'node_modules/speech-rule-engine/lib/mathmaps');
  const job = JSON.parse(fs.readFileSync(0, 'utf8'));   // { rules, items: [{ domain, xml }] }
  const custom = process.argv[3] === 'rules'
    ? (locale) => {
        const j = JSON.parse(fs.readFileSync(path.join(MAPS, locale + '.json'), 'utf8'));
        if (locale === 'en') for (const k in job.rules) j[k] = job.rules[k];
        return Promise.resolve(JSON.stringify(j));
      }
    : undefined;
  const out = [];
  for (const it of job.items) {
    await sre.setupEngine({ domain: it.domain, locale: 'en', modality: 'speech', ...(custom ? { custom } : {}) });
    await sre.engineReady();
    out.push(sre.toSpeech(it.xml));
  }
  process.stdout.write(JSON.stringify({ version: sre.version, out }));
  process.exit(0);
}

// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '\n       ' + detail : '')); }
}

// Cut a marked block out of the filter.
const lua = fs.readFileSync(FILTER, 'utf8');
function block(label) {
  const m = new RegExp('// >>> ' + label + ' START[^\\n]*\\n([\\s\\S]*?)// <<< ' + label + ' END').exec(lua);
  return m ? m[1] : null;
}
const rulesSrc = block('SRE INTENT RULES');
const translatorSrc = block('SRE INTENT TRANSLATOR');
check('the filter has a marked SRE INTENT RULES block', rulesSrc !== null);
check('the filter has a marked SRE INTENT TRANSLATOR block', translatorSrc !== null);
if (rulesSrc === null || translatorSrc === null) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
const { RULES } = new Function(rulesSrc + '\nreturn { RULES: RULES };')();
const { translateIntents } = new Function(translatorSrc + '\nreturn { translateIntents: translateIntents };')();

// ---------------------------------------------------------------------------
// Cases. kind: 'speak' = expected ClearSpeak text given; 'merged' = expected is
// the words, then stock SRE's reading of `operand` on its own; 'sre' = must
// read exactly as stock SRE.
const M = (b) => '<math xmlns="http://www.w3.org/1998/Math/MathML">' + b + '</math>';
const CASES = [
  // S1: probe-sre-intent-rules.mjs (column D)
  ['speak', 'abs x', M('<mrow intent="absolute-value($a)"><mo>|</mo><mi arg="a">x</mi><mo>|</mo></mrow>'), 'absolute value of x'],
  ['speak', 'det A (bars)', M('<mrow intent="determinant($a)"><mo>|</mo><mi arg="a">A</mi><mo>|</mo></mrow>'), 'determinant of A'],
  ['speak', 'det of a sum', M('<mrow intent="determinant($m)"><mo>|</mo><mrow arg="m"><mi>A</mi><mo>+</mo><mi>B</mi></mrow><mo>|</mo></mrow>'), 'determinant of A plus B'],
  ['speak', 'binomial n k', M('<mrow intent="binomial-coefficient($n,$k)"><mo>(</mo><mfrac linethickness="0"><mi arg="n">n</mi><mi arg="k">k</mi></mfrac><mo>)</mo></mrow>'), 'binomial coefficient of n and k'],
  ['speak', 'open interval', M('<mrow intent="open-interval($s,$e)"><mo>(</mo><mi arg="s">a</mi><mo>,</mo><mi arg="e">b</mi><mo>)</mo></mrow>'), 'open interval of a and b'],
  ['speak', 'infix property', M('<mrow intent="alternation:infix($x,$y)"><mi arg="x">x</mi><mo>∨</mo><mi arg="y">y</mi></mrow>'), 'x alternation y'],
  ['speak', 'literal 0-arity', M('<mi intent="_the-golden-ratio">φ</mi>'), 'the golden ratio'],
  ['speak', 'literal infix', M('<mrow intent="_choose:infix($n,$k)"><mo>(</mo><mfrac linethickness="0"><mi arg="n">n</mi><mi arg="k">k</mi></mfrac><mo>)</mo></mrow>'), 'n choose k'],
  ['speak', 'custom concept', M('<mrow intent="blue-colour-box($a)"><mi arg="a">x</mi><mo>+</mo><mn>1</mn></mrow>'), 'blue colour box of x'],
  ['speak', 'two intents in one formula', M('<mrow><mrow intent="absolute-value($a)"><mo>|</mo><mi arg="a">x</mi><mo>|</mo></mrow><mo>+</mo><mrow intent="determinant($a)"><mo>|</mo><mi arg="a">A</mi><mo>|</mo></mrow></mrow>'), 'absolute value of x plus determinant of A'],
  // S1: probe-sre-restructured.mjs (re-authored forms)
  ['speak', 'nested, one concept per element', M('<mrow intent="norm($d)"><mo>‖</mo><mrow arg="d" intent="difference($a,$b)"><mi arg="a">u</mi><mo>−</mo><mi arg="b">v</mi></mrow><mo>‖</mo></mrow>'), 'norm of difference of u and v'],
  ['speak', 'number marked as an operand', M('<msup intent="power($b,$e)"><mi arg="b">x</mi><mn arg="e">2</mn></msup>'), 'power of x and 2'],
  ['speak', 'property only rewritten as a literal', M('<mrow intent="_water"><msub><mi>H</mi><mn>2</mn></msub><mi>O</mi></mrow>'), 'water'],
  ['speak', 'merged avoided: operand is part, not whole', M('<mrow intent="blue-box($a)"><mo>[</mo><mrow arg="a"><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mo>]</mo></mrow>'), 'blue box of x plus 1'],
  // S1: probe-sre-intent-page.html (words=derived column)
  ['speak', 'page: abs y', M('<mrow intent="absolute-value($a)"><mo>|</mo><mi arg="a">y</mi><mo>|</mo></mrow>'), 'absolute value of y'],
  // S1: properties beyond the probes (words-from-the-name rule, brief 11.3 step 2)
  ['speak', 'postfix property', M('<mrow intent="factorial:postfix($n)"><mi arg="n">n</mi><mo>!</mo></mrow>'), 'n factorial'],
  ['speak', 'three operands', M('<mrow intent="triple($a,$b,$c)"><mo>(</mo><mi arg="a">x</mi><mo>,</mo><mi arg="b">y</mi><mo>,</mo><mi arg="c">z</mi><mo>)</mo></mrow>'), 'triple of x and y and z'],
  // S2: merged operand, every operand type
  ['merged', 'merged: sum (kernel shape)', M('<mrow intent="blue-box($a)"><mrow arg="a"><mi>x</mi><mo>+</mo><mn>1</mn></mrow></mrow>'), 'blue box of', M('<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>')],
  ['merged', 'merged: fraction', M('<mrow intent="blue-box($a)"><mfrac arg="a"><mi>x</mi><mn>2</mn></mfrac></mrow>'), 'blue box of', M('<mfrac><mi>x</mi><mn>2</mn></mfrac>')],
  ['merged', 'merged: power', M('<mrow intent="blue-box($a)"><msup arg="a"><mi>x</mi><mn>3</mn></msup></mrow>'), 'blue box of', M('<msup><mi>x</mi><mn>3</mn></msup>')],
  ['merged', 'merged: root', M('<mrow intent="blue-box($a)"><msqrt arg="a"><mi>x</mi><mo>+</mo><mn>1</mn></msqrt></mrow>'), 'blue box of', M('<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>')],
  ['merged', 'merged: fenced group', M('<mrow intent="blue-box($a)"><mrow arg="a"><mo>(</mo><mi>x</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow></mrow>'), 'blue box of', M('<mrow><mo>(</mo><mi>x</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow>')],
  ['merged', 'merged: lone token', M('<mrow intent="vector($a)"><mi arg="a" mathvariant="bold">v</mi></mrow>'), 'vector of', M('<mi mathvariant="bold">v</mi>')],
  ['merged', 'merged: Greek token', M('<mrow intent="angle-measure($a)"><mi arg="a">θ</mi></mrow>'), 'angle measure of', M('<mi>θ</mi>')],
  // S2: the shape the platform's converter really gives for kernel notation
  // (stage 1 puts \MathMLintent and \MathMLarg on ONE element: observed in the
  // step-6 conversion of stage2-platform-sample.tex, 2026-11-01): the
  // operand is the element itself.
  ['merged', 'self-reference: sum (converter shape)', M('<mrow arg="a" intent="blue-box($a)"><mi>x</mi><mo>+</mo><mn>1</mn></mrow>'), 'blue box of', M('<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>')],
  ['merged', 'self-reference: fraction (converter shape)', M('<mfrac arg="a" intent="blue-box($a)"><mi>x</mi><mn>2</mn></mfrac>'), 'blue box of', M('<mfrac><mi>x</mi><mn>2</mn></mfrac>')],
  ['merged', 'self-reference: root (converter shape)', M('<msqrt arg="a" intent="blue-box($a)"><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>'), 'blue box of', M('<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>')],
  ['merged', 'self-reference: token', M('<mi arg="a" intent="vector($a)" mathvariant="bold">v</mi>'), 'vector of', M('<mi mathvariant="bold">v</mi>')],
  ['speak', 'merged: holds its own arity-1 intent', M('<mrow intent="blue-box($a)"><mrow arg="a"><mrow intent="determinant($m)"><mo>|</mo><mi arg="m">A</mi><mo>|</mo></mrow><mo>+</mo><mn>1</mn></mrow></mrow>'), 'blue box of determinant of A plus 1'],
  // S3: left to SRE
  ['sre', 'property only', M('<mrow intent=":chemical-formula"><msub><mi>H</mi><mn>2</mn></msub><mi>O</mi></mrow>')],
  ['sre', 'number operand', M('<msup intent="power($b,2)"><mi arg="b">x</mi><mn>2</mn></msup>')],
  ['sre', 'nested call', M('<mrow intent="norm(difference($a,$b))"><mo>‖</mo><mi arg="a">u</mi><mo>−</mo><mi arg="b">v</mi><mo>‖</mo></mrow>')],
  ['sre', 'malformed', M('<mrow intent="Blue Box"><mi>x</mi></mrow>')],
  ['sre', 'self-reference with a second operand', M('<mrow arg="a" intent="pair($a,$b)"><mi arg="b">x</mi><mo>+</mo><mn>1</mn></mrow>')],
  ['sre', 'missing arg',M('<mrow intent="determinant($z)"><mo>|</mo><mi>A</mi><mo>|</mo></mrow>')],
  ['sre', 'no intent at all', M('<mrow><mo>|</mo><mi>A</mi><mo>|</mo></mrow>')],
];
// Outer operand letters clash with a nested intent's (outer b would be found at v,
// not w): the outer is left to SRE, the inner is still translated. Expected text
// observed from the stock reading with only the inner translated (see S3b below).
const CLASH = M('<mrow intent="pair($p,$q)"><mrow arg="p" intent="difference($a,$b)"><mi arg="a">u</mi><mo>−</mo><mi arg="b">v</mi></mrow><mo>,</mo><mi arg="q">w</mi></mrow>');

// ---------------------------------------------------------------------------
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
function translateXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const log = translateIntents(doc.documentElement);
  return { xml: new XMLSerializer().serializeToString(doc), log };
}
function speakAll(engine, items) {
  const r = spawnSync(process.execPath, [SELF, '--speak', engine], {
    input: JSON.stringify({ rules: RULES, items }), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('speech child (' + engine + ') failed:\n' + r.stderr);
  return JSON.parse(r.stdout);
}

const rows = CASES.map(([kind, label, xml, expect, operand]) => ({ kind, label, raw: xml, expect, operand, ...translateXml(xml) }));
const clash = translateXml(CLASH);

// Stock engine: raw MathML (both styles), and the merged cases' operands alone.
const stockItems = [];
for (const r of rows) {
  r.iStockCS = stockItems.push({ domain: 'clearspeak', xml: r.raw }) - 1;
  r.iStockMS = stockItems.push({ domain: 'mathspeak', xml: r.raw }) - 1;
  if (r.operand) r.iOperand = stockItems.push({ domain: 'clearspeak', xml: r.operand }) - 1;
}
// Rules engine: translated and untranslated MathML.
const rulesItems = [];
for (const r of rows) {
  r.iCS = rulesItems.push({ domain: 'clearspeak', xml: r.xml }) - 1;
  r.iMS = rulesItems.push({ domain: 'mathspeak', xml: r.xml }) - 1;
  r.iOffCS = rulesItems.push({ domain: 'clearspeak', xml: r.raw }) - 1;
  r.iTwiceCS = rulesItems.push({ domain: 'clearspeak', xml: translateXml(r.raw).xml }) - 1;
}
const iClash = rulesItems.push({ domain: 'clearspeak', xml: clash.xml }) - 1;
const iClashMS = rulesItems.push({ domain: 'mathspeak', xml: clash.xml }) - 1;
const iClashStockMS = stockItems.push({ domain: 'mathspeak', xml: CLASH }) - 1;

const stock = speakAll('stock', stockItems);
const withRules = speakAll('rules', rulesItems);
console.log('speech-rule-engine ' + stock.version + ' (stock) / ' + withRules.version + ' (rules)');
check('SRE is 5.0.0-rc.4 (MathJax 4.1.3\'s)', stock.version === '5.0.0-rc.4' && withRules.version === '5.0.0-rc.4');

const S = stock.out, R = withRules.out;
for (const r of rows) {
  const said = R[r.iCS];
  const results = r.log.map((e) => e.result).join('; ') || 'no intent';
  console.log(`  ${r.label.padEnd(44)} ${said}   (${results})`);
  if (r.kind === 'speak') check('S1 ' + r.label, said === r.expect, `expected "${r.expect}", got "${said}"`);
  if (r.kind === 'merged') {
    const exp = r.expect + ' ' + S[r.iOperand];
    check('S2 ' + r.label, said === exp, `expected "${exp}", got "${said}"`);
  }
  if (r.kind === 'sre') check('S3 ' + r.label, said === S[r.iStockCS], `expected stock "${S[r.iStockCS]}", got "${said}"`);
  if (r.kind !== 'sre') check('S1/S2 ' + r.label + ': translated', r.log.length > 0 && r.log.every((e) => e.result === 'translated'), results);
  check('S4 MathSpeak unchanged: ' + r.label, R[r.iMS] === S[r.iStockMS], `stock "${S[r.iStockMS]}" vs "${R[r.iMS]}"`);
  check('S5 translator off = stock: ' + r.label, R[r.iOffCS] === S[r.iStockCS], `stock "${S[r.iStockCS]}" vs "${R[r.iOffCS]}"`);
  check('S2 same speech when spoken twice: ' + r.label, R[r.iTwiceCS] === said);
  check('S6 no direct-speech attributes: ' + r.label, !/\s(ext-speech|aria-label|exact-speech|alt)=/.test(r.xml));
}

// S3b: the clash case. The outer pair($p,$q) is left to SRE; the inner
// difference($a,$b) is translated, so its words appear and w is still read.
const clashResults = clash.log.map((e) => e.intent + ' -> ' + e.result);
console.log(`  ${'clash: outer left to SRE, inner translated'.padEnd(44)} ${R[iClash]}   (${clashResults.join('; ')})`);
check('S3b clash: outer left to SRE', clash.log[0] && clash.log[0].result !== 'translated', clashResults.join('; '));
check('S3b clash: inner translated', clash.log[1] && clash.log[1].result === 'translated', clashResults.join('; '));
check('S3b clash: the outer carries no ext-* after the clash', !/<mrow intent="pair[^>]*ext-/.test(clash.xml), clash.xml);
check('S3b clash: speech says the inner words and every operand',
  /difference of u and v/.test(R[iClash]) && /\bw\b/.test(R[iClash]), R[iClash]);
check('S4 MathSpeak unchanged: clash', R[iClashMS] === S[iClashStockMS], `stock "${S[iClashStockMS]}" vs "${R[iClashMS]}"`);

// The rules themselves: ClearSpeak only, never ext-speech.
for (const [key, set] of Object.entries(RULES)) {
  check('rules set ' + key + ' is ClearSpeak only', set.domain === 'clearspeak');
  check('rules set ' + key + ' never names ext-speech', !JSON.stringify(set.rules).includes('ext-speech'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
