// N-T1 (PLAN-MATHCAT-NAVIGATION.md section 6): engine navigate() == NVDA's own
// text for every golden row (21 cases x 2 forms), the whole N-T1 sequence,
// errors included. Golden = MathCAT SSML driven in NVDA's call order
// (gen-nav-ssml.mjs) through NVDA's convertSSMLTextForNVDA (nvda_nav_reference.py).
// Also here, because they need the real engine:
//   N-T3a  whole-expression speech is unchanged by the tags (NV3);
//   N-T6   (engine side) unknown commands refused without touching MathCAT (N14),
//          reload when another expression was loaded, goTo (N13).
// Failure messages: entering (first ZoomIn after arriving) -> "Error in starting
// navigation of math."; any other key -> "Error in navigating math" (N6, N22).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done, collapse } from './lib.mjs';
import { wantText, wantHighlight } from './nav-env.mjs';
import { createMathCATEngine } from '../mathcat.js';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const golden = read('./nav-golden.json');
const first = read('./golden.json');                         // first plan, untagged
const engine = await createMathCATEngine({ bytes: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
check('engine has navigate()', typeof engine.navigate === 'function');
check('engine has goTo()', typeof engine.goTo === 'function');
if (typeof engine.navigate !== 'function' || typeof engine.goTo !== 'function') done('N-T1 nav engine');

const idsIn = (mathml) => new Set([...mathml.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
const rows = golden.rows.filter((r) => r.steps);
eq('golden rows with steps', rows.length, 42);
eq('sequence', golden.meta.sequence.join(','), 'ZoomIn,MoveNext,MoveNext,ZoomIn,ZoomOut,ZoomOutAll,MoveLastLocation,ReadCurrent,WhereAmI,DescribeCurrent');

// ---- N-T1: every row, every step --------------------------------------------
// The first step of each row starts fresh (N19) and is the entering step (N22).
let enteringFailures = 0, keyFailures = 0;
for (const row of rows) {
  const ids = idsIn(row.mathml);
  for (let i = 0; i < row.steps.length; i++) {
    const s = row.steps[i], at = `${row.name}/${row.form} #${i} ${s.command}`;
    const r = await engine.navigate(row.mathml, s.command, { fresh: i === 0, entering: i === 0 });
    eq(`${at}: ok`, r.ok, !s.error);
    eq(`${at}: text`, r.text, wantText(s, collapse));
    eq(`${at}: nodeTag`, r.nodeTag, ids.has(s.navId) ? s.navId : null);
    eq(`${at}: highlightTags`, JSON.stringify(r.highlightTags), JSON.stringify(wantHighlight(s)));
    if (s.error) {
      check(`${at}: MathCAT's own text kept for the console`, typeof r.error === 'string' && r.error.length > 0, r.error);
      if (i === 0) enteringFailures++; else keyFailures++;
    }
  }
}
check('the entering-failure message was exercised', enteringFailures > 0, String(enteringFailures));
check('the key-failure message was exercised', keyFailures > 0, String(keyFailures));

// ---- N-T3a (NV3): tags leave whole-expression speech unchanged -------------
// Tagged speech must equal the golden arriving speech on every row, and the
// first plan's UNTAGGED golden on every row except malformed/mathjax, where
// MathJax itself repairs the input into <merror> (sitting 2 finding).
let sameAsUntagged = 0;
const differ = [];
for (const row of rows) {
  const r = await engine.speak(row.mathml);
  if (row.arrive.error) { eq(`${row.name}/${row.form}: speak fails as NVDA's arrive did`, r.ok, false); }
  else eq(`${row.name}/${row.form}: speak == golden arrive`, r.text, collapse(row.arrive.viewerRaw));
  const base = first.rows.find((g) => g.name === (row.name === 'quadratic-existing-id' ? 'quadratic' : row.name));
  const untagged = base.nvdaError ? null : collapse(base.nvdaViewerRaw);
  if ((r.ok ? r.text : null) === untagged) sameAsUntagged++; else differ.push(`${row.name}/${row.form}`);
}
eq('rows speaking as the untagged first-plan golden', sameAsUntagged, 41);
eq('the one difference', differ.join(','), 'malformed/mathjax');

// ---- N-T6 (engine side) ------------------------------------------------------
const A = rows.find((r) => r.name === 'quadratic' && r.form === 'plain');
const B = rows.find((r) => r.form === 'plain' && r.name !== 'quadratic' && !r.arrive.error && !r.steps[0].error);
const step = (row, i) => wantText(row.steps[i], collapse);
// N14: a name outside NVDA's list is refused and MathCAT is not touched
await engine.navigate(A.mathml, 'ZoomIn', { fresh: true, entering: true });
for (const bad of ['EraseEverything', 'toString', '__proto__', 'zoomin', '']) {
  const r = await engine.navigate(A.mathml, bad);
  eq(`refused ${JSON.stringify(bad)}: ok`, r.ok, false);
  eq(`refused ${JSON.stringify(bad)}: NVDA's message`, r.text, 'Error in navigating math');
  check(`refused ${JSON.stringify(bad)}: says why`, /not an NVDA navigation command/.test(r.error || ''), r.error);
}
eq('after refusals, navigation continues where it was', (await engine.navigate(A.mathml, 'MoveNext')).text, step(A, 1));
// reload when speak() loaded another expression in between (3.3)
await engine.navigate(A.mathml, 'ZoomIn', { fresh: true });
await engine.speak(B.mathml);
eq('speak(B) in between: A reloads, back at the whole expression', (await engine.navigate(A.mathml, 'ZoomIn')).text, step(A, 0));
// reload when a different expression is navigated, without fresh
eq('navigate(B) without fresh: B loads', (await engine.navigate(B.mathml, 'ZoomIn')).text, step(B, 0));
// same expression, fresh: back to the whole expression (N19)
await engine.navigate(A.mathml, 'ZoomIn', { fresh: true });
await engine.navigate(A.mathml, 'MoveNext');
eq('fresh on the same expression restarts', (await engine.navigate(A.mathml, 'ZoomIn', { fresh: true })).text, step(A, 0));
// speak() is unaffected by navigation
eq('speak(A) after navigating == golden arrive', (await engine.speak(A.mathml)).text, collapse(A.arrive.viewerRaw));

// ---- goTo (N13): reserved for the comparison view ----------------------------
const idsA = idsIn(A.mathml);
const rc = A.steps.findIndex((s) => s.command === 'ReadCurrent');
const tag = A.steps[rc].navId;
check('golden ReadCurrent sits on one of our tags', idsA.has(tag), tag);
const g = await engine.goTo(A.mathml, tag, { fresh: true });
eq('goTo: ok', g.ok, true);
eq('goTo: nodeTag', g.nodeTag, tag);
eq('goTo: text == ReadCurrent there', g.text, step(A, rc));
eq('goTo: highlight', JSON.stringify(g.highlightTags), JSON.stringify([tag]));
const gBad = await engine.goTo(A.mathml, 'no-such-id');
eq('goTo unknown tag: ok', gBad.ok, false);
eq('goTo unknown tag: message', gBad.text, 'Error in navigating math');
done('N-T1 nav engine');
