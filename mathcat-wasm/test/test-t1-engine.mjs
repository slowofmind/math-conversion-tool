// T1 (plan section 5): engine text == NVDA reference for every fixture.
// Golden = MathCAT SSML (gen-ssml.mjs, NVDA call order) passed through NVDA's
// own convertSSMLTextForNVDA + speech-viewer join (nvda_reference.py).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done, collapse } from './lib.mjs';
import { createMathCATEngine } from '../mathcat.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const bytes = gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url)));
const engine = await createMathCATEngine({ bytes });
eq('version', engine.version, '0.7.2');
for (const row of golden.rows) {
  const r = await engine.speak(row.mathml);
  if (row.error) {
    eq(`${row.name}: ok=false`, r.ok, false);
    check(`${row.name}: error text`, typeof r.error === 'string' && r.error.includes('Invalid MathML'), r.error);
  } else {
    eq(`${row.name}: viewerRaw`, r.viewerRaw, row.viewerRaw);
    eq(`${row.name}: text (M14 collapsed)`, r.text, collapse(row.viewerRaw));
  }
}
// the NVDA-rebuilt form of every fixture (what the agent actually sends)
for (const row of golden.rows) {
  const r = await engine.speak(row.nvdaMathml);
  if (row.nvdaError) eq(`${row.name} (nvda form): ok=false`, r.ok, false);
  else eq(`${row.name} (nvda form): text`, r.text, collapse(row.nvdaViewerRaw));
}
const rootRow = golden.rows.find(r => r.name === 'pair-intent-root');
check('root intent honoured when sent directly', collapse(rootRow.viewerRaw).startsWith('the interval'), rootRow.viewerRaw);
check('root intent lost in NVDA form (F3)', collapse(rootRow.nvdaViewerRaw).startsWith('open paren'), rootRow.nvdaViewerRaw);
// cache must not change answers, and a repeat must be identical
const again = await engine.speak(golden.rows[0].mathml);
eq('repeat identical', again.text, collapse(golden.rows[0].viewerRaw));
done('T1 engine');
