// N-T4 (PLAN-MATHCAT-NAVIGATION.md section 6): on plain and MathJax pages, each
// step of the N-T1 sequence highlights exactly the expected visible elements,
// including the rows MathCAT adds (3.7) and the whole expression (N20); the
// popup shows NVDA's text for every step. Real engine and real agent; the
// parent is replaced by a direct relay here (N-T6 tests the parent).
// Also NV5: the highlight rule copies MathJax 4.1.3's own, read from its
// sheet at test time.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done, collapse } from './lib.mjs';
import { makeNavEnv, mathjaxPage, visibleTagged, pageRows, fixtureSource, wantText, wantHighlight, MSG, KEYS } from './nav-env.mjs';
import { createMathCATEngine } from '../mathcat.js';
import { LiveRegion } from '@mathjax/src/mjs/a11y/explorer/Region.js';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const golden = read('./nav-golden.json');
const fixtures = read('./fixtures.json');
const engine = await createMathCATEngine({ bytes: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
check('engine has navigate()', typeof engine.navigate === 'function');
if (typeof engine.navigate !== 'function') done('N-T4 highlight');

// answers every request the agent has sent, in order, as the parent would
function relay(env) {
  let seen = 0;
  return async () => {
    while (seen < env.sent.length) {
      const m = env.sent[seen++];
      const meta = { version: engine.version, nvda: engine.nvda };
      if (m && m.type === MSG.speak) {
        const r = await engine.speak(m.mathml);
        env.reply({ type: MSG.speech, id: m.id, ok: r.ok, text: r.text, error: r.error, ...meta });
      } else if (m && m.type === MSG.nav) {
        const r = await engine.navigate(m.mathml, m.command, { fresh: !!m.fresh, entering: !!m.entering });
        env.reply({ type: MSG.navspeech, id: m.id, nav: m.nav, ok: r.ok, text: r.text,
          nodeTag: r.nodeTag, highlightTags: r.highlightTags, ...meta });
      }
    }
  };
}
const same = (a, b) => a.length === b.length && a.every((e) => b.includes(e));
// N24 (NF13): the one other order MathCAT 0.7.2 may give for WhereAmI in a
// 2 x 2 matrix, the two "column" parts swapped. Anything else stays a failure.
const swapColumns = (t) => {
  const m = /^(row \d+) (column \d+ \S+) (column \d+ \S+) (.*)$/.exec(t);
  return m ? `${m[1]} ${m[3]} ${m[2]} ${m[4]}` : t;
};

// ---- every page row, every step ------------------------------------------------
let addedRows = 0;
for (const row of pageRows(golden)) {
  const src = fixtureSource(fixtures, row.name), at = `${row.form} ${row.name}`;
  let env, target, elementsFor;
  if (row.form === 'plain') {
    env = makeNavEnv(`<p id="p">${src}</p>`);
    env.agent.start();
    const math = env.doc.querySelector('#p > math');
    const live = [...math.querySelectorAll('*')];            // document order, as numbered
    elementsFor = (id) => {
      const m = /^astem-(\d+)$/.exec(id);
      return m ? [live[Number(m[1]) - 1]] : [...math.querySelectorAll(`[id="${id}"]`)];
    };
    env.click(math);
    target = env.doc.body;
  } else {
    let container;
    ({ env, container } = await mathjaxPage(src));
    env.agent.start();
    elementsFor = (id) => {
      const m = /^astem-(\d+)$/.exec(id);
      const n = m ? Number(m[1]) : (row.tags.find((t) => t.id === id) || {}).n;
      return visibleTagged(container).filter((e) => e.getAttribute('data-astem-mc') === String(n));
    };
    env.focus(container);
    target = container;
  }
  const pump = relay(env);
  await pump();
  eq(`${at}: whole-expression text`, env.text(), row.arrive.error ? env.text() : collapse(row.arrive.viewerRaw));
  eq(`${at}: no highlight before navigating (N20)`, env.hl().length, 0);
  const ids = new Set([...row.mathml.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
  for (let i = 0; i < row.steps.length; i++) {
    const s = row.steps[i], label = `${at} #${i} ${s.command}`;
    const ev = env.key(target, KEYS[s.command]);
    check(`${label}: key handled`, ev.defaultPrevented);
    await pump();
    const wantText_ = wantText(s, collapse);
    const either = row.name === 'matrix-2x2' && s.command === 'WhereAmI' ? [wantText_, swapColumns(wantText_)] : [wantText_];
    if (either.length > 1) check(`${label}: the other order differs (N24)`, either[1] !== either[0], either[0]);
    check(`${label}: text`, either.includes(env.text()),
      `got ${JSON.stringify(env.text())}, want ${either.map((t) => JSON.stringify(t)).join(' or ')}`);
    const want = wantHighlight(s).flatMap(elementsFor);
    check(`${label}: highlight`, same(env.hl(), want),
      `got ${env.hl().length} element(s), want ${want.length} for ${JSON.stringify(wantHighlight(s))}`);
    if (!ids.has(s.navId) && wantHighlight(s).length > 1) addedRows++;
  }
  env.key(target, { code: 'Escape', key: 'Escape' });
  eq(`${at}: Escape clears the highlight`, env.hl().length, 0);
}
check('MathCAT-added rows were exercised', addedRows > 0, String(addedRows));

// ---- NV5: the highlight look is MathJax 4.1.3's priority-1 highlight ----------
// MathJax's rules are read from its own sheet at test time. Only the CHTML rules
// count (the SVG "rect" rules have no counterpart on our pages). Variables are
// compared by name after the rename (--mjx- -> --astem-mc-); T3 proves those
// variables resolve to MathJax's values in light and dark schemes.
function declsFor(css, test) {
  const out = {};
  for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (!test(m[1].trim())) continue;
    for (const d of m[2].split(';')) {
      const k = d.split(':')[0].trim();
      if (k) out[k] = d.slice(d.indexOf(':') + 1).split(' ').join('');
    }
  }
  return out;
}
const mj = declsFor(LiveRegion.style.cssText, (sel) => sel.includes('[data-sre-highlight-1]') && !/rect\[/.test(sel));
const env = makeNavEnv('');
const us = declsFor(env.agent.PRESETS['mathjax-4.1.3'].css, (sel) => sel.includes('[data-astem-mc-hl]'));
eq("MathJax's highlight declarations found", Object.keys(mj).sort().join(','), 'background-color,color,fill');
const renamed = {};
for (const [k, v] of Object.entries(mj)) renamed[k] = v.split('--mjx-').join('--astem-mc-');
eq('our highlight == MathJax priority-1 highlight', JSON.stringify(us, Object.keys(renamed).sort()), JSON.stringify(renamed, Object.keys(renamed).sort()));
eq('no extra highlight declarations', Object.keys(us).length, Object.keys(renamed).length);
done('N-T4 highlight');
