// test-intent-guard.mjs — the math-method guard.
//
//   * the first WRITE switches the math method automatically
//   * confirm-only decisions do NOT (they wrote nothing)
//   * switching away asks first, and each answer does what it says
//   * revert restores the author's ORIGINAL notation exactly
//   * scanning is refused on non-HTML output
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const PLAT = 'C:/Users/nim022/Desktop/mma-code/Accessible-STEM-Project/pandoc-for-math-conversion';

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="host"></div>
  <select id="selTo"><option value="html5" selected>html5</option>
    <option value="docx">docx</option><option value="epub">epub</option>
    <option value="chunkedhtml">chunkedhtml</option></select>
  <select id="opt-math">
    <option value="mathjax-mathml-intent" selected>intent</option>
    <option value="mathjax">plain mathjax</option>
    <option value="mathml">texmath mathml</option></select>
  <button id="btnIntentScan"></button>
  <div id="intentNav" hidden><span id="intentNavStatus"></span></div>
  <div id="intentLive"></div>
  <div id="intentPanel"><div id="intentPanelEmpty"></div>
    <div id="intentPanelBody" hidden><div id="intentProgress"></div>
    <h3 id="intentFindingHead"></h3><div id="intentNotes"></div>
    <div id="intentChoices" role="radiogroup"></div>
    <button id="btnIntentApply"></button><button id="btnIntentSkip"></button>
    <button id="btnIntentUndo"></button></div></div>
