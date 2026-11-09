// test/test-core.mjs — the snippet core against every fixture.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5. No converter here
// (that is test-render.mjs); this checks what the core writes.
//
// For every fixture:
//   - apply(): hand fixtures pin the status, the reason code and the exact
//     text; example fixtures may be 'ready' or 'needs-operands', but a ready
//     result must be EXACTLY the expected text: the core may ask, never guess
//     a different label;
//   - applyWithOperands() with the fixture's operands (the author marking
//     them) must write the expected text.
// Then the concept search. Then the auto-coverage snapshot: example fixtures
// that were ready in the pinned snapshot must stay ready.
// Run: node test/test-core.mjs [--write-coverage]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSnippetCore } from '../src/snippet-core.js';
import { loadFixtures, loadExport, selectionOf, operandRangesOf, FIXTURES } from './lib/fixtures.mjs';

const GROUP = 'calculus-analysis';
const core = createSnippetCore(loadExport());
const { hand, examples } = await loadFixtures(GROUP);
let pass = 0, fail = 0;
const lines = [];
const ok = (cond, id, msg) => { if (cond) pass++; else { fail++; lines.push(`FAIL  ${id}: ${msg}`); } return cond; };
const safe = f => { try { return f(); } catch (e) { return { status: 'threw', reason: { code: 'threw', message: e.message } }; } };
const show = r => r.status === 'ready' ? `ready ${JSON.stringify(r.edit.text)}` : `${r.status} (${r.reason?.code}: ${r.reason?.message})`;

function checkMarked(fx, sel) {
  if (!fx.expect.text || !fx.operands) return;
  const m = safe(() => core.applyWithOperands(fx.source, sel, fx.concept, operandRangesOf(fx, sel)));
  ok(m.status === 'ready' && m.edit.text === fx.expect.text, `${fx.id} [marked]`,
     `want ready ${JSON.stringify(fx.expect.text)}, got ${show(m)}`);
}

console.log('--- hand fixtures');
for (const fx of hand) {
  const sel = selectionOf(fx);
  const r = safe(() => core.apply(fx.source, sel, fx.concept));
  const e = fx.expect;
  let good = r.status === e.status;
  if (good && e.code) good = r.reason?.code === e.code;
  if (good && e.status === 'ready') good = r.edit.text === e.text;
  if (good && e.warnings) good = e.warnings.every(w => r.warnings?.some(x => x.code === w));
  ok(good, fx.id, `want ${e.status}${e.code ? ` (${e.code})` : ''}${e.status === 'ready' ? ` ${JSON.stringify(e.text)}` : ''}` +
     `${e.warnings ? ` warnings ${e.warnings}` : ''}, got ${show(r)}${r.warnings?.length ? ` warnings ${r.warnings.map(w => w.code)}` : ''}`);
  if (e.status !== 'refused') checkMarked(fx, sel);
}

console.log('--- example fixtures');
const readyIds = [];
for (const fx of examples) {
  const sel = selectionOf(fx);
  const r = safe(() => core.apply(fx.source, sel, fx.concept));
  if (r.status === 'ready') {
    if (ok(r.edit.text === fx.expect.text, fx.id, `ready but WRONG: want ${JSON.stringify(fx.expect.text)}, got ${JSON.stringify(r.edit.text)}`))
      readyIds.push(fx.id);
  } else ok(r.status === 'needs-operands', fx.id, `want ready or needs-operands, got ${show(r)}`);
  checkMarked(fx, sel);
}

console.log('--- search');
const names = list => list.map(d => d.concept);
const s1 = core.search('real part', { group: GROUP });
ok(s1[0]?.concept === 'real-part', 'search: "real part" finds real-part first', `got ${names(s1).slice(0, 5)}`);
const all = core.search('', { group: GROUP });
const inGroup = loadExport().concepts.filter(r => (r.groups ?? []).includes(GROUP));
const listed = inGroup.filter(r => !r.notUsed && !r.readsWithoutMarkup && !r.role);
ok(all.length === listed.length, 'search: empty query lists the whole group minus not-used, reads-without-markup and role records',
   `got ${all.length}, group has ${inGroup.length} (${inGroup.filter(r => r.notUsed).length} not used, ${inGroup.filter(r => r.readsWithoutMarkup).length} reads without markup, ${inGroup.filter(r => r.role).length} with a role)`);
