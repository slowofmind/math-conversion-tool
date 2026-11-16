// snippets/probes/patch-fixture-names-core22-20261108.mjs -- seven hand fixtures take the part names of the new
// kernel forms.
// [CLAUDE 2026-11-08, late] Before Reference tools/apply-core-22-20261108.mjs these concepts had no kernel form, so
// the snippet tool used the record's generic name a1. Their forms now name the part (natural-logarithm, exponential,
// imaginary-part, complex-arg: value; transpose: matrix). Only the names change in the expected text; the structure
// is unchanged (transpose-subscripted keeps A_n as the part, after probes/patch-shapes-unread-20261108.mjs).
// Each target line must be found exactly once; .bak-20261108-core22names backup; refuses a second run.
// Usage: node probes/patch-fixture-names-core22-20261108.mjs [--dry-run]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'hand-calculus-analysis.mjs');
const BAK = FILE + '.bak-20261108-core22names';
const dry = process.argv.includes('--dry-run');
const NOTE_AFTER = '// Baseline converter before it is used.';
const NOTE = '// [CLAUDE 2026-11-08, late] ln-parens, ln-prefix, exp-parens, exp-e-power, imaginary-part-parens, complex-arg-prefix\n// and transpose-subscripted take the part names of the new kernel forms ($a1 -> $value / $matrix): Reference\n// tools/apply-core-22-20261108.mjs [NICHOLAS 2026-11-08: "I approve the groups"].';
const TARGETS = [
  ['natural-logarithm:function($a1)}{\\ln(\\MathMLarg{a1}{1+x})', 'value'],
  ['natural-logarithm:function($a1)}{\\ln \\MathMLarg{a1}{x}}', 'value'],
  ['exponential:function($a1)}{\\exp(', 'value'],
  ['exponential:function($a1)}{e^{', 'value'],
  ['imaginary-part:function($a1)}{\\operatorname{Im}(', 'value'],
  ['complex-arg:function($a1)}{\\arg ', 'value'],
  ['transpose:postfix($a1)}{{\\MathMLarg{a1}{A_n}}^{T}}', 'matrix'],
];
const text = readFileSync(FILE, 'utf8');
if (text.includes('patch-fixture-names-core22') || text.includes('$a1 -> $value')) { console.log('REFUSED  already patched'); process.exit(1); }
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(eol);
const problems = [];
for (const [sub, name] of TARGETS) {
  const hits = lines.map((l, i) => [l, i]).filter(([l]) => l.includes(sub));
  if (hits.length !== 1) { problems.push(`found ${hits.length} times: ${sub}`); continue; }
  const [l, i] = hits[0];
  lines[i] = l.split('($a1)').join(`($${name})`).split('{a1}').join(`{${name}}`);
  console.log(`line ${i + 1}: ${lines[i].trim()}`);
}
const noteAt = lines.map((l, i) => [l, i]).filter(([l]) => l.trim() === NOTE_AFTER);
if (noteAt.length !== 1) problems.push(`note anchor found ${noteAt.length} times`);
if (problems.length) { problems.forEach(p => console.log('REFUSED  ' + p)); console.log('nothing changed'); process.exit(1); }
lines.splice(noteAt[0][1] + 1, 0, ...NOTE.split('\n'));
if (dry) { console.log('dry run: nothing written'); process.exit(0); }
if (existsSync(BAK)) { console.log('REFUSED  backup exists'); process.exit(1); }
copyFileSync(FILE, BAK);
writeFileSync(FILE, lines.join(eol), 'utf8');
console.log('patched ' + FILE + ' (backup ' + BAK + ')');
