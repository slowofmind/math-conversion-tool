// N-T5 (PLAN-MATHCAT-NAVIGATION.md section 6): the agent's keys.
//   handled keys are prevented, unhandled keys pass through (3.5);
//   the first key after arriving or Escape starts fresh (N19) and, if it is
//   ZoomIn, counts as entering (N22); Escape while navigating returns to the
//   whole expression, otherwise behaves as before (N3);
//   stale, out-of-date and foreign replies are ignored; the highlight is
//   cleared on Escape, focus out, close and redraw (3.7); switches (N21).
// Replies are scripted here; N-T4 drives the real engine.
import { check, eq, done } from './lib.mjs';
import { makeNavEnv, mathjaxPage, visibleTagged, MSG, KEYS } from './nav-env.mjs';

const SRC = '<math display="block"><mrow intent="open-interval($a,$b)"><mo>(</mo><mi arg="a">a</mi><mo>,</mo><mi arg="b">b</mi><mo>)</mo></mrow></math>';
const ESC = { code: 'Escape', key: 'Escape' };
const meta = { version: '0.7.2', nvda: '2026.2' };
function plainPage(opts) {
  const env = makeNavEnv(`<p id="t">${SRC}</p><p id="o">other</p>`, opts);
  env.agent.start();
  const math = env.doc.querySelector('#t > math');
  env.click(math);
  const sp = env.last(MSG.speak);
  env.reply({ type: MSG.speech, id: sp.id, ok: true, text: 'WHOLE', ...meta });
  return { env, math, sp, live: [...math.querySelectorAll('*')] };
}
const answer = (env, m, extra) => env.reply({ type: MSG.navspeech, id: m.id, nav: m.nav, ok: true,
  text: 'T', nodeTag: null, highlightTags: [], ...meta, ...extra });

// ---- before any popup -----------------------------------------------------------
{
  const env = makeNavEnv(`<p>${SRC}</p>`); env.agent.start();
  const ev = env.key(env.doc.body, KEYS.ZoomIn);
  check('no popup: arrow not prevented', !ev.defaultPrevented);
  eq('no popup: nothing sent', env.of(MSG.nav).length, 0);
}

// ---- plain popup: the full key cycle ---------------------------------------------
{
  const { env, sp, live } = plainPage();
  const b = env.doc.body;
  const e1 = env.key(b, KEYS.ZoomIn);
  const n1 = env.last(MSG.nav);
  check('ArrowDown prevented', e1.defaultPrevented);
  check('nav request sent', !!n1);
  if (!n1) done('N-T5 agent keys');
  eq('request: command', n1.command, 'ZoomIn');
  eq('request: same id as the speech request', n1.id, sp.id);
  eq('request: carries the MathML sent for speech (N8)', n1.mathml, sp.mathml);
  eq('request: first key starts fresh (N19)', n1.fresh, true);
  eq('request: first ZoomIn is entering (N22)', n1.entering, true);
  check('request: nav counter is a number', typeof n1.nav === 'number');
  answer(env, n1, { text: 'in part 1 eigh', highlightTags: ['astem-3'] });
  eq('reply text shown', env.text(), 'in part 1 eigh');
  check('reply highlight shown', env.hl().length === 1 && env.hl()[0] === live[2]);
  eq('highlight attribute is empty-valued', live[2].getAttribute('data-astem-mc-hl'), '');
  const e2 = env.key(b, KEYS.MoveNext);
  const n2 = env.last(MSG.nav);
  check('ArrowRight prevented', e2.defaultPrevented);
  check('later key: not fresh', !n2.fresh);
  check('later key: not entering', !n2.entering);
  check('counter increases', n2.nav > n1.nav);
  answer(env, n1, { text: 'OLD' });
  eq('out-of-date reply (older counter) ignored', env.text(), 'in part 1 eigh');
  env.reply({ type: MSG.navspeech, id: n2.id + 99, nav: n2.nav, ok: true, text: 'STALE', ...meta });
  eq('reply for another expression ignored', env.text(), 'in part 1 eigh');
  env.replyFrom({}, { type: MSG.navspeech, id: n2.id, nav: n2.nav, ok: true, text: 'FOREIGN', ...meta });
  eq('reply from a non-parent ignored', env.text(), 'in part 1 eigh');
  answer(env, n2, { ok: false, text: 'Error in navigating math', error: 'x' });
  eq("failure: NVDA's message exactly (N6)", env.text(), 'Error in navigating math');
  check('failure: error style', env.region().classList.contains('ASTEM_MathCAT_Region_error'));
  const before = env.of(MSG.nav).length;
  for (const [label, init] of [['a', { code: 'KeyA', key: 'a' }], ['Tab', { code: 'Tab', key: 'Tab' }],
    ['Meta+ArrowDown', { code: 'ArrowDown', key: 'ArrowDown', metaKey: true }]]) {
    check(`unhandled key passes through: ${label}`, !env.key(b, init).defaultPrevented);
  }
  eq('unhandled keys send nothing', env.of(MSG.nav).length, before);
  // Escape while navigating: back to the whole expression (N3)
  const eEsc = env.key(b, ESC);
  check('Escape while navigating: prevented', eEsc.defaultPrevented);
  check('Escape while navigating: popup stays', !!env.region());
  eq('Escape while navigating: whole-expression text back', env.text(), 'WHOLE');
  check('Escape while navigating: error style off', !env.region().classList.contains('ASTEM_MathCAT_Region_error'));
  eq('Escape while navigating: highlight cleared', env.hl().length, 0);
  answer(env, n2, { text: 'LATE', highlightTags: ['astem-3'] });
  eq('reply arriving after Escape ignored', env.text(), 'WHOLE');
  env.key(b, KEYS.MoveNext);
  const n3 = env.last(MSG.nav);
  eq('after Escape: fresh again', n3.fresh, true);
  check('after Escape: MoveNext is not entering', !n3.entering);
  env.key(b, KEYS.ZoomIn);
  check('a later ZoomIn is not entering', !env.last(MSG.nav).entering);
  env.key(b, ESC);
  const eClose = env.key(b, ESC);
  check('Escape when not navigating: plain popup closes (first plan)', env.region() === null);
  check('Escape when not navigating: not prevented (first plan)', !eClose.defaultPrevented);
  // close by clicking elsewhere, with a highlight showing
  env.click(env.doc.querySelector('#t > math'));
  const sp2 = env.last(MSG.speak);
  env.reply({ type: MSG.speech, id: sp2.id, ok: true, text: 'WHOLE', ...meta });
  env.key(b, KEYS.ZoomIn);
  const n4 = env.last(MSG.nav);
  eq('new activation: fresh', n4.fresh, true);
  answer(env, n4, { highlightTags: ['astem-3'] });
  eq('highlight showing', env.hl().length, 1);
  env.click(env.doc.getElementById('o'));
  eq('click elsewhere: popup closed', env.region(), null);
  eq('click elsewhere: highlight cleared', env.hl().length, 0);
  answer(env, n4, { highlightTags: ['astem-3'] });
  eq('reply after close: no highlight', env.hl().length, 0);
  eq('reply after close: no popup', env.region(), null);
  // placemarker digits by physical key
  env.click(env.doc.querySelector('#t > math'));
  env.key(b, { code: 'Digit1', key: '1', ctrlKey: true });
  eq('Ctrl+1 -> SetPlacemarker1', env.last(MSG.nav).command, 'SetPlacemarker1');
  env.key(b, { code: 'Digit1', key: '!', shiftKey: true });
  eq('Shift+1 ("!") -> Read1', env.last(MSG.nav).command, 'Read1');
}

