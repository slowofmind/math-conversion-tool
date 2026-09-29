// gen-nav-ssml.mjs — navigation goldens, step 1 (PLAN-MATHCAT-NAVIGATION.md
// N-T1; its output also feeds N-T3 and N-T4). Drives the built MathCAT wasm
// DIRECTLY (not through mathcat.js) in NVDA release-2026.2's call order, read
// from source/mathPres/MathCAT/MathCAT.py in sitting 2:
//   arriving   getSpeechForMathMl L331-374: Language, SetMathML (on failure
//              SetMathML("<math></math>"), L353), CapitalLetters_*, GetSpokenText
//   entering   MathCATInteraction.reportFocus L96-105: DoNavigateCommand("ZoomIn");
//              no SetMathML (interactWithMathMl L414-421 only focuses).
//              NVDA's message on failure: "Error in starting navigation of math."
//   each key   _doNavigateCommand L125-138: DoNavigateCommand(name);
//              NVDA's message on failure: "Error in navigating math"
// So the reset to the whole expression comes from the SetMathML on arriving.
// After every step the node is read with getNavigationMathMLId() and
// getNavigationMathML(), as the engine will do.
// Two forms per fixture:
//   plain    NVDA's rebuild of the source + id tags (agent, plain-MathML pages)
//   mathjax  source tagged with data-astem-mc, drawn by real MathJax 4.1.3,
//            hidden MathML rebuilt NVDA-style, tags turned into ids (agent,
//            MathJax pages)
// Tagging is done here independently of the agent's code. The expected
// highlight is computed with an XML parser, independently of the engine's
// string scan (M15). No String.replace anywhere (split/join and slice only).
// Output: nav-ssml.json; nvda_nav_reference.py then adds NVDA's own text.
import init, * as mc from '../mathcat_wasm.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { renderMathJax } from './mathjax-render.mjs';

export const SEQUENCE = ['ZoomIn', 'MoveNext', 'MoveNext', 'ZoomIn', 'ZoomOut', 'ZoomOutAll',
  'MoveLastLocation', 'ReadCurrent', 'WhereAmI', 'DescribeCurrent'];

await init({ module_or_path: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
mc.init();
mc.setPreference('TTS', 'SSML');
// NVDA configSpec defaults, identical to gen-ssml.mjs (which cannot be imported: it runs on load)
for (const [k, v] of [
  ['Impairment', 'Blindness'], ['Language', 'en'], ['Verbosity', 'Medium'],
  ['MathRate', '100'], ['PauseFactor', '100'], ['SpeechSound', 'None'],
  ['SpeechStyle', 'ClearSpeak'], ['SubjectArea', 'General'], ['Chemistry', 'SpellOut'],
  ['NavMode', 'Enhanced'], ['ResetNavMode', 'false'], ['Overview', 'false'],
  ['ResetOverview', 'true'], ['NavVerbosity', 'Medium'], ['AutoZoomOut', 'true'],
  ['CopyAs', 'MathML'], ['BrailleNavHighlight', 'EndPoints'],
]) mc.setPreference(k, v);

const OPEN = /^\s*<math\b[^>]*>/;
// NVDA's rebuild (ia2Web.py Math._get_mathMl): inner markup, comments removed, new <math xml:lang>
function nvdaForm(mathml, lang = 'en') {
  const inner = mathml.slice(mathml.match(OPEN)[0].length, mathml.lastIndexOf('</math>'));
  return `<math xml:lang="${lang}">${inner.split(/<!--[\s\S]*?-->/).join('')}</math>`;
}
// Adds attr(n) to every start tag after the root <math ...>, numbering from 1 in
// document order. keepIfId: an element that already has an id keeps it (NF11)
// but still takes its number. Returns { mathml, tags: [{ n, name, id }] }.
function tagEvery(mathml, attr, keepIfId) {
  const open = mathml.match(OPEN)[0];
  const tags = [];
  const parts = mathml.slice(open.length).split(/(<[A-Za-z][^>]*>)/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].match(/^<([A-Za-z][\w:.-]*)/)[1];
    const idm = parts[i].match(/\sid\s*=\s*"([^"]*)"/);
    tags.push({ n: tags.length + 1, name, id: idm ? idm[1] : `astem-${tags.length + 1}` });
    if (keepIfId && idm) continue;
    parts[i] = `<${name} ${attr(tags.length)}` + parts[i].slice(name.length + 1);
  }
  return { mathml: open + parts.join(''), tags };
}