const s2 = core.search('integral', { group: GROUP });
ok(names(s2).includes('definite-integral') && names(s2).includes('riemann-integral') && s2.every(d => d.groups.includes(GROUP)),
   'search: "integral" within the group', `got ${names(s2)}`);
const s3 = core.search('limit', { group: GROUP });
ok(!names(s3).includes('limit-sup'), 'search: not-used concepts hidden by default', `got ${names(s3)}`);
const s4 = core.search('limit', { group: GROUP, includeNotUsed: true });
ok(names(s4).includes('limit-sup') && s4.find(d => d.concept === 'limit-sup').notUsed?.useInstead === 'supremum-limit',
   'search: not-used concepts shown on request, with what to use instead', `got ${names(s4)}`);
// [CLAUDE 2026-11-08] slim layout 1: no levels; source filter instead; reads-without-markup hidden
const s5 = core.search('', { group: GROUP, source: 'open' });
ok(s5.length > 0 && s5.every(d => d.source === 'open'), 'search: source filter', `got ${s5.length}`);
const s5b = core.search('plus');
ok(!s5b.some(d => d.key === 'core:plus'), 'search: reads-without-markup concepts hidden by default', `got ${s5b.map(d => d.key).slice(0, 5)}`);
const s5c = core.search('plus', { includeReadsWithoutMarkup: true });
ok(s5c.some(d => d.key === 'core:plus' && d.readsWithoutMarkup), 'search: reads-without-markup concepts shown on request, marked', `got ${s5c.map(d => d.key).slice(0, 5)}`);
let layoutRefused = false;
try { createSnippetCore({ meta: { layout: 'slim layout 2' }, concepts: [] }); } catch (e) { layoutRefused = /slim layout 1/.test(e.message); }
ok(layoutRefused, 'a concept list with another layout label is refused, naming the layout the tool reads', '');
// [CLAUDE 2026-11-08, later] logarithm is labelled "reads without markup" (hidden by default), so ask for labelled ones
const s6 = core.search('log', { includeReadsWithoutMarkup: true });
ok(s6[0]?.concept === 'logarithm' || names(s6).slice(0, 3).includes('logarithm'), 'search: no group filter searches every group', `got ${names(s6).slice(0, 5)}`);
// [CLAUDE 2026-11-08] hyperbolic-sine is labelled "reads without markup", so it is hidden by default
const s7 = core.search('hyp sin', { group: GROUP, includeReadsWithoutMarkup: true });
ok(s7[0]?.concept === 'hyperbolic-sine', 'search: word starts ("hyp sin", labelled concepts shown)', `got ${names(s7).slice(0, 3)}`);
const s7b = core.search('hyp sin', { group: GROUP });
ok(s7b[0]?.concept === 'arc-hyperbolic-sine' && !names(s7b).includes('hyperbolic-sine'), 'search: "hyp sin" by default skips the labelled hyperbolic-sine', `got ${names(s7b).slice(0, 3)}`);
// [CLAUDE 2026-11-08, later] [NICHOLAS 2026-11-08] Records with a role (Reference ruling 11: MathCAT
// internal names, intent properties) are never listed or counted, whatever is asked for, and are
// refused when asked for by name or key.
{
  const R = String.raw;
  const recs = loadExport().concepts, roleRecs = recs.filter(r => r.role);
  const everything = core.search('', { includeNotUsed: true, includeReadsWithoutMarkup: true });
  ok(roleRecs.length > 0 && !everything.some(d => d.role),
     'search: records with a role are never listed, even with every option on', `${roleRecs.length} role records; listed: ${everything.filter(d => d.role).map(d => d.concept)}`);
  ok(!core.search('pause', { includeNotUsed: true, includeReadsWithoutMarkup: true }).some(d => d.concept === 'pause')
     && !core.search('say super').some(d => d.concept === 'say-super'),
     'search: a role record is not found by its own name ("pause", "say super")', '');
  const chem = core.groups().find(g => g.id === 'chemistry');
  const chemWant = recs.filter(r => (r.groups ?? []).includes('chemistry') && !r.role).length;
  ok(chem?.count === chemWant, 'group counts leave out role records', `chemistry: got ${chem?.count}, want ${chemWant}`);
  const srcTotal = core.sources().reduce((n, s) => n + s.count, 0);
  ok(srcTotal === recs.length - roleRecs.length, 'source counts leave out role records', `got ${srcTotal}, want ${recs.length - roleRecs.length}`);
  const doc = R`$x \to a$`, sel = { start: 1, end: doc.length - 1 };
  const r1 = core.apply(doc, sel, 'none');
  ok(r1.status === 'refused' && r1.reason.code === 'not-a-concept' && /MathCAT's own rules/.test(r1.reason.message),
     'an internal name asked for by name is refused', `got ${show(r1)}`);
  const r2 = core.apply(doc, sel, 'custom:pause');
  ok(r2.status === 'refused' && r2.reason.code === 'not-a-concept' && r2.reason.message.includes('":pause"'),
     'a property asked for by key is refused, saying how a property is written', `got ${show(r2)}`);
  const r3 = core.applyWithOperandTexts(doc, sel, 'system-of-equations', ['x']);
  ok(r3.status === 'refused' && r3.reason.code === 'not-a-concept', 'typed parts do not get round the refusal', `got ${show(r3)}`);
  ok(core.concept('pause')?.role === 'property', 'a role record is still described (so a message can explain it)', JSON.stringify(core.concept('pause')?.role));
}

