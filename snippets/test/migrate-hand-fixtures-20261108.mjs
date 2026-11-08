// test/migrate-hand-fixtures-20261108.mjs -- one-off: hand fixtures' expected texts for the slim copy.
// [CLAUDE 2026-11-08] The snippet core now writes fixity and takes operand names from the kernel form
// [NICHOLAS 2026-11-08]. This rewrites, in each hand fixture's expected text, ONLY the new label's
// intent value and its own operand names, by position (old i-th name -> the form's i-th name, any
// "-2" clash suffix kept). The rest of every expected text is left exactly as written. It does NOT run
// the core: where the new core then writes something else (order, braces, a clash), the test fails
// and the case is looked at by hand. Backs up the fixture file first; refuses a second run.
// Usage: node test/migrate-hand-fixtures-20261108.mjs [--dry-run]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIXTURES, EXPORT } from './lib/fixtures.mjs';
import { loadConceptIndex, formsOf } from '../src/concepts.js';

const FILE = join(FIXTURES, 'hand-calculus-analysis.mjs');
const BAK = FILE + '.bak-20261108-slim';
const dry = process.argv.includes('--dry-run');
const text0 = readFileSync(FILE, 'utf8');
if (/MathMLintent\{[a-z0-9.-]+:[a-z]+[($}]/i.test(text0)) { console.log('REFUSED  expected texts already carry fixity (second run?)'); process.exit(1); }
const { fixtures } = await import(pathToFileURL(FILE).href);
const index = loadConceptIndex(JSON.parse(readFileSync(EXPORT, 'utf8')));
const argsOf = v => { const o = v.indexOf('('); return o < 0 ? [] : v.slice(o + 1, v.lastIndexOf(')')).split(',').map(s => s.trim().replace(/^\$/, '')); };

let text = text0;
const changed = [], unmapped = [];
const done = new Map();
for (const fx of fixtures) {
  const old = fx.expect?.text;
  if (!old || done.has(old)) continue;
  const m = /\\MathMLintent\{([^{}]*)\}/.exec(old);
  if (!m) { unmapped.push(`${fx.id}: no \\MathMLintent in the expected text`); continue; }
  const oldValue = m[1], oldNames = argsOf(oldValue);
  const rec = index.get(fx.concept);
  if (!rec) { unmapped.push(`${fx.id}: concept ${fx.concept} not in the slim copy`); continue; }
  const form = formsOf(rec).find(f => f.arity === oldNames.length);
  const head = form ? form.head : (rec.fixity ? `${rec.concept}:${rec.fixity}` : rec.concept);
  const newNames = oldNames.map((n, i) => {
    if (!form) return n;
    const suffix = /-\d+$/.exec(n)?.[0] ?? '';
    return form.operands[i] + suffix;
  });
  const newValue = newNames.length ? `${head}(${newNames.map(n => '$' + n).join(',')})` : head;
  let t = old.replace(`\\MathMLintent{${oldValue}}`, `\\MathMLintent{${newValue}}`);
  oldNames.forEach((n, i) => { t = t.split(`\\MathMLarg{${n}}{`).join(`\\MathMLarg{\u0000${i}}{`); });
  newNames.forEach((n, i) => { t = t.split(`\\MathMLarg{\u0000${i}}{`).join(`\\MathMLarg{${n}}{`); });
  done.set(old, t);
  if (t === old) continue;
  const lit = 'R`' + old + '`';
  const count = text.split(lit).length - 1;
  if (!count) { unmapped.push(`${fx.id}: expected text not found as a R\`...\` literal in the file`); continue; }
  text = text.split(lit).join('R`' + t + '`');
  changed.push({ id: fx.id, from: form ? form.from : 'no fixed arity', old: oldValue, now: newValue, names: oldNames.join(',') === newNames.join(',') ? 'same' : `${oldNames.join(',')} -> ${newNames.join(',')}` });
}
for (const c of changed) console.log(`${c.id.padEnd(40)} ${c.old}  ->  ${c.now}  [${c.from}${c.names === 'same' ? '' : '; names ' + c.names}]`);
for (const u of unmapped) console.log('NOT CHANGED  ' + u);
console.log(`\nchanged ${changed.length} expected text(s); not changed ${unmapped.length}`);
if (dry) { console.log('dry run: nothing written'); process.exit(0); }
if (existsSync(BAK)) { console.log('REFUSED  backup exists'); process.exit(1); }
copyFileSync(FILE, BAK);
writeFileSync(FILE, text.replace('// test/fixtures/hand-calculus-analysis.mjs', '// test/fixtures/hand-calculus-analysis.mjs') +
  '', 'utf8');
console.log('wrote ' + FILE + ' (backup ' + BAK + ')');
