// snippets/probes/patch-shapes-unread-20261108.mjs -- a kernel form vouches for a reading only when the reading
// leaves no MORE kinds of pieces unread than the form's own notation does.
// [CLAUDE 2026-11-08, late] Found when the transpose form \MathMLarg{matrix}{A}^{T} arrived (Reference,
// tools/apply-core-22-20261108.mjs): its notation leaves the superscript T unread (lossy), and that boolean
// "lossy" let it vouch for the base-only reading of A_n^T, which leaves the subscript n unread too. So the form
// overrode the rule of a56ddc8 [NICHOLAS 2026-11-08] (a postfix mark applies to base+subscript; typed before
// the subscript, the tool asks). Fix: readings of the `scripted` shape record which pieces they leave unread
// (`unread`: 'sub', 'sup'); evidence keeps the form's list; the check asks that the form also left each of the
// reading's unread pieces unread. Other shapes have no list (null) and behave exactly as before.
// Exactly-once anchors; .bak-20261108-unread backup; refuses a second run.
// Usage: node probes/patch-shapes-unread-20261108.mjs [--dry-run]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shapes.js');
const BAK = FILE + '.bak-20261108-unread';
const dry = process.argv.includes('--dry-run');
const EDITS = [
  ["const reading = (shape, variant, ops, { lossy = false, needs = null, fixityOk = null } = {}) =>\n  ({ shape, variant, ops, lossy, needs, fixityOk });",
   "// [CLAUDE 2026-11-08, late] unread: which pieces a lossy reading leaves unread ('sub', 'sup'), where a shape\n// knows; null elsewhere. Used so a kernel form only vouches for readings that leave no more unread than it does.\nconst reading = (shape, variant, ops, { lossy = false, needs = null, fixityOk = null, unread = null } = {}) =>\n  ({ shape, variant, ops, lossy, needs, fixityOk, unread });"],
  ["const out = [reading('scripted', 'base', [baseR], { lossy: subC || supC, fixityOk: subAndMark ? [] : ['postfix'] })];",
   "const out = [reading('scripted', 'base', [baseR], { lossy: subC || supC, fixityOk: subAndMark ? [] : ['postfix'], unread: [subC && 'sub', supC && 'sup'].filter(Boolean) })];"],
  ["out.push(reading('scripted', 'base+sub', [{ start: b.start, end: subEnd }], { lossy: supC, fixityOk: ['postfix'] }));",
   "out.push(reading('scripted', 'base+sub', [{ start: b.start, end: subEnd }], { lossy: supC, fixityOk: ['postfix'], unread: supC ? ['sup'] : [] }));"],
  ["if (ok) { if (map.get(key)?.status !== 'confirmed') map.set(key, { status: 'confirmed', perm, form, lossy: !!r.lossy }); }",
   "if (ok) { if (map.get(key)?.status !== 'confirmed') map.set(key, { status: 'confirmed', perm, form, lossy: !!r.lossy, unread: r.unread ?? null }); }"],
  ["if (e?.status === 'confirmed' && (!r.lossy || e.lossy)) { kept.push({ ...r, rank: 0, perm: e.perm }); continue; }",
   "// [CLAUDE 2026-11-08, late] a lossy form vouches only if it also left each piece this reading leaves unread\n    // (A^{T} leaves the superscript: no evidence for the base alone in A_n^T, which also leaves the subscript)\n    const covers = !r.unread || !e?.unread || r.unread.every(p => e.unread.includes(p));\n    if (e?.status === 'confirmed' && (!r.lossy || (e.lossy && covers))) { kept.push({ ...r, rank: 0, perm: e.perm }); continue; }"],
];
let t = readFileSync(FILE, 'utf8');
if (t.includes('unread = null')) { console.log('REFUSED  already patched'); process.exit(1); }
const problems = [];
for (const [a, b] of EDITS) { const n = t.split(a).length - 1; if (n !== 1) { problems.push(`anchor found ${n} times: ${a.slice(0, 70)}`); continue; } t = t.split(a).join(b); }
if (problems.length) { problems.forEach(p => console.log('REFUSED  ' + p)); console.log('nothing changed'); process.exit(1); }
console.log(`shapes.js: ${EDITS.length} edits ready`);
if (dry) { console.log('dry run: nothing written'); process.exit(0); }
if (existsSync(BAK)) { console.log('REFUSED  backup exists'); process.exit(1); }
copyFileSync(FILE, BAK);
writeFileSync(FILE, t, 'utf8');
console.log('patched ' + FILE + ' (backup ' + BAK + ')');
