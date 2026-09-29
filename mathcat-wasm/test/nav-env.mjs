// nav-env.mjs — test helper for the navigation tests (PLAN-MATHCAT-NAVIGATION.md
// section 6, Phase B). Like agent-env.mjs (left unchanged), plus options that must
// be in place BEFORE the agent script runs, because the agent tags MathJax pages
// and adds its MathJax step when it first runs (9.3 notes):
//   mathjax: null       no window.MathJax: a plain-MathML page
//            'config'   window.MathJax is a config object, library not loaded yet
//                       (the intent filter's case: startup.ready defined, no
//                       startup.promise; an existing render action at 190)
//            'started'  window.MathJax.startup.promise exists (library started)
//   switches            copied to window.__ASTEM_MC_NAV_SWITCHES (N21)
import { JSDOM } from 'jsdom';
import { AGENT_SRC } from './agent-env.mjs';
import { renderMathJax } from './mathjax-render.mjs';

export const MSG = { speak: 'mathcat-proof:speak', speech: 'mathcat-proof:speech',
  nav: 'mathcat-proof:nav', navspeech: 'mathcat-proof:navspeech', goto: 'mathcat-proof:goto' };
// the keys that produce the N-T1 sequence's commands (Appendix A)
export const KEYS = {
  ZoomIn: { code: 'ArrowDown', key: 'ArrowDown' },
  MoveNext: { code: 'ArrowRight', key: 'ArrowRight' },
  ZoomOut: { code: 'ArrowUp', key: 'ArrowUp' },
  ZoomOutAll: { code: 'ArrowUp', key: 'ArrowUp', ctrlKey: true, shiftKey: true },
  MoveLastLocation: { code: 'Backspace', key: 'Backspace' },
  ReadCurrent: { code: 'Space', key: ' ' },
  WhereAmI: { code: 'Enter', key: 'Enter' },
  DescribeCurrent: { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true },
};

export function makeNavEnv(bodyHtml, { lang = 'en', mathjax = null, switches = null } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="${lang}"><head></head><body>${bodyHtml}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  w.postMessage = (msg) => sent.push(msg);          // window.parent === window in jsdom
  w.__ASTEM_MC_NO_AUTOSTART = true;
  if (switches) w.__ASTEM_MC_NAV_SWITCHES = switches;
  const arrows190 = [190, () => {}, () => {}];
  if (mathjax === 'config') w.MathJax = { startup: { ready() {} }, options: { renderActions: { astemIntentArrows: arrows190 } } };
  if (mathjax === 'started') w.MathJax = { startup: { promise: Promise.resolve() }, options: {} };
  w.eval(AGENT_SRC);
  const doc = w.document;
  const env = { dom, w, doc, sent, agent: w.__astemMathCATAgent, arrows190,
    region: () => doc.querySelector('.ASTEM_MathCAT_Region'),
    text: () => { const r = doc.querySelector('.ASTEM_MathCAT_Region > div'); return r ? r.textContent : null; },
    hl: () => [...doc.querySelectorAll('[data-astem-mc-hl]')],
    of: (type) => sent.filter((m) => m && m.type === type),
    last: (type) => env.of(type).slice(-1)[0],
    reply: (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w })),
    replyFrom: (source, data) => w.dispatchEvent(new w.MessageEvent('message', { data, source })),
    key(target, init) {
      const e = new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    },
    focus: (el) => el.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true })),
    blur: (el) => el.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })),
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    tick: () => new Promise((r) => setTimeout(r, 0)),
    // Draw one source <math> as the browser would: real MathJax 4.1.3 draws the
    // (already tagged) source; the agent's render action, if registered, runs on
    // the container before it is on the page (priority 195); then the container
    // replaces the source. Returns the container.
    async draw(math, { runRenderAction = true } = {}) {
      const tmp = doc.createElement('div');
      tmp.innerHTML = await renderTagged(math.outerHTML);
      const c = tmp.firstElementChild;
      const ra = w.MathJax && w.MathJax.options && w.MathJax.options.renderActions
        && w.MathJax.options.renderActions.astemMathCAT;
      if (runRenderAction && Array.isArray(ra) && typeof ra[2] === 'function') ra[2]({ typesetRoot: c }, {});
      math.replaceWith(c);
      return c;
    },
  };
  return env;
}

// MathJax loads fonts asynchronously: a draw that needs font data not yet
// loaded throws an error carrying e.retry (as in gen-nav-ssml.mjs).
export async function renderTagged(mathml) {
  for (;;) {
    try { return await renderMathJax(mathml, { assistive: true }); }
    catch (e) { if (!e.retry) throw e; await e.retry; }
  }
}
// One expression on a MathJax page (intent filter's case), drawn by env.draw.
export async function mathjaxPage(src, opts = {}) {
  const env = makeNavEnv(`<p id="p">${src}</p><button id="b">x</button>`, { mathjax: 'config', ...opts });
  const container = await env.draw(env.doc.querySelector('#p > math'));
  return { env, container };
}
export const visibleTagged = (c) => [...c.querySelectorAll('[data-astem-mc]')].filter((e) => !e.closest('mjx-assistive-mml'));
export const hiddenTagged = (c) => [...c.querySelectorAll('mjx-assistive-mml [data-astem-mc]')];
// The golden rows (nav-golden.json) and the fixtures the page tests use.
// 'malformed' is left out of page tests: jsdom, like browsers, repairs broken
// MathML before the agent can read it (first plan M22). N-T1 covers it.
export function pageRows(golden) { return golden.rows.filter((r) => r.steps && r.name !== 'malformed'); }
export function fixtureSource(fixtures, name) {
  if (name === 'quadratic-existing-id') {
    const q = fixtures.find((f) => f.name === 'quadratic').mathml, at = q.indexOf('<mi') + 3;
    return q.slice(0, at) + ' id="given-1"' + q.slice(at);          // as gen-nav-ssml.mjs
  }
  return fixtures.find((f) => f.name === name).mathml;
}
// What the popup must show for a golden step (N6 / N22).
export const wantText = (s, collapse) => (s.error ? s.nvdaMessage : collapse(s.viewerRaw));
export const wantHighlight = (s) => (Array.isArray(s.highlight) ? s.highlight : []);
