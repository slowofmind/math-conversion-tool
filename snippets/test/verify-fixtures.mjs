// test/verify-fixtures.mjs — are the fixtures' expected kernel texts right?
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 1. Every
// expected text is converted with the platform's Baseline converter and must
// pass the checks in lib/mathml.mjs: the full intent value as written (so the
// operand list is in the concept's order), every operand exactly one piece,
// nothing swallowed, no label lost, the label covering the notation.
// Run: node test/verify-fixtures.mjs  [--quiet]
import { checkKernel, topLevelOperands } from './lib/mathml.mjs';
import { loadFixtures } from './lib/fixtures.mjs';

const quiet = process.argv.includes('--quiet');
const { all } = await loadFixtures();
let pass = 0, fail = 0, skip = 0;
const failures = [];
for (const fx of all) {
  const text = fx.expect.text;
  if (!text) { skip++; continue; }
  const m = /\\MathMLintent\{([^{}]*)\}/.exec(text);
  const value = m[1];
  const names = topLevelOperands(value);
  const operands = Object.fromEntries(names.map((n, i) => [n, fx.operands?.[i]?.text]));
  // the text around the label is in the source, not in the expected text
  const r = await checkKernel({ kernel: text, value, operands, notation: fx.select });
  if (r.ok) { pass++; if (!quiet) console.log(`ok    ${fx.id}`); }
  else { fail++; failures.push({ id: fx.id, text, problems: r.problems, summary: r.summary }); }
}
for (const f of failures) {
  console.log(`FAIL  ${f.id}\n      ${f.text}\n      ${f.summary}`);
  for (const p of f.problems) console.log(`      - ${p}`);
}
console.log(`\nverify-fixtures: ${pass} passed, ${fail} failed, ${skip} without an expected text (refusals)`);
process.exitCode = fail ? 1 : 0;