console.log('--- typed operands (the demo page path)');
{
  const R = String.raw;
  const doc = R`$\operatorname{arcoth} t$`, s = doc.indexOf('\\'), sel = { start: s, end: doc.length - 1 };
  const r = core.applyWithOperandTexts(doc, sel, 'arc-hyperbolic-cotangent', ['t']);
  // [CLAUDE 2026-11-08] values now carry fixity; arc-hyperbolic-cotangent's kernel form names its part "value"
  ok(r.status === 'ready' && r.edit.text === R`\MathMLintent{arc-hyperbolic-cotangent:function($value)}{\operatorname{arcoth} \MathMLarg{value}{t}}`,
     'typed operand skips the t inside \\operatorname', `got ${show(r)}`);
  const doc2 = R`$\sum_{k} b_k$`, s2 = doc2.indexOf('\\'), sel2 = { start: s2, end: doc2.length - 1 };
  const r2 = core.applyWithOperandTexts(doc2, sel2, 'sum', ['k', 'b_k']);
  ok(r2.status === 'ready' && r2.edit.text === R`\MathMLintent{sum:function($a1,$a2)}{\sum_{\MathMLarg{a1}{k}} \MathMLarg{a2}{b_k}}`,
     'typed operands: a repeated letter takes the first whole, unused piece', `got ${show(r2)}`);
  const r3 = core.applyWithOperandTexts(doc2, sel2, 'sum', ['q']);
  ok(r3.status === 'refused' && r3.reason.code === 'operand-not-found', 'typed operand not in the selection is refused', `got ${show(r3)}`);
  const r4 = core.applyWithOperandTexts(doc2, sel2, 'sum', ['k', 'b', 'k', 'x']);
  ok(r4.status === 'refused' && r4.reason.code === 'arity-mismatch', 'too many typed operands is refused', `got ${show(r4)}`);
}

console.log('--- auto-coverage snapshot');
const snapPath = join(FIXTURES, `auto-coverage-${GROUP}.json`);
if (process.argv.includes('--write-coverage')) {
  writeFileSync(snapPath, JSON.stringify({ note: 'Example fixtures the core labels without help. Pinned from an observed run of test/test-core.mjs; a fixture leaving this list is a regression.', written: new Date().toISOString(), ready: readyIds }, null, 1) + '\n');
  console.log(`wrote ${snapPath} (${readyIds.length} ready)`);
} else if (existsSync(snapPath)) {
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  for (const id of snap.ready) ok(readyIds.includes(id), `coverage ${id}`, 'was labelled without help in the pinned snapshot, now is not');
  const extra = readyIds.filter(id => !snap.ready.includes(id));
  if (extra.length) console.log(`newly ready (not in the snapshot): ${extra.join(', ')}`);
}

for (const l of lines) console.log(l);
console.log(`\nexample fixtures labelled without help: ${readyIds.length} of ${examples.length}`);
console.log(`test-core: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
