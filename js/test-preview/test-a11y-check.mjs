// test-a11y-check.mjs — the accessibility check's platform side (js/a11y-check.js).
//   node test-a11y-check.mjs          (cwd: js/test-preview)
// Plan: accessibility-checker\PLAN-ACCESSIBILITY-CHECKER.md. Nicholas, 2026-10-18 (verbatim in the
// plan): "On/off should be as you describe...off by default (for now)".
// Written before js/a11y-check.js existed and seen to fail. Fakes as in test-subtitles.mjs.
import { check, eq, done } from '../../mathcat-wasm/test/lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initA11yCheck } from '../a11y-check.js';

function fakeWin() {
  const listeners = [];
  return { listeners, addEventListener: (t, f) => t === 'message' && listeners.push(f),
           removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
}
function setup(extra = {}) {
  const win = fakeWin();
  const frameWin = { got: [], postMessage(m) { this.got.push(m); } };
  const frame = { contentWindow: frameWin };
  let loads = 0;
  const chk = initA11yCheck({ win, getPreviewFrame: () => frame,
    loadAgentSource: async () => { loads++; return '/* agent */'; }, ...extra });
  const fromPage = async (data, source = frameWin) => { for (const l of win.listeners) await l({ source, data }); };
  return { chk, win, frameWin, fromPage, loads: () => loads };
}
const PAGE = '<html><head></head><body><p>x</p></body></html>';
const between = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) > s.indexOf(a);

// ---- A1: off by default; off leaves the preview copy exactly as it was ----
{
  const t = setup();
  eq('A1 off by default', t.chk.isOn(), false);
  eq('A1 off: preview copy unchanged', await t.chk.preparePreview(PAGE), PAGE);
  eq('A1 off: the helper is not even fetched', t.loads(), 0);
}

// ---- A2: on: helper inlined, then Sa11y by address, all just before the last </body> ----
{
  const t = setup();
  t.chk.setOn(true);
  eq('A2 on', t.chk.isOn(), true);
  const out = await t.chk.preparePreview(PAGE);
  check('A2 helper inlined as text', out.includes('<script data-astem-a11y-agent>/* agent */</' + 'script>'), out);
  check('A2 Sa11y stylesheet by address', /<link rel="stylesheet" data-astem-a11y href="[^"]*\/sa11y-5\.1\.0\/sa11y\.min\.css">/.test(out), out);
  check('A2 Sa11y strings by address', /<script data-astem-a11y src="[^"]*\/sa11y-5\.1\.0\/lang\/en\.umd\.js"><\/script>/.test(out), out);
  check('A2 Sa11y by address', /<script data-astem-a11y src="[^"]*\/sa11y-5\.1\.0\/sa11y\.umd\.min\.js"><\/script>/.test(out), out);
  check('A2 order: helper, strings, Sa11y', between(out, 'data-astem-a11y-agent', 'lang/en.umd.js') && between(out, 'lang/en.umd.js', 'sa11y.umd.min.js'), out);
  check('A2 all before </body>', out.lastIndexOf('sa11y.umd.min.js') < out.lastIndexOf('</body>'), out);
  const start = out.indexOf('<script data-astem-a11y-agent>');
  const end = out.lastIndexOf('</body>');
  eq('A2 nothing else changed', out.slice(0, start) + out.slice(end), PAGE);
  check('A2 addresses are absolute (the preview copy\'s <base> is about:srcdoc)', /src="(file|https?):\/\//.test(out), out);
}

// ---- A3: the LAST </body> (an earlier one can sit inside a script's text) ----
{
  const t = setup();
  t.chk.setOn(true);
  const page = '<html><body><script>var s = "</body>";</' + 'script><p>x</p></body></html>';
  const out = await t.chk.preparePreview(page);
  check('A3 inserted before the last </body>', out.indexOf('data-astem-a11y-agent') > out.indexOf('<p>x</p>'), out);
  check('A3 the script\'s text untouched', out.includes('var s = "</body>";'), out);
}

// ---- A4: no </body> at all: added at the end ----
{
  const t = setup();
  t.chk.setOn(true);
  const out = await t.chk.preparePreview('<p>x</p>');
  check('A4 no </body>: appended', out.startsWith('<p>x</p><script data-astem-a11y-agent>'), out);
}

// ---- A5: a helper that cannot be inlined is refused (rule M16) ----
{
  for (const bad of ['a <!-- b', 'a </script> b', 'a </SCRIPT b']) {
    const t = setup({ loadAgentSource: async () => bad });
    t.chk.setOn(true);
    let threw = false;
    try { await t.chk.preparePreview(PAGE); } catch { threw = true; }
    check('A5 refused: ' + JSON.stringify(bad), threw);
  }
}

// ---- A6: the real helper passes M16; the real Sa11y files are where the tags point ----
{
  const agent = readFileSync(new URL('../a11y-check-agent.js', import.meta.url), 'utf8');
  check('A6 real helper: no </script', !/<\/script/i.test(agent));
  check('A6 real helper: no <!--', !/<!--/.test(agent));
  const t = setup({ loadAgentSource: undefined });
  t.chk.setOn(true);
  // the default loader fetches with cache 'no-cache' (2026-10-10 rule for helpers)
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), cache: init && init.cache }); return { ok: true, text: async () => agent }; };
  let out = '';
  try { out = await t.chk.preparePreview(PAGE); } finally { globalThis.fetch = realFetch; }
  check('A6 default loader fetched the helper once', seen.length === 1 && seen[0].url.endsWith('/js/a11y-check-agent.js'), JSON.stringify(seen));
  eq('A6 ... with cache no-cache', seen[0] && seen[0].cache, 'no-cache');
  const urls = [...out.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  eq('A6 three addresses', urls.length, 3);
  for (const u of urls) check('A6 file exists: ' + u.split('/').slice(-2).join('/'), u.startsWith('file:') && existsSync(fileURLToPath(u)), u);
  check('A6 licence kept beside Sa11y', existsSync(fileURLToPath(new URL('../../sa11y-5.1.0/LICENSE.md', import.meta.url))));
}