// ---- switches (N21) ----------------------------------------------------------------
{
  const { env } = plainPage({ switches: { freshStart: false } });
  env.key(env.doc.body, KEYS.ZoomIn);
  const n = env.last(MSG.nav);
  check('freshStart off: no fresh flag', !!n && !n.fresh);
  eq('freshStart off: the first ZoomIn is still entering (N22)', n && n.entering, true);
}
{
  const { env } = plainPage({ switches: { highlight: false } });
  env.key(env.doc.body, KEYS.ZoomIn);
  const n = env.last(MSG.nav);
  if (n) answer(env, n, { text: 'X', highlightTags: ['astem-3'] });
  eq('highlight off: text still shown', env.text(), 'X');
  eq('highlight off: nothing highlighted', env.hl().length, 0);
}
// ---- MathJax page: keys inside the focused container only; focus out; redraw ------
{
  const { env, container } = await mathjaxPage(SRC);
  env.agent.start();
  env.focus(container);
  const sp = env.last(MSG.speak);
  env.reply({ type: MSG.speech, id: sp.id, ok: true, text: 'WHOLE', ...meta });
  const outside = env.key(env.doc.getElementById('b'), KEYS.ZoomIn);
  check('MathJax: key outside the container not handled', !outside.defaultPrevented);
  const inside = env.key(container, KEYS.ZoomIn);
  check('MathJax: key inside the container handled', inside.defaultPrevented);
  const n = env.last(MSG.nav);
  if (n) answer(env, n, { highlightTags: ['astem-3'] });
  const want = visibleTagged(container).filter((e) => e.getAttribute('data-astem-mc') === '3');
  check('MathJax: the visible element(s) are highlighted', want.length > 0 && env.hl().length === want.length && want.every((e) => env.hl().includes(e)));
  check('MathJax: the hidden MathML is never highlighted', !container.querySelector('mjx-assistive-mml [data-astem-mc-hl]'));
  env.blur(container);
  eq('MathJax: focus out clears the highlight', env.hl().length, 0);
  eq('MathJax: focus out closes the popup (first plan)', env.region(), null);
  env.focus(container);
  const sp2 = env.last(MSG.speak);
  env.reply({ type: MSG.speech, id: sp2.id, ok: true, text: 'WHOLE', ...meta });
  check('MathJax: Escape when not navigating is not prevented', !env.key(container, ESC).defaultPrevented);
  env.key(container, KEYS.ZoomIn);
  const n2 = env.last(MSG.nav);
  if (n2) answer(env, n2, { highlightTags: ['astem-3'] });
  container.remove();                                    // MathJax redraw replaces the container
  await env.tick();
  eq('redraw: popup closed', env.region(), null);
  check('redraw: nothing left highlighted', !container.querySelector('[data-astem-mc-hl]'));
}
done('N-T5 agent keys');
