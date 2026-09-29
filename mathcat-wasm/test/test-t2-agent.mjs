// T2 (plan section 5): the agent finds the right MathML, rebuilds it the way
// NVDA does, and drives the popup (MathJax focus path M12, plain click path M13).
import { check, eq, done } from './lib.mjs';
import { makeAgentEnv } from './agent-env.mjs';
import { renderMathJax } from './mathjax-render.mjs';

const SRC = '<math display="block" intent="root-intent($a)"><!-- note --><mrow intent="open-interval($a,$b)"><mo>(</mo><mi arg="a">a</mi><mo>,</mo><mi arg="b">b</mi><mo>)</mo></mrow></math>';
const mjOn = await renderMathJax(SRC, { assistive: true });   // MathCat Compatible
const mjOff = await renderMathJax(SRC, { assistive: false }); // MathJax speech mode

// ---- harvesting ----------------------------------------------------------
{
  const env = makeAgentEnv(`<p id="p1">${mjOn}</p><p id="p2">${mjOff}</p><p lang="en-GB" id="p3">${SRC}</p>`);
  const [cOn, cOff] = env.doc.querySelectorAll('mjx-container');
  const plain = env.doc.querySelector('#p3 > math');
  const sOn = env.agent.findSource(cOn.querySelector('mjx-c') || cOn);
  eq('mathjax source kind', sOn && sOn.kind, 'mathjax');
  check('mathjax anchor is container', sOn && sOn.anchor === cOn);
  check('mathjax math is hidden MathML', sOn && sOn.math.parentElement.localName === 'mjx-assistive-mml');
  eq('speech-mode container -> no source', env.agent.findSource(cOff), null);
  const sPlain = env.agent.findSource(plain.querySelector('mi'));
  eq('plain source kind', sPlain && sPlain.kind, 'plain');
  check('plain anchor is <math>', sPlain && sPlain.anchor === plain);
  eq('text outside math -> no source', env.agent.findSource(env.doc.getElementById('p1')), null);

  const rebuilt = env.agent.rebuildForNVDA(sPlain.math);
  check('root attributes dropped', !/^<math[^>]*(intent|display)=/.test(rebuilt), rebuilt);
  check('inner intent kept', rebuilt.includes('intent="open-interval($a,$b)"'), rebuilt);
  check('comments stripped', !rebuilt.includes('<!--'), rebuilt);
  check('xml:lang from nearest lang', rebuilt.startsWith('<math xml:lang="en-GB">'), rebuilt);
  const rebuiltMJ = env.agent.rebuildForNVDA(sOn.math);
  check('mathjax: xml:lang from html lang', rebuiltMJ.startsWith('<math xml:lang="en">'), rebuiltMJ);
  check('mathjax: root attributes dropped', !/^<math[^>]*(intent|display|xmlns)=/.test(rebuiltMJ), rebuiltMJ);
}
{
  const env = makeAgentEnv(SRC, { lang: '' });
  env.doc.documentElement.removeAttribute('lang');
  const m = env.doc.querySelector('math');
  check('no lang -> no xml:lang', env.agent.rebuildForNVDA(m).startsWith('<math>'), env.agent.rebuildForNVDA(m));
}

