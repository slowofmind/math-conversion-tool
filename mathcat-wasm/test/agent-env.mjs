// agent-env.mjs — loads js/mathcat-proof-agent.js into a jsdom window the way
// the platform does (as inline script text), with autostart off so tests can
// drive it. Outgoing messages to window.parent are captured in env.sent.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
export const AGENT_SRC = readFileSync(new URL('../../js/mathcat-proof-agent.js', import.meta.url), 'utf8');
export function makeAgentEnv(bodyHtml, { lang = 'en' } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="${lang}"><head></head><body>${bodyHtml}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  w.postMessage = (msg) => sent.push(msg);          // window.parent === window in jsdom
  w.__ASTEM_MC_NO_AUTOSTART = true;
  // N21 (PLAN-MATHCAT-NAVIGATION.md 9.1): test-n21-off.mjs re-runs T2/T3 with navigation off.
  if (process.env.ASTEM_MC_NAV_OFF === '1') w.__ASTEM_MC_NAV_SWITCHES = { navigation: false };
  w.eval(AGENT_SRC);
  const agent = w.__astemMathCATAgent;
  return { dom, w, doc: w.document, agent, sent,
    reply(data) { w.dispatchEvent(new w.MessageEvent('message', { data, source: w })); },
    replyFrom(source, data) { w.dispatchEvent(new w.MessageEvent('message', { data, source })); },
    region() { return w.document.querySelector('.ASTEM_MathCAT_Region'); } };
}