// plain form: what the agent sends from a plain-MathML page
function plainForm(src) { return tagEvery(nvdaForm(src), (n) => `id="astem-${n}"`, true); }
// mathjax form: tag the source, let real MathJax draw it, rebuild its hidden MathML
async function mathjaxForm(src) {
  const tagged = tagEvery(src, (n) => `data-astem-mc="${n}"`, false);
  // MathJax retry: fonts load asynchronously. A synchronous draw that needs
  // font data not yet loaded throws an error carrying e.retry, a promise to
  // await before drawing again (MathJax's handleRetriesFor pattern).
  let html;
  for (;;) {
    try { html = await renderMathJax(tagged.mathml, { assistive: true }); break; }
    catch (e) { if (!e.retry) throw e; await e.retry; }
  }
  const doc = new JSDOM(html).window.document;
  const hidden = doc.querySelector('mjx-assistive-mml > math');
  if (!hidden) return { error: 'no mjx-assistive-mml > math' };
  const visible = [...doc.querySelectorAll('[data-astem-mc]')].filter((e) => !e.closest('mjx-assistive-mml'));
  let hiddenTagged = 0;
  for (const e of hidden.querySelectorAll('[data-astem-mc]')) {
    hiddenTagged++;
    if (!e.hasAttribute('id')) e.setAttribute('id', `astem-${e.getAttribute('data-astem-mc')}`);
    e.removeAttribute('data-astem-mc');
  }
  return { mathml: `<math xml:lang="en">${hidden.innerHTML.split(/<!--[\s\S]*?-->/).join('')}</math>`,
    tags: tagged.tags, visibleTagged: new Set(visible.map((e) => e.getAttribute('data-astem-mc'))).size, hiddenTagged };
}
function arrive(mathml) {               // MathCAT.py getSpeechForMathMl
  try {
    mc.setPreference('Language', 'en');
    mc.setMathML(mathml);
  } catch (e) {
    mc.setMathML('<math></math>');
    return { ssml: null, error: String(e) };
  }
  mc.setPreference('CapitalLetters_Beep', 'false');   // OneCore defaults, as gen-ssml.mjs
  mc.setPreference('CapitalLetters_UseWord', 'false');
  mc.setPreference('CapitalLetters_Pitch', '30');
  return { ssml: mc.getSpokenText(), error: null };
}
const XML = new JSDOM('').window.DOMParser;
// ids present in the MathML that was sent: the only ones the agent can highlight
function sentIds(mathml) {
  const d = new XML().parseFromString(mathml, 'application/xml');
  return new Set([...d.getElementsByTagName('*')].map((e) => e.getAttribute('id')).filter(Boolean));
}
// expected highlight: the node's own id if it was sent; otherwise (a node
// MathCAT added) the top-most elements inside its subtree whose ids were sent
function expectHighlight(ids, navId, navMathml) {
  if (ids.has(navId)) return [navId];
  if (navMathml == null) return [];
  const d = new XML().parseFromString(navMathml, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) return { parseError: true };
  const out = [];
  (function walk(e) {
    if (ids.has(e.getAttribute('id'))) { out.push(e.getAttribute('id')); return; }
    for (const c of e.children) walk(c);
  })(d.documentElement);
  return out;
}
function step(command, role, ids) {
  const r = { command, role };          // role: 'entry' (reportFocus) or 'key'
  try { r.ssml = mc.doNavigateCommand(command); r.error = null; }
  catch (e) { r.ssml = null; r.error = String(e); }
  try { [r.navId, r.navOffset] = mc.getNavigationMathMLId(); } catch (e) { r.navIdError = String(e); }
  try { [r.navMathml] = mc.getNavigationMathML(); } catch (e) { r.navMathmlError = String(e); }
  r.highlight = expectHighlight(ids, r.navId, r.navMathml);
  return r;
}

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
// derived case (NF11, N-T3): an element that already carries an id
const q = fixtures.find((f) => f.name === 'quadratic').mathml, at = q.indexOf('<mi') + 3;
fixtures.push({ name: 'quadratic-existing-id', source: 'derived from quadratic',
  mathml: q.slice(0, at) + ' id="given-1"' + q.slice(at) });

const rows = [];
for (const f of fixtures) {
  for (const form of ['plain', 'mathjax']) {
    const built = form === 'plain' ? plainForm(f.mathml) : await mathjaxForm(f.mathml);
    const row = { name: f.name, form, ...built };
    if (!built.error) {
      const ids = sentIds(built.mathml);
      row.arrive = arrive(built.mathml);
      row.steps = SEQUENCE.map((c, i) => step(c, i === 0 ? 'entry' : 'key', ids));
    }
    rows.push(row);
  }
}
writeFileSync(new URL('./nav-ssml.json', import.meta.url), JSON.stringify({ sequence: SEQUENCE, rows }, null, 1) + '\n');
const steps = rows.flatMap((r) => r.steps || []);
const errs = {};
for (const s of steps.filter((s) => s.error)) errs[`${s.role}:${s.command}`] = (errs[`${s.role}:${s.command}`] || 0) + 1;
console.log('rows', rows.length, 'build errors', rows.filter((r) => r.error).length,
  'arrive errors', rows.filter((r) => r.arrive && r.arrive.error).length, 'steps', steps.length);
console.log('step errors by role:command', JSON.stringify(errs));
console.log('highlight parse errors', steps.filter((s) => s.highlight && s.highlight.parseError).length,
  'empty highlights', steps.filter((s) => Array.isArray(s.highlight) && !s.highlight.length).length);
const mj = rows.filter((r) => r.form === 'mathjax' && !r.error);
console.log('mathjax rows', mj.length, 'with all tags visible', mj.filter((r) => r.visibleTagged === r.tags.length).length,
  'with all tags in hidden MathML', mj.filter((r) => r.hiddenTagged === r.tags.length).length);