// ---- MathJax focus path (M12) -------------------------------------------
{
  const env = makeAgentEnv(`<p>${mjOn}</p><button id="b">x</button>`);
  env.agent.start();
  const c = env.doc.querySelector('mjx-container');
  c.dispatchEvent(new env.w.FocusEvent('focusin', { bubbles: true }));
  const req = env.sent.find(m => m.type === 'mathcat-proof:speak');
  check('focusin posts a speak request', !!req);
  check('request carries NVDA-style MathML', req && req.mathml.startsWith('<math xml:lang="en">'), req && req.mathml);
  const r = env.region();
  check('region shown immediately (nbsp, as MathJax)', r && r.classList.contains('ASTEM_MathCAT_Region_Show'));
  eq('region placeholder is nbsp', r && r.firstElementChild.textContent, '\u00a0');
  eq('region aria-hidden', r && r.getAttribute('aria-hidden'), 'true');
  check('region appended to end of body', r && env.doc.body.lastElementChild === r);
  env.reply({ type: 'mathcat-proof:speech', id: req.id + 99, ok: true, text: 'STALE', version: '0.7.2', nvda: '2026.2' });
  eq('stale reply ignored', env.region().firstElementChild.textContent, '\u00a0');
  env.replyFrom({}, { type: 'mathcat-proof:speech', id: req.id, ok: true, text: 'FOREIGN', version: '0.7.2', nvda: '2026.2' });
  eq('reply from non-parent ignored', env.region().firstElementChild.textContent, '\u00a0');
  env.reply({ type: 'mathcat-proof:speech', id: req.id, ok: true, text: 'the interval from eigh to b', version: '0.7.2', nvda: '2026.2' });
  eq('speech text shown', env.region().firstElementChild.textContent, 'the interval from eigh to b');
  eq('version line shown', env.region().querySelector('.ASTEM_MathCAT_Region_meta').textContent, 'MathCAT 0.7.2 \u00b7 NVDA 2026.2');
  c.dispatchEvent(new env.w.FocusEvent('focusout', { bubbles: true }));
  eq('focusout removes region', env.region(), null);
  check('stylesheet injected once', env.doc.querySelectorAll('#ASTEM-MathCAT-Region-styles').length === 1);
}
// ---- error path (M11) ----------------------------------------------------
{
  const env = makeAgentEnv(`<p>${mjOn}</p>`);
  env.agent.start();
  env.doc.querySelector('mjx-container').dispatchEvent(new env.w.FocusEvent('focusin', { bubbles: true }));
  const req = env.sent.find(m => m.type === 'mathcat-proof:speak');
  env.reply({ type: 'mathcat-proof:speech', id: req.id, ok: false, error: 'Invalid MathML input:\nsecond line', version: '0.7.2', nvda: '2026.2' });
  const r = env.region();
  check('error marked', r.classList.contains('ASTEM_MathCAT_Region_error'));
  eq('error text first line', r.firstElementChild.textContent, 'MathCAT error: Invalid MathML input:');
}
// ---- plain MathML click path (M13) --------------------------------------
{
  const env = makeAgentEnv(`<p id="t">text ${SRC}</p><p id="o">other</p>`);
  env.agent.start();
  const m = env.doc.querySelector('math');
  m.querySelector('mi').dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  const req = env.sent.find(x => x.type === 'mathcat-proof:speak');
  check('click on plain math posts request', !!req);
  check('plain: no tabindex added', !m.hasAttribute('tabindex'));
  env.reply({ type: 'mathcat-proof:speech', id: req.id, ok: true, text: 'T', version: '0.7.2', nvda: '2026.2' });
  eq('plain popup shown', env.region() && env.region().firstElementChild.textContent, 'T');
  env.doc.getElementById('o').dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  eq('click elsewhere hides', env.region(), null);
  m.dispatchEvent(new env.w.MouseEvent('click', { bubbles: true }));
  check('popup back', !!env.region());
  env.doc.dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  eq('Escape hides', env.region(), null);
}
// ---- ready message -------------------------------------------------------
{
  const env = makeAgentEnv(`<p>${mjOn}</p>`); env.agent.start();
  const ready = env.sent.find(m => m.type === 'mathcat-proof:ready');
  eq('ready mode mathjax', ready && ready.mode, 'mathjax');
  const env2 = makeAgentEnv(SRC); env2.agent.start();
  eq('ready mode plain', (env2.sent.find(m => m.type === 'mathcat-proof:ready') || {}).mode, 'plain');
  const env3 = makeAgentEnv('<p>none</p>'); env3.agent.start();
  eq('ready mode none', (env3.sent.find(m => m.type === 'mathcat-proof:ready') || {}).mode, 'none');
}
done('T2 agent');
