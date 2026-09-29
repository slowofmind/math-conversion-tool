// T3 (plan section 5): the popup presenter is a faithful port of MathJax 4.1.3.
//  (1) placement: our stackRegions == MathJax's REAL stackRegions (imported
//      from @mathjax/src 4.1.3) for the same geometry;
//  (2) look: every box rule resolves to the same values as MathJax's
//      LiveRegion sheet, in light and dark schemes (class/var renames mapped);
//  (3) our sheet never styles MathJax output (no mjx-container selectors).
import { check, eq, done } from './lib.mjs';
import { makeAgentEnv } from './agent-env.mjs';
import { parseCss, effective } from './css-lite.mjs';
import { LiveRegion, AbstractRegion } from '@mathjax/src/mjs/a11y/explorer/Region.js';

const MJ = 'MJX_LiveRegion', US = 'ASTEM_MathCAT_Region';
function rect(o) { return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...o }); }

for (const sc of [
  { name: 'first region', anchor: { bottom: 120, left: 40 }, others: [], scroll: [5, 300] },
  { name: 'stacks under a shown region', anchor: { bottom: 120, left: 40 }, others: [{ bottom: 260, left: 30 }], scroll: [0, 50] },
  { name: 'two shown regions', anchor: { bottom: 10, left: 400 }, others: [{ bottom: 90, left: 70 }, { bottom: 150, left: 120 }], scroll: [7, 0] },
]) {
  const env = makeAgentEnv('<p><math><mi>x</mi></math></p>');
  const { w, doc, agent } = env;
  w.scrollX = sc.scroll[0]; w.scrollY = sc.scroll[1];
  const anchor = doc.querySelector('math'); anchor.getBoundingClientRect = rect(sc.anchor);
  for (const o of sc.others) { const d = doc.createElement('div'); d.className = `${US}_Show`; d.getBoundingClientRect = rect(o); doc.body.appendChild(d); }
  // ours
  const region = agent.createRegion(doc);
  region.AddElement(); region.position(anchor);
  const ours = [region.div.style.top, region.div.style.left];
  // MathJax's, run on the same DOM through a minimal `this`
  const mjDiv = doc.createElement('div');
  const fake = { document: { adaptor: { document: doc } }, CLASS: { className: US }, div: mjDiv };
  const saved = globalThis.window; globalThis.window = w;
  AbstractRegion.prototype.stackRegions.call(fake, anchor);
  globalThis.window = saved;
  eq(`placement ${sc.name}: top`, ours[0], mjDiv.style.top);
  eq(`placement ${sc.name}: left`, ours[1], mjDiv.style.left);
}

const env = makeAgentEnv('');
const mjRules = parseCss(LiveRegion.style.cssText);
const usRules = parseCss(env.agent.PRESETS['mathjax-4.1.3'].css);
const rename = (s) => s.replaceAll(MJ, US);
const mapVars = (o) => o;   // values are compared after full var resolution
for (const dark of [false, true]) {
  for (const sel of [`.${MJ}`, `.${MJ}_Show`, `.${MJ} > div`]) {
    const a = mapVars(effective(mjRules, sel, dark)), b = effective(usRules, rename(sel), dark);
    eq(`look ${dark ? 'dark' : 'light'} ${sel}`, JSON.stringify(b, Object.keys(a).sort()), JSON.stringify(a, Object.keys(a).sort()));
    eq(`look ${dark ? 'dark' : 'light'} ${sel}: no extra declarations`, Object.keys(b).length, Object.keys(a).length);
  }
}
check('no mjx-container selectors in our sheet', !usRules.some(r => /mjx-/.test(r.sel)));
check('all our vars are namespaced', !/--mjx-/.test(env.agent.PRESETS['mathjax-4.1.3'].css));
done('T3 presenter');