</body></html>`, { pretendToBeVisual: true, url: 'http://localhost/' });

for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element',
                 'Node', 'Range', 'getComputedStyle', 'DOMParser',
                 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'])
  if (globalThis[k] === undefined && dom.window[k] !== undefined)
    globalThis[k] = dom.window[k];

// Event and CustomEvent must be FORCED to jsdom's versions. Node 26 ships
// its own globals of those names, so the usual "only set if undefined"
// guard leaves Node's in place — and jsdom's dispatchEvent then rejects an
// event built from the wrong realm. Browsers have no such split.
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;

const D = dom.window.document;

// Node's fetch rejects file:// URLs; a browser fetching same-origin over
// http has no such restriction. Shim it to read from disk so the scan can
// actually run here — without this the suite silently tests nothing,
// because runIntentScan would fail at the vocabulary fetch every time.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const buf = readFileSync(fileURLToPath(u));
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8'),
    };
  }
  return nodeFetch(url, opts);
};

// jsdom has no <dialog> behaviour; stub just enough that the code runs.
const proto = dom.window.HTMLElement.prototype;
if (!proto.showModal) {
  proto.showModal = function () { this.setAttribute('open', ''); };
  proto.close = function () { this.removeAttribute('open'); };
}

const { createEditor } = await import(
  pathToFileURL(join(PLAT, 'codemirror', 'cm6-editor.js')).href);
const editor = createEditor(D.getElementById('host'), { initialText: '' });

const logs = [];
// A settable spy so a later test can observe which output tab the scan
// activates, without re-initialising the module.
const activateOutputTabSpy = { fn: () => {} };
const { initIntentReview } = await import(
  pathToFileURL(join(PLAT, 'intent', 'intent-review.js')).href);
const { IntentReview, runIntentScan } = initIntentReview({
  editor,
  updateStatus: () => {},
  updateLog: (l) => logs.push(...l),
  activateOutputTab: (t) => activateOutputTabSpy.fn(t),
});

const scanMod = await import(
  pathToFileURL(join(PLAT, 'math-conversion', 'intent-scan.js')).href);
const vocab = JSON.parse(readFileSync(
  join(PLAT, 'math-conversion', 'intent-vocabulary.json'), 'utf8'));
const sv = scanMod.suggestVocabFrom(vocab);
const scan = (t) => {
  const r = scanMod.detect(t, sv.groups, new Set(scanMod.groupIdsFrom(vocab)));
  const f = scanMod.filterFindings(r.kept, sv, { disabled: [] });
  const pay = f.kept.map(x => scanMod.buildSuggestions(x, t, sv));
  for (const p of pay) {
    const lc = scanMod.lineCol(t, p.start); p.line = lc.line; p.col = lc.col;
  }
  return pay;
};

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('   ok   ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? ' :: ' + d : '')); } };

const math = () => D.getElementById('opt-math');
const to = () => D.getElementById('selTo');
const setSel = (sel, v) => {
  sel.value = v;
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
const dlgButtons = () => [...(D.getElementById('intentMethodDialog')
  ?.querySelectorAll('button') || [])];
const live = () => D.getElementById('intentLive').textContent;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const DOC = 'Distance $|x|$, set $|S|$, and divisibility $3 \\mid 12$ here.\n';

// ── 0. the fixture must use the REAL format identifiers ──────────────
// This suite once used an invented value of 'html' for the output select
// and passed while the feature was disabled for every real user, because
// the tool's actual identifier is 'html5'. Read the real values out of
// index.html so the fixture cannot drift from the app again.
{
  const indexHtml = readFileSync(join(PLAT, 'index.html'), 'utf8');
  const m = indexHtml.match(/const OUTPUT_FORMAT_ALLOW = \[([^\]]+)\]/);
  ok('found OUTPUT_FORMAT_ALLOW in index.html', !!m);
  const real = m ? m[1].split(',').map(s => s.trim().replace(/['"]/g, '')) : [];
  const defaultTo = (indexHtml.match(/const pandocDefaultTo = '([^']+)'/) || [])[1];
  ok('index.html default output format found', !!defaultTo, String(defaultTo));

  const fixture = [...D.getElementById('selTo').options].map(o => o.value);
  for (const f of real) {
    ok('fixture offers the real format ' + f, fixture.includes(f),
       JSON.stringify(fixture));
  }
  // The decisive one: the tool's DEFAULT output must enable intent, or
  // the feature is off out of the box.
  setSel(to(), defaultTo);
  ok('intent is AVAILABLE on the default output format (' + defaultTo + ')',
     D.getElementById('btnIntentScan').getAttribute('aria-disabled') === 'false',
     'aria-disabled=' + D.getElementById('btnIntentScan').getAttribute('aria-disabled'));
}


// ── 1. output gating ─────────────────────────────────────────────────
setSel(to(), 'docx');
ok('scan button marked unavailable for docx',
   D.getElementById('btnIntentScan').getAttribute('aria-disabled') === 'true');
ok('the reason is in the tooltip, not just the styling',
   /HTML output only/.test(D.getElementById('btnIntentScan').title),
   D.getElementById('btnIntentScan').title);
ok('button stays focusable (aria-disabled, not disabled)',
   D.getElementById('btnIntentScan').disabled !== true);

editor.setText(DOC);
logs.length = 0;
await runIntentScan();
ok('scanning docx is refused', logs.some(l => /HTML output only/.test(l.message)),
   JSON.stringify(logs.map(l => l.message).slice(0, 2)));

setSel(to(), 'epub');
ok('epub is also refused for now',
   D.getElementById('btnIntentScan').getAttribute('aria-disabled') === 'true');
setSel(to(), 'chunkedhtml');
ok('chunked html is refused for now (planned, not verified)',
   D.getElementById('btnIntentScan').getAttribute('aria-disabled') === 'true');
setSel(to(), 'html5');
ok('html is allowed',
   D.getElementById('btnIntentScan').getAttribute('aria-disabled') === 'false');

// ── 2. auto-switch on first WRITE ────────────────────────────────────
setSel(math(), 'mathjax');
ok('starting from a non-intent method', math().value === 'mathjax');

editor.setText(DOC);
const pay = scan(DOC);
IntentReview.load(pay, DOC);
IntentReview.goTo(0);
IntentReview.select(0);
logs.length = 0;
IntentReview.applyCurrent();
await wait(60);

ok('a write switched the math method automatically',
   math().value === 'mathjax-mathml-intent', math().value);
ok('the switch was logged, not silent',
   logs.some(l => /switched to/.test(l.message)),
   JSON.stringify(logs.map(l => l.message)));
ok('the switch was announced to assistive tech',
   /switched to/.test(live()), live());

// ── 3. confirm-only must NOT switch (it wrote nothing) ───────────────
setSel(math(), 'mathjax');
const confirmIdx = IntentReview.findings.findIndex(
  p => p.status === 'pending' && p.candidates.some(c => c.confirmOnly));
if (confirmIdx >= 0) {
  IntentReview.goTo(confirmIdx);
  IntentReview.select(
    IntentReview.findings[confirmIdx].candidates.findIndex(c => c.confirmOnly));
  const before = editor.getText();
  IntentReview.applyCurrent();
  await wait(40);
  ok('confirm-only wrote nothing', editor.getText() === before);
  ok('confirm-only did NOT change the math method', math().value === 'mathjax',
     math().value);
} else {
  console.log('   --   no confirm-only candidate in this fixture');
}

// ── 4. switching away: cancel keeps everything ───────────────────────
setSel(math(), 'mathjax-mathml-intent');
const written = IntentReview.writtenCount;
ok('there is an applied annotation to protect', written > 0, String(written));

const annotated = editor.getText();
setSel(math(), 'mathjax');
ok('a dialog was raised rather than switching silently',
   dlgButtons().length === 3, String(dlgButtons().length));
dlgButtons()[0].click();          // "Keep the custom MathJax method"
await wait(40);
ok('cancel restored the intent method', math().value === 'mathjax-mathml-intent',
   math().value);
ok('cancel left the document untouched', editor.getText() === annotated);
ok('cancel kept the annotations', IntentReview.writtenCount === written);

// ── 5. switching away: revert restores the ORIGINAL notation ─────────
setSel(math(), 'mathml');
ok('dialog raised again', dlgButtons().length === 3);
logs.length = 0;
dlgButtons()[1].click();          // "Remove the annotations and switch"
await wait(40);
ok('revert removed every applied annotation', IntentReview.writtenCount === 0,
   String(IntentReview.writtenCount));
ok('revert restored the document EXACTLY', editor.getText() === DOC,
   JSON.stringify(editor.getText()));
ok('reverted findings are pending again',
   IntentReview.findings.every(p => p.status !== 'applied' || !p.appliedText));
ok('revert was logged', logs.some(l => /removed/.test(l.message)),
   JSON.stringify(logs.map(l => l.message)));
ok('the requested method took effect', math().value === 'mathml', math().value);

// ── 6. switching away: force keeps annotations, warns loudly ─────────
setSel(math(), 'mathjax-mathml-intent');
editor.setText(DOC);
const pay2 = scan(DOC);
IntentReview.load(pay2, DOC);
IntentReview.goTo(0);
IntentReview.select(0);
IntentReview.applyCurrent();
await wait(40);
const annotated2 = editor.getText();
logs.length = 0;
setSel(math(), 'mathjax');
dlgButtons()[2].click();          // "Switch anyway"
await wait(40);
ok('force applied the requested method', math().value === 'mathjax', math().value);
ok('force kept the annotations', editor.getText() === annotated2);
ok('force warned at warn level',
   logs.some(l => l.level === 'warn' && /will not render/.test(l.message)),
   JSON.stringify(logs.map(l => l.level + ':' + l.message)));

// ── 7. no annotations means no dialog at all ─────────────────────────
IntentReview.clear();
editor.setText(DOC);
setSel(math(), 'mathjax-mathml-intent');
const openBefore = D.getElementById('intentMethodDialog')?.hasAttribute('open');
setSel(math(), 'mathml');
ok('a clean document switches methods without interruption',
   math().value === 'mathml' && !openBefore, math().value);

// ── 8. the scan lands on the right output tab ────────────────────────
// Verified against the REAL tab ids parsed out of index.html, so an id
// rename cannot leave this passing while the app misbehaves.
{
  const indexHtml = readFileSync(join(PLAT, 'index.html'), 'utf8');
  const ids = [...indexHtml.matchAll(/id="(outtab-[a-z]+)"/g)].map(m => m[1]);
  ok('index.html has an Intent output tab', ids.includes('outtab-intent'),
     JSON.stringify(ids));
  ok('index.html has a Log output tab', ids.includes('outtab-log'));

  // Rebuild the fixture's tab strip from the real ids.
  const strip = D.createElement('div');
  for (const id of ids) {
    const b = D.createElement('button');
    b.id = id;
    b.setAttribute('aria-selected', 'false');
    strip.appendChild(b);
  }
  D.body.appendChild(strip);

  let activated = null;
  activateOutputTabSpy.fn = (t) => {
    activated = t && t.id;
    for (const id of ids) {
      D.getElementById(id).setAttribute('aria-selected', String(id === activated));
    }
  };

  setSel(to(), 'html5');
  setSel(math(), 'mathjax-mathml-intent');

  // A document WITH findings should land on Intent.
  editor.setText(DOC);
  activated = null;
  await runIntentScan();
  await wait(60);
  ok('a scan with findings activates the Intent tab',
     activated === 'outtab-intent', String(activated));
  ok('the Intent tab is marked selected',
     D.getElementById('outtab-intent').getAttribute('aria-selected') === 'true');

  // A document with NOTHING to review should stay on the Log, which is
  // where the explanation of what was searched lives.
  editor.setText('No math here at all, just prose.\n');
  activated = null;
  await runIntentScan();
  await wait(60);
  ok('a scan with no findings activates the Log tab instead',
     activated === 'outtab-log', String(activated));
}

console.log(`\nintent guard: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