// ---- A7: the helper is fetched once for the session ----
{
  const t = setup();
  t.chk.setOn(true);
  await t.chk.preparePreview(PAGE);
  await t.chk.preparePreview(PAGE);
  t.chk.setOn(false); t.chk.setOn(true);
  await t.chk.preparePreview(PAGE);
  eq('A7 fetched once', t.loads(), 1);
}

// ---- A8: results from the preview: only from our preview, only while on, only well-formed ----
{
  const t = setup();
  const seen = [];
  t.chk.onResults(r => seen.push(r));
  const msg = { type: 'astem-a11y:results', errors: 2, warnings: 1,
                items: [{ test: 'ALT_PLACEHOLDER', type: 'error' }, { test: 'HEADING_SKIPPED_LEVEL', type: 'error' }, { test: 'LINK_CLICK_HERE', type: 'warning' }] };
  await t.fromPage(msg);
  eq('A8 off: ignored', t.chk.lastResults(), null);
  t.chk.setOn(true);
  await t.fromPage(msg, { postMessage() {} });
  eq('A8 another window: ignored', t.chk.lastResults(), null);
  await t.fromPage({ type: 'astem-a11y:results', errors: 'x' });
  eq('A8 malformed: ignored', t.chk.lastResults(), null);
  await t.fromPage(msg);
  const r = t.chk.lastResults();
  check('A8 kept', r && r.errors === 2 && r.warnings === 1 && r.items.length === 3, JSON.stringify(r));
  eq('A8 watchers told once', seen.length, 1);
  await t.fromPage({ type: 'mathcat-proof:mode', choice: 'hide' });
  eq('A8 other helpers\' messages ignored', seen.length, 1);
}

// ---- A9: turning off forgets the last results ----
{
  const t = setup();
  t.chk.setOn(true);
  await t.fromPage({ type: 'astem-a11y:results', errors: 0, warnings: 0, items: [] });
  check('A9 kept while on', t.chk.lastResults() !== null);
  t.chk.setOn(false);
  eq('A9 forgotten when off', t.chk.lastResults(), null);
}

done('test-a11y-check');
