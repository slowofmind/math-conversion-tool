// probe-wording-order-20261108.mjs [CLAUDE 2026-11-08] read-only: where does the dropped wording decide operand order?
import { readFileSync } from 'node:fs';
import { mentionOrder } from '../src/concepts.js';
const full = JSON.parse(readFileSync('../math-conversion/intent-concepts.json', 'utf8')).concepts;
const first = w => (Array.isArray(w) ? w[0] : w) ?? null;
let multi = 0, mentions = 0, differs = 0, exampleToo = 0, onlyWording = 0; const samples = [];
for (const r of full) {
  if (r.notUsed) continue;
  const forms = (r.forms ?? []).filter(f => typeof f.arity === 'number');
  const list = forms.length ? forms : (typeof r.arity === 'number' ? [{ arity: r.arity, operands: r.operands, wording: r.wording }] : []);
  for (const f of list) {
    const ops = f.operands ?? [];
    if (ops.length < 2) continue;
    multi++;
    const m = mentionOrder(first(f.wording ?? r.wording), ops);
    if (!m) continue;
    mentions++;
    const d = m.join() !== ops.join();
    if (d) differs++;
    const hasEx = !!(r.example && r.example.tex);
    if (hasEx) exampleToo++; else onlyWording++;
    if (d && samples.length < 8) samples.push(`${r.key} ops=${ops.join(',')} spoken=${m.join(',')} example=${hasEx ? 'yes' : 'no'} | ${first(f.wording ?? r.wording)}`);
  }
}
console.log({ multiOperandForms: multi, wordingGivesOrder: mentions, spokenOrderDiffersFromOperandOrder: differs, ofWhichHaveExample: exampleToo, wordingOnlyEvidence: onlyWording });
console.log(samples.join('\n'));
