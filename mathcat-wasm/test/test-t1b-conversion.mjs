// T1b (plan section 5): the JS port of NVDA's text conversion reproduces NVDA's
// real Python function on hand-written SSML covering every branch, and on the
// SSML of every fixture.
import { readFileSync } from 'node:fs';
import { eq, done } from './lib.mjs';
import { toSpeechViewerRaw } from '../mathcat.js';

const cases = JSON.parse(readFileSync(new URL('./ssml-cases-golden.json', import.meta.url), 'utf8'));
for (const c of cases.rows) eq(`case ${c.name}`, toSpeechViewerRaw(c.ssml), c.viewerRaw);
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
for (const r of golden.rows) if (r.ssml !== null) eq(`fixture ${r.name}`, toSpeechViewerRaw(r.ssml), r.viewerRaw);
done('T1b conversion');
