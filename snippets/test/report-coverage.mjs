// test/report-coverage.mjs — for the README: what the core does with every
// fixture (status, shape, where the operand order came from, reason).
// [CLAUDE 2026-11-02] Track C. Measuring only; changes nothing.
// Run: node test/report-coverage.mjs > test/runs/<date>-coverage.txt
import { createSnippetCore } from '../src/snippet-core.js';
import { loadFixtures, loadExport, selectionOf } from './lib/fixtures.mjs';

const GROUP = 'calculus-analysis';
const data = loadExport();
const core = createSnippetCore(data);
const { hand, examples, skipped } = await loadFixtures(GROUP);
const row = (fx, r) => [fx.id.padEnd(44), r.status.padEnd(15),
  r.status === 'ready' ? `${r.shape} | order from ${r.orderFrom}${r.warnings.length ? ' | ' + r.warnings.map(w => w.code).join(',') : ''}`
    : `${r.reason.code}: ${r.reason.message}`].join(' ');

for (const [title, list] of [['EXAMPLE FIXTURES (one per concept with a LaTeX example)', examples], ['HAND FIXTURES', hand]]) {
  console.log(`\n=== ${title}`);
  const counts = {};
  for (const fx of list) {
    const r = core.apply(fx.source, selectionOf(fx), fx.concept);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(row(fx, r));
  }
  console.log('counts:', JSON.stringify(counts));
}

console.log('\n=== CONCEPTS IN THE GROUP WITH NO EXAMPLE FIXTURE');
const handConcepts = new Set(hand.map(f => core.concept(f.concept)?.concept));
for (const s of skipped) console.log(`${s.concept.padEnd(30)} ${s.why.padEnd(36)} ${handConcepts.has(s.concept) ? 'hand fixture(s)' : 'NO FIXTURE'}`);
