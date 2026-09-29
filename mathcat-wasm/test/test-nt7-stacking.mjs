// N-T7 (PLAN-MATHCAT-NAVIGATION.md section 6; N10): stacking also counts
// MathJax's shown boxes (MJX_LiveRegion_Show), so a MathCAT box never covers a
// MathJax subtitle or braille box. With no MathJax box showing, placement is
// exactly MathJax's own stackRegions (T3 unchanged). With navigation off, the
// first plan's exact port is used (N21).
import { eq, done } from './lib.mjs';
import { makeNavEnv } from './nav-env.mjs';
import { AbstractRegion } from '@mathjax/src/mjs/a11y/explorer/Region.js';

const US = 'ASTEM_MathCAT_Region', MJ = 'MJX_LiveRegion';
const rect = (o) => () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...o });
function place({ anchor, boxes, scroll = [0, 0], switches = null }) {
  const env = makeNavEnv('<p><math><mi>x</mi></math></p>', { switches });
  const { w, doc, agent } = env;
  w.scrollX = scroll[0]; w.scrollY = scroll[1];
  const a = doc.querySelector('math'); a.getBoundingClientRect = rect(anchor);
  for (const b of boxes) {
    const d = doc.createElement('div'); d.className = b.cls; d.getBoundingClientRect = rect(b); doc.body.appendChild(d);
  }
  const region = agent.createRegion(doc);
  region.AddElement(); region.position(a);
  // MathJax's own function on the same DOM, as T3 does (counts only our class)
  const mjDiv = doc.createElement('div');
  const saved = globalThis.window; globalThis.window = w;
  AbstractRegion.prototype.stackRegions.call({ document: { adaptor: { document: doc } }, CLASS: { className: US }, div: mjDiv }, a);
  globalThis.window = saved;
  return { ours: [region.div.style.top, region.div.style.left], mathjax: [mjDiv.style.top, mjDiv.style.left] };
}
const anchor = { bottom: 120, left: 40 };
let r = place({ anchor, boxes: [{ cls: `${MJ}_Show`, bottom: 260, left: 30 }], scroll: [5, 50] });
eq('MathJax box showing: ours sits below it', r.ours.join(' '), '310px 35px');
r = place({ anchor, boxes: [{ cls: `${US}_Show`, bottom: 200, left: 60 }, { cls: `${MJ}_Show`, bottom: 260, left: 30 }] });
eq('ours and MathJax boxes showing: below the lowest, left of the leftmost', r.ours.join(' '), '260px 30px');
r = place({ anchor, boxes: [{ cls: MJ, bottom: 260, left: 30 }] });
eq('MathJax box present but hidden: ignored', r.ours.join(' '), '130px 40px');
r = place({ anchor, boxes: [], scroll: [7, 3] });
eq("no MathJax box: identical to MathJax's stackRegions", r.ours.join(' '), r.mathjax.join(' '));
r = place({ anchor, boxes: [{ cls: `${US}_Show`, bottom: 90, left: 70 }] });
eq("only our boxes: identical to MathJax's stackRegions", r.ours.join(' '), r.mathjax.join(' '));
r = place({ anchor, boxes: [{ cls: `${MJ}_Show`, bottom: 260, left: 30 }], switches: { navigation: false } });
eq('navigation off: the first plan exact port (MathJax box not counted)', r.ours.join(' '), r.mathjax.join(' '));
done('N-T7 stacking');
