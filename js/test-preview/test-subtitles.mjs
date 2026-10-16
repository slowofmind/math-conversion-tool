// test-subtitles.mjs — Math subtitles across page swaps (js/mathcat-proof.js).
//   node test-subtitles.mjs          (cwd: js/test-preview)
// Plan: PLAN-MULTIPAGE-PREVIEW.md "How it works" 5. Nicholas, 2026-10-08 (verbatim
// in the plan): reset "for each conversion without being reset by loading a new page
// from the same "shelf""; D1 (a): the reset comes when the new output appears; the
// default is read from one place, for a future user setting.
// Written before the change and seen to fail against mathcat-proof.js as committed
// (29852e0). Fakes as in mathcat-wasm/test/test-t4-messaging.mjs.
import { check, eq, done } from '../../mathcat-wasm/test/lib.mjs';
import { initMathCATProof } from '../mathcat-proof.js';

function fakeWin() {
  const listeners = [];
  return { listeners, addEventListener: (t, f) => t === 'message' && listeners.push(f),
           removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
function setup(extra = {}) {
  const win = fakeWin();
  const frameWin = { got: [], postMessage(m) { this.got.push(m); } };
  const frame = { contentWindow: frameWin };
  let engineLoads = 0;
  const engine = { version: '0.7.2', nvda: '2026.2', speak: async (m) => ({ ok: true, text: 'spoken:' + m }) };
  const proof = initMathCATProof({ win, getPreviewFrame: () => frame, choosePauseMs: 20,
    loadEngine: async () => { engineLoads++; return engine; }, loadAgentSource: async () => '/* agent */', ...extra });
  const seen = [];
  proof.onChoice(info => seen.push(info));
  // a message from the preview's helper, as the platform's listener receives it
  const fromPage = async (data) => { for (const l of win.listeners) await l({ source: frameWin, data }); };
  const report = (o) => fromPage({ type: 'mathcat-proof:mode', ...o });
  const lastSetmode = () => [...frameWin.got].reverse().find(m => m.type === 'mathcat-proof:setmode');
  return { proof, frameWin, seen, report, lastSetmode, loads: () => engineLoads };
}
const PAGE = '<html><body><p>x</p></body></html>';

// ---- U1: a new output starts at the default; a page swap keeps the setting ----
{
  const t = setup();
  await t.proof.preparePreview(PAGE);                                     // first output (no options: a new output, as today)
  eq('U1 new output starts Hidden', t.proof.choice(), 'hide');
  await t.report({ mathjax: true, pageButton: false, choice: 'hide' });   // the page's helper reports in
  eq('U1 MathCat chosen', await t.proof.setChoice('mathcat'), true);
  await t.proof.preparePreview(PAGE, { pageSwap: true });
  eq('U1 page swap keeps MathCat', t.proof.choice(), 'mathcat');
  check('U1 speech still answered after the swap', t.proof.isEnabled());
  eq('U1 watchers told it was a page swap', t.seen.at(-1).source, 'page-swap');
  await t.report({ mathjax: true, pageButton: false, choice: 'hide' });   // the new page's first report
  eq('U1 the new page is told the setting', t.lastSetmode()?.choice, 'mathcat');
  eq('U1 and the setting is not adopted from the page', t.proof.choice(), 'mathcat');
  await t.proof.preparePreview(PAGE, { pageSwap: true });
  await t.proof.preparePreview(PAGE, { pageSwap: true });
  eq('U1 three swaps, still MathCat', t.proof.choice(), 'mathcat');
  await t.proof.preparePreview(PAGE);                                     // the next conversion's output
  eq('U1 next output: back to Hidden', t.proof.choice(), 'hide');
  check('U1 next output: speech off', !t.proof.isEnabled());
  eq('U1 watchers told it was new', t.seen.at(-1).source, 'new-preview');
  await t.proof.preparePreview(PAGE, { newOutput: true });
  eq('U1 { newOutput: true } is the same as no options', t.proof.choice(), 'hide');
}

// ---- U2: the default comes from one place ----
{
  const t = setup({ defaultChoice: () => 'mathcat' });
  await t.proof.preparePreview(PAGE);
  eq('U2 a default of MathCat: new output starts at MathCat', t.proof.choice(), 'mathcat');
  await tick(5);
  eq('U2 ... and the engine is loaded once', t.loads(), 1);
  check('U2 ... and speech is answered once it has loaded', t.proof.isEnabled());
  const bad = setup({ defaultChoice: 'shout' });
  await bad.proof.preparePreview(PAGE);
  eq('U2 an unknown default falls back to Hidden', bad.proof.choice(), 'hide');
}

// ---- U3: a page that cannot show the MathJax setting ----
{
  const t = setup();
  await t.proof.preparePreview(PAGE);
  await t.report({ mathjax: true, pageButton: false, choice: 'hide' });
  eq('U3 MathJax chosen', await t.proof.setChoice('mathjax'), true);
  await t.proof.preparePreview(PAGE, { pageSwap: true });                 // a page without MathJax
  await t.report({ mathjax: false, pageButton: false, choice: 'hide' });  // first report
  eq('U3 the page is still told the setting', t.lastSetmode()?.choice, 'mathjax');
  await t.report({ mathjax: false, pageButton: false, choice: 'hide' });  // its refusal
  eq('U3 the setting is kept', t.proof.choice(), 'mathjax');
  eq('U3 the drop-down shows what the page shows', t.seen.at(-1).choice, 'hide');
  eq('U3 ... and still knows the setting', t.seen.at(-1).setting, 'mathjax');
  await t.proof.preparePreview(PAGE, { pageSwap: true });                 // back to a page with MathJax
  await t.report({ mathjax: true, pageButton: false, choice: 'hide' });
  eq('U3 MathJax re-applied on the next page that has it', t.lastSetmode()?.choice, 'mathjax');
  eq('U3 drop-down shows MathJax again', t.seen.at(-1).choice, 'mathjax');
  // on a page without MathJax, the page's own button still changes the setting
  await t.proof.preparePreview(PAGE, { pageSwap: true });
  await t.report({ mathjax: false, pageButton: true, choice: 'hide' });
  await t.report({ mathjax: false, pageButton: true, choice: 'hide' });
  await t.report({ mathjax: false, pageButton: true, choice: 'mathcat' });
  eq('U3 the page\'s own button to MathCat is adopted', t.proof.choice(), 'mathcat');
}

// ---- U4: a drop-down change in its pause survives a page swap, not a new output ----
{
  const t = setup();
  await t.proof.preparePreview(PAGE);
  await t.report({ mathjax: true, pageButton: false, choice: 'hide' });
  const p = t.proof.choose('mathcat');
  await t.proof.preparePreview(PAGE, { pageSwap: true });
  eq('U4 the change still lands after a swap', await p, true);
  eq('U4 MathCat', t.proof.choice(), 'mathcat');
  const q = t.proof.choose('hide');
  await t.proof.preparePreview(PAGE);
  eq('U4 a new output drops it (N46 C, unchanged)', await q, false);
}

// ---- U5: the helper text still goes in on a swap ----
{
  const t = setup();
  const a = await t.proof.preparePreview(PAGE);
  const b = await t.proof.preparePreview(PAGE, { pageSwap: true });
  eq('U5 same helper in both kinds of preview', a, b);
  check('U5 helper before </body>', b.includes('/* agent */</' + 'script></body>'));
}

done('test-subtitles');
