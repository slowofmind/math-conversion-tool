// N21 (PLAN-MATHCAT-NAVIGATION.md 9.1): with the `navigation` switch off, the
// agent does exactly what the first plan's agent does: no tags, no MathJax
// step, no key handling, the first plan's MathML sent, the page untouched.
// Also re-runs the first plan's agent and presenter tests (T2, T3) with
// navigation off (agent-env.mjs reads ASTEM_MC_NAV_OFF=1).
import { spawnSync } from 'node:child_process';
import { check, eq, done } from './lib.mjs';
import { makeNavEnv, MSG, KEYS } from './nav-env.mjs';

const OFF = { navigation: false };
const SRC = '<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>';
{
  const env = makeNavEnv(`<p id="t">${SRC}</p>`, { switches: OFF });
  const nav = env.agent.nav;
  eq('agent reports the effective switch', nav && nav.switches && nav.switches.navigation, false);
  const before = env.doc.body.innerHTML;
  env.agent.start();
  const math = env.doc.querySelector('math');
  env.click(math);
  const sp = env.last(MSG.speak);
  eq('off: the first plan MathML is sent (no ids)', sp && sp.mathml, env.agent.rebuildForNVDA(math));
  check('off: ArrowDown not prevented', !env.key(env.doc.body, KEYS.ZoomIn).defaultPrevented);
  eq('off: no navigation request', env.of(MSG.nav).length, 0);
  env.key(env.doc.body, { code: 'Escape', key: 'Escape' });
  eq('off: Escape closes the plain popup as before', env.region(), null);
  eq('off: page untouched', env.doc.body.innerHTML, before);
}
{
  const env = makeNavEnv(`<p>${SRC}</p>`, { switches: OFF, mathjax: 'config' });
  eq('off, MathJax page: no tags', env.doc.querySelectorAll('[data-astem-mc]').length, 0);
  const ra = env.w.MathJax.options.renderActions;
  check('off, MathJax page: no render action', !ra.astemMathCAT);
  check('off, MathJax page: existing render action untouched', ra.astemIntentArrows === env.arrows190);
}
for (const f of ['test-t2-agent.mjs', 'test-t3-presenter.mjs']) {
  const r = spawnSync(process.execPath, [f], { cwd: new URL('.', import.meta.url),
    env: { ...process.env, ASTEM_MC_NAV_OFF: '1' }, encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  check(`first plan ${f} passes with navigation off`, r.status === 0, last + (r.stderr ? '\n' + r.stderr.slice(0, 300) : ''));
}
done('N21 navigation off');
