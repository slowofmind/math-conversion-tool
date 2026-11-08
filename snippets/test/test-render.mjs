// test/test-render.mjs — does what the core writes convert as meant?
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 4. Every READY
// output (the core's own reading, and the "author marks the operands" path)
// is applied to its document; the whole math region is converted with the
// platform's Baseline converter and checked (lib/mathml.mjs):
//   - the label carries the FULL intent value the core reported;
//   - every operand comes out as exactly one piece, holding exactly the
//     operand (nothing swallowed, nothing split);
//   - no label in the region is lost; no converter error;
//   - the label covers the selected notation.
// Run: node test/test-render.mjs
import { createSnippetCore, applyEdit } from '../src/snippet-core.js';
import { findMathRegions } from '../src/latex-parse.js';
import { checkKernel } from './lib/mathml.mjs';
import { loadFixtures, loadExport, selectionOf, operandRangesOf } from './lib/fixtures.mjs';

const core = createSnippetCore(loadExport());
const { all } = await loadFixtures('calculus-analysis');
let pass = 0, fail = 0, notReady = 0;
const failures = [];

async function render(fx, r, how) {
  const doc = applyEdit(fx.source, r.edit);
  const reg = findMathRegions(doc).find(g => g.contentStart <= r.edit.start && r.edit.start + r.edit.text.length <= g.contentEnd);
  if (!reg) { fail++; failures.push(`${fx.id} [${how}]: the edited text is not inside one math region`); return; }
  const math = doc.slice(reg.contentStart, reg.contentEnd);
  const operands = Object.fromEntries(r.operands.map(o => [o.name, o.text]));
  const notation = fx.source.slice(r.edit.start, r.edit.end);
  const c = await checkKernel({ kernel: math, value: r.value, operands, notation });
  if (c.ok) pass++;
  else { fail++; failures.push(`${fx.id} [${how}]: ${math}\n      ${c.summary}\n      - ${c.problems.join('\n      - ')}`); }
}

for (const fx of all) {
  const sel = selectionOf(fx);
  const r = core.apply(fx.source, sel, fx.concept);
  if (r.status === 'ready') await render(fx, r, 'auto'); else notReady++;
  if (fx.expect.text && fx.operands && fx.expect.status !== 'refused') {
    const m = core.applyWithOperands(fx.source, sel, fx.concept, operandRangesOf(fx, sel));
    if (m.status === 'ready') await render(fx, m, 'marked');
  }
}
// Negative controls: texts the checks MUST reject (measured in probes/probe-braces.mjs
// and the kernel explainer). They show this test can fail.
const R = String.raw;
const controls = [
  ['operand swallows the superscript (F4)', { kernel: R`\MathMLintent{complex-conjugate($a1)}{\MathMLarg{a1}{z_k}^*}`, value: 'complex-conjugate($a1)', operands: { a1: 'z_k' }, notation: 'z_k^*' }],
  ['label swallows a script outside it', { kernel: R`\MathMLintent{exponential-e}{e_1}^2`, value: 'exponential-e', operands: {}, notation: 'e_1' }],
  ['nested label lost on one element', { kernel: R`\MathMLintent{f($a)}{\MathMLarg{a}{\MathMLintent{g($b)}{\MathMLarg{b}{x}}}}`, value: 'f($a)', operands: { a: 'x' }, notation: 'x' }],
  ['operand list not in the expected order', { kernel: R`\MathMLintent{evaluate($a1,$a3,$a2)}{\MathMLarg{a1}{F}\Big|_{\MathMLarg{a2}{0}}^{\MathMLarg{a3}{1}}}`, value: 'evaluate($a1,$a3,$a2)', operands: { a1: 'F', a2: '0', a3: '1' }, notation: R`F\Big|_{0}^{1}` }],
];
let caught = 0;
for (const [label, args] of controls) {
  const c = await checkKernel(args);
  if (!c.ok) caught++;
  else { fail++; failures.push(`negative control NOT caught: ${label}`); }
  console.log(`control ${c.ok ? 'MISSED' : 'caught'}: ${label}${c.ok ? '' : ` (${c.problems[0]})`}`);
}

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\ntest-render: ${pass} passed, ${fail} failed (${notReady} fixtures not ready in auto mode, so not rendered there); negative controls caught: ${caught} of ${controls.length}`);
process.exitCode = fail ? 1 : 0;
