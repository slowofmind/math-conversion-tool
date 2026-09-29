// N-T3 (PLAN-MATHCAT-NAVIGATION.md section 6; N7 with both refinements, N18):
//   plain pages   the page is never changed: no tags, no ids; the numbers live
//                 only in the copy sent to MathCAT, which carries exactly the
//                 golden generator's ids (gen-nav-ssml.mjs, an independent build);
//   MathJax pages the agent tags every element inside every <math> when it first
//                 runs; the tags reach MathJax's visible drawing and are removed
//                 from its hidden MathML (what NVDA reads) by the agent's step at
//                 priority 195, before the drawing is on the page; the same after
//                 a redraw; the page-level watcher does the same when the step
//                 cannot be added (MathJax already started, or the switch off);
//   both          an existing id is reused, never doubled (NF11); intent and
//                 arg are never changed (NF10).
// (N-T3a, speech unchanged by tags, is in test-nt1-nav-engine.mjs.)
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { check, eq, done } from './lib.mjs';
import { makeNavEnv, mathjaxPage, renderTagged, visibleTagged, hiddenTagged, pageRows, fixtureSource, MSG, KEYS } from './nav-env.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const golden = read('./nav-golden.json');
const fixtures = read('./fixtures.json');
const rows = pageRows(golden);
const idList = (mathml) => [...mathml.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
const noOurIds = (s) => s.split(/\sid="astem-\d+"/).join('');
const bodyOf = (html) => new JSDOM(`<!DOCTYPE html><html lang="en"><head></head><body>${html}</body></html>`).window.document.body.innerHTML;
const ours = (doc) => doc.querySelectorAll('[data-astem-mc], [id^="astem-"]').length;

// ---- plain-MathML pages ------------------------------------------------------
for (const row of rows.filter((r) => r.form === 'plain')) {
  const html = `<p id="p">${fixtureSource(fixtures, row.name)}</p><p id="o">other</p>`;
  const before = bodyOf(html);
  const env = makeNavEnv(html);
  const at = `plain ${row.name}`;
  eq(`${at}: page untouched when the agent runs`, env.doc.body.innerHTML, before);
  env.agent.start();
  const math = env.doc.querySelector('#p > math');
  const mathBefore = math.outerHTML;
  env.click(math.querySelector('*') || math);
  const req = env.last(MSG.speak);
  check(`${at}: speak request sent`, !!req);
  if (!req) continue;
  eq(`${at}: ids sent == golden ids, in order`, JSON.stringify(idList(req.mathml)), JSON.stringify(row.tags.map((t) => t.id)));
  eq(`${at}: copy sent == NVDA rebuild + our ids only`, noOurIds(req.mathml), env.agent.rebuildForNVDA(math));
  env.reply({ type: MSG.speech, id: req.id, ok: true, text: 'WHOLE', version: '0.7.2', nvda: '2026.2' });
  env.key(env.doc.body, KEYS.ZoomIn);
  const nav = env.last(MSG.nav);
  check(`${at}: navigation request sent`, !!nav);
  if (nav) {
    env.reply({ type: MSG.navspeech, id: nav.id, nav: nav.nav, ok: true, text: 'STEP',
      nodeTag: null, highlightTags: row.steps[0].highlight, version: '0.7.2', nvda: '2026.2' });
  }
  eq(`${at}: while navigating, math changed only by the highlight`,
    math.outerHTML.split(' data-astem-mc-hl=""').join(''), mathBefore);
  eq(`${at}: no tags or ids on the page`, ours(env.doc), 0);
  env.key(env.doc.body, { code: 'Escape', key: 'Escape' });            // back to the whole expression
  env.key(env.doc.body, { code: 'Escape', key: 'Escape' });            // closes the plain popup
  eq(`${at}: page byte-identical after focus, click, navigation`, env.doc.body.innerHTML, before);
}

// ---- MathJax pages: tagging when the agent first runs ------------------------
{
  const two = `<p>${fixtureSource(fixtures, 'quadratic')}</p><p>${fixtureSource(fixtures, 'pair-intent-root')}</p>`;
  const env = makeNavEnv(two, { mathjax: 'config' });
  const maths = [...env.doc.querySelectorAll('math')];
  const inner = maths.flatMap((m) => [...m.querySelectorAll('*')]);
  eq('MathJax page: every element inside <math> tagged', inner.filter((e) => e.hasAttribute('data-astem-mc')).length, inner.length);
  eq('MathJax page: the <math> roots are not tagged', maths.filter((m) => m.hasAttribute('data-astem-mc')).length, 0);
  const nums = inner.map((e) => e.getAttribute('data-astem-mc'));
  eq('MathJax page: numbers unique across the page', new Set(nums).size, nums.length);
  eq('MathJax page: numbered 1..n in document order', nums.join(','), inner.map((_, i) => String(i + 1)).join(','));
  const plainTwin = bodyOf(two);
  const stripped = env.doc.body.innerHTML.split(/\sdata-astem-mc="\d+"/).join('');
  eq('MathJax page: only our attribute added (intent, arg, ids untouched; NF10)', stripped, plainTwin);
  const ra = env.w.MathJax.options.renderActions;
  check('render action added (N18)', Array.isArray(ra.astemMathCAT));
  eq('render action priority 195 (after the arrow fix at 190, before insertion at 200)', ra.astemMathCAT && ra.astemMathCAT[0], 195);
  check('render action has document and item functions', !!ra.astemMathCAT && typeof ra.astemMathCAT[1] === 'function' && typeof ra.astemMathCAT[2] === 'function');
  check('existing render action kept', ra.astemIntentArrows === env.arrows190);
}
// ---- MathJax pages: the drawn result, every fixture ---------------------------
for (const row of rows.filter((r) => r.form === 'mathjax')) {
  const src = fixtureSource(fixtures, row.name), at = `mathjax ${row.name}`;
  const { env, container } = await mathjaxPage(src);
  eq(`${at}: tags reach the visible drawing`, new Set(visibleTagged(container).map((e) => e.getAttribute('data-astem-mc'))).size, row.tags.length);
  eq(`${at}: none left in the hidden MathML`, hiddenTagged(container).length, 0);
  env.agent.start();
  env.focus(container);
  const req = env.last(MSG.speak);
  eq(`${at}: copy sent == golden (independently built)`, req && req.mathml, row.mathml);
}

// ---- redraw (MathJax replaces the container, e.g. the mode toggle; N18) ------
{
  const row = rows.find((r) => r.name === 'quadratic' && r.form === 'mathjax');
  const env = makeNavEnv(`<p id="p">${fixtureSource(fixtures, 'quadratic')}</p>`, { mathjax: 'config' });
  const taggedSource = env.doc.querySelector('#p > math').cloneNode(true);   // MathJax keeps its own copy
  const first = await env.draw(env.doc.querySelector('#p > math'));
  first.replaceWith(taggedSource);                                          // redraw from the same tree
  const second = await env.draw(taggedSource);
  eq('redraw: visible drawing still tagged', visibleTagged(second).length > 0, true);
  eq('redraw: hidden MathML clean again', hiddenTagged(second).length, 0);
  env.agent.start(); env.focus(second);
  eq('redraw: copy sent unchanged', (env.last(MSG.speak) || {}).mathml, row.mathml);
}
// ---- fallback: the page-level watcher (N18 "a") ------------------------------
for (const [label, opts] of [['MathJax already started', { mathjax: 'started' }],
  ['renderActionHook switched off', { mathjax: 'config', switches: { renderActionHook: false } }]]) {
  const row = rows.find((r) => r.name === 'quadratic' && r.form === 'mathjax');
  const env = makeNavEnv(`<p id="p">${fixtureSource(fixtures, 'quadratic')}</p>`, opts);
  const ra = env.w.MathJax.options.renderActions;
  check(`${label}: no render action added`, !(ra && ra.astemMathCAT));
  check(`${label}: source still tagged`, !!env.doc.querySelector('#p > math [data-astem-mc]'));
  const c = await env.draw(env.doc.querySelector('#p > math'));
  await env.tick();                                                         // MutationObserver delivery
  eq(`${label}: hidden MathML cleaned after insertion`, hiddenTagged(c).length, 0);
  check(`${label}: visible drawing keeps its tags`, visibleTagged(c).length > 0);
  env.agent.start(); env.focus(c);
  eq(`${label}: copy sent == golden`, (env.last(MSG.speak) || {}).mathml, row.mathml);
}
// ---- existing ids are reused, never doubled (NF11) ---------------------------
for (const form of ['plain', 'mathjax']) {
  const row = rows.find((r) => r.name === 'quadratic-existing-id' && r.form === form);
  eq(`existing id (${form}): golden keeps given-1`, row.tags[0].id, 'given-1');
}
{
  const { env, container } = await mathjaxPage(fixtureSource(fixtures, 'quadratic-existing-id'));
  env.agent.start(); env.focus(container);
  const m = (env.last(MSG.speak) || {}).mathml || '';
  // N23 (NF12): MathJax keeps an existing id on its visible drawing only, so the
  // part is numbered like any other in the copy sent, and the highlight still finds it.
  const given = container.querySelector('[id="given-1"]');
  check('existing id (mathjax): MathJax keeps it on the visible drawing only', !!given
    && !given.closest('mjx-assistive-mml') && !container.querySelector('mjx-assistive-mml [id="given-1"]'));
  eq('existing id (mathjax): not in the copy sent (NVDA never reads it)', m.split('id="given-1"').length - 1, 0);
  eq('existing id (mathjax): the part is numbered like any other', idList(m)[0], 'astem-1');
  env.key(container, KEYS.ZoomIn);
  const nv = env.last(MSG.nav);
  if (nv) env.reply({ type: MSG.navspeech, id: nv.id, nav: nv.nav, ok: true, text: 'x', nodeTag: 'astem-1',
    highlightTags: ['astem-1'], version: '0.7.2', nvda: '2026.2' });
  check('existing id (mathjax): the highlight lands on the part that carries it',
    env.hl().length === 1 && env.hl()[0] === given, `${env.hl().length} highlighted`);
  check('existing id (mathjax): no element with two ids', !/<[^>]*\sid="[^"]*"[^>]*\sid="/.test(m), m.slice(0, 200));
}
// ---- no MathJax: nothing touched, nothing created ----------------------------
{
  const env = makeNavEnv(`<p>${fixtureSource(fixtures, 'quadratic')}</p>`);
  eq('plain page: no window.MathJax created', env.w.MathJax, undefined);
  eq('plain page: no tags', ours(env.doc), 0);
}
done('N-T3 tagging');
