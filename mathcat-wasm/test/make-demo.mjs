// make-demo.mjs — builds mathcat-proof-demo.html (plan Phase C, T7) from the
// REAL shipped files: mathcat-wasm/{mathcat_wasm.js, mathcat.js,
// mathcat-wasm.bin}, js/mathcat-proof.js, js/mathcat-proof-agent.js and the
// fixture set. Nothing is re-implemented for the demo.
//   node make-demo.mjs  ->  ../../mathcat-proof-demo.html
// Open it locally (file://) or from the hosted site. From the hosted site,
// placed at the repo root, T7 also tests fetching mathcat-wasm/mathcat-wasm.bin
// from inside a sandboxed frame (route (b), plan V9).
import { readFileSync, writeFileSync } from 'node:fs';

const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const golden = JSON.parse(rd('./golden.json')).rows;
const payload = {
  glue: rd('../mathcat_wasm.js'),
  engine: rd('../mathcat.js'),
  proof: rd('../../js/mathcat-proof.js'),
  agent: rd('../../js/mathcat-proof-agent.js'),
  binB64: readFileSync(new URL('../mathcat-wasm.bin', import.meta.url)).toString('base64'),
  // Expected text = the NVDA-rebuilt form (root attributes dropped), since
  // that is what the agent sends; malformed MathML is table-only, because the
  // browser's HTML parser repairs it before anything can read it.
  fixtures: golden.map(({ name, mathml, nvdaViewerRaw, nvdaError }) => ({ name, mathml, viewerRaw: nvdaViewerRaw, error: nvdaError })),
  buildInfo: JSON.parse(rd('../BUILD-INFO.json')),
};
// JSON inside <script type="application/json">: neutralise "</" and "<!--".
const json = JSON.stringify(payload).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MathCAT speech proofing demo (Phase C)</title>
<style>
  body { font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 60rem; margin: 0 auto; padding: 1rem 1.25rem 3rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 1.75rem; }
  iframe { width: 100%; height: 26rem; border: 1px solid #c9ced8; border-radius: 6px; background: #fff; }
  button { font: inherit; padding: .35rem .8rem; border: 1px solid #2b426e; border-radius: 6px; background: #fff; color: #2b426e; cursor: pointer; }
  button[aria-pressed="true"] { background: #2b426e; color: #fff; }
  button:focus-visible { outline: 3px solid #a51c30; outline-offset: 2px; }
  #status { color: #5a5f6a; } pre { background: #f5f5f7; padding: .6rem; border-radius: 6px; white-space: pre-wrap; }
  table { border-collapse: collapse; font-size: .9rem; } td, th { border: 1px solid #c9ced8; padding: .25rem .5rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<h1>MathCAT speech proofing demo</h1>
<p id="status" role="status">Loading MathCAT…</p>
<p><button id="toggle" type="button" aria-pressed="false" disabled>MathCAT popups: off</button></p>
<p>With popups on: in the MathJax preview, focus or click an equation; in the plain-MathML preview, click an equation
(click elsewhere or press Escape to close). Both previews are <code>sandbox="allow-scripts"</code> srcdoc frames,
as in the platform.</p>

<h2>MathJax 4.1.3 preview (hidden MathML, as "MathJax (script tag)")</h2>
<iframe id="fMathJax" sandbox="allow-scripts" title="MathJax preview"></iframe>
<h2>Plain MathML preview (as "MathML (Enhanced)")</h2>
<iframe id="fPlain" sandbox="allow-scripts" title="Plain MathML preview"></iframe>

<h2>T7: loading MathCAT inside a sandboxed frame</h2>
<p><button id="t7" type="button" disabled>Run sandbox loading test</button></p>
<pre id="t7out" aria-live="polite">Not run.</pre>

<h2>Expected text (golden)</h2>
<details><summary>NVDA 2026.2 speech-viewer text, OneCore voice, per fixture</summary>
<table><thead><tr><th>Fixture</th><th>Expected popup text</th></tr></thead><tbody id="goldenRows"></tbody></table>
</details>

<script type="application/json" id="payload">${json}</script>
<script type="module">
const P = JSON.parse(document.getElementById('payload').textContent);
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const collapse = (s) => s.split(/\\s+/).join(' ').trim();
const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Load the real modules from blob URLs (engine import rewritten to the glue).
const glueUrl = blobUrl(P.glue);
const engineSrc = P.engine.replace("from './mathcat_wasm.js'", "from '" + glueUrl + "'");
const engineMod = await import(blobUrl(engineSrc));
const proofMod = await import(blobUrl(P.proof));
const raw = await gunzip(b64(P.binB64));
const engine = await engineMod.createMathCATEngine({ bytes: raw });
status('MathCAT ' + engine.version + ' loaded (NVDA ' + engine.nvda + ' settings, OneCore speech-viewer text). Popups are off.');

for (const f of P.fixtures) {
  const tr = document.createElement('tr');
  const a = document.createElement('td'); a.textContent = f.name;
  const b = document.createElement('td'); b.textContent = f.error ? 'MathCAT error: ' + f.error.split('\\n')[0] : collapse(f.viewerRaw);
  tr.append(a, b); $('goldenRows').append(tr);
}
const body = P.fixtures.filter((f) => !f.error).map((f) => '<p><b>' + f.name + '</b>: ' + f.mathml + '</p>').join('\\n');
const pages = {
  fMathJax: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>MathJax preview</title>'
    + '<script>MathJax = { loader: { load: ["a11y/assistive-mml"] }, options: { menuOptions: { settings: { assistiveMml: true } } } };</' + 'script>'
    + '<script defer src="https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-mml-chtml.js"></' + 'script>'
    + '</head><body>' + body + '</body></html>',
  fPlain: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Plain MathML preview</title></head><body>'
    + body + '</body></html>',
};
const proofs = {};
for (const id of Object.keys(pages)) {
  proofs[id] = proofMod.initMathCATProof({
    getPreviewFrame: () => $(id),
    loadEngine: async () => engine,
    loadAgentSource: async () => P.agent,
    updateLog: (lvl, t) => console.log('[' + id + '] ' + t),
  });
  $(id).srcdoc = pages[id];
}
let on = false;
$('toggle').disabled = false; $('t7').disabled = false;
$('toggle').addEventListener('click', async () => {
  on = !on;
  for (const id of Object.keys(pages)) {
    if (on) await proofs[id].enable(); else proofs[id].disable();
    $(id).srcdoc = proofs[id].injectForPreview(pages[id]);   // re-render (M3)
  }
  $('toggle').setAttribute('aria-pressed', String(on));
  $('toggle').textContent = 'MathCAT popups: ' + (on ? 'on (' + proofs.fPlain.label() + ')' : 'off');
  status(on ? 'Popups on. Previews re-rendered with the proofing agent.' : 'Popups off. Previews re-rendered without the agent.');
});

// ---- T7: can MathCAT start INSIDE a sandboxed opaque-origin frame? --------
$('t7').addEventListener('click', () => {
  $('t7out').textContent = 'Running…';
  const hosted = /^https?:$/.test(location.protocol);
  const binUrl = hosted ? new URL('mathcat-wasm/mathcat-wasm.bin', location.href).href : null;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); frame.title = 'T7 sandbox test'; frame.style.height = '2rem';
  const probe = '<!DOCTYPE html><html><body><script>' +
    'window.addEventListener("message", async (e) => {' +
    '  if (e.source !== parent) return; const d = e.data; const out = [];' +
    '  const blob = (s) => URL.createObjectURL(new Blob([s], { type: "text/javascript" }));' +
    '  let mod = null;' +
    '  try { const g = blob(d.glue); mod = await import(blob(d.engine.replace("from \\'./mathcat_wasm.js\\'", "from \\'" + g + "\\'")));' +
    '        out.push({ step: "import modules from blob: URLs", ok: true }); }' +
    '  catch (err) { out.push({ step: "import modules from blob: URLs", ok: false, detail: String(err) }); }' +
    '  if (mod) {' +
    '    try { const eng = await mod.createMathCATEngine({ bytes: d.bytes }); const r = await eng.speak(d.mathml);' +
    '          out.push({ step: "route (a): bytes posted in, speak()", ok: r.ok && r.text === d.expect, detail: r.text }); }' +
    '    catch (err) { out.push({ step: "route (a): bytes posted in, speak()", ok: false, detail: String(err) }); }' +
    '    if (d.binUrl) {' +
    '      try { const b = await mod.fetchWasmBytes(d.binUrl); out.push({ step: "route (b): fetch " + d.binUrl, ok: b.length === d.bytes.byteLength, detail: b.length + " bytes" }); }' +
    '      catch (err) { out.push({ step: "route (b): fetch " + d.binUrl, ok: false, detail: String(err) }); }' +
    '    } else out.push({ step: "route (b)", ok: null, detail: "skipped: open this page from the hosted site to test fetching" });' +
    '  }' +
    '  parent.postMessage({ t7: out }, "*");' +
    '});' +
    'parent.postMessage({ t7ready: true }, "*");' +
    '</' + 'script></body></html>';
  const quad = P.fixtures.find((f) => f.name === 'quadratic');
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data && e.data.t7ready) {
      frame.contentWindow.postMessage({ glue: P.glue, engine: P.engine, bytes: raw.slice().buffer, binUrl,
        mathml: quad.mathml, expect: collapse(quad.viewerRaw) }, '*');
    } else if (e.data && e.data.t7) {
      window.removeEventListener('message', onMsg);
      $('t7out').textContent = e.data.t7.map((r) => (r.ok === null ? 'SKIP ' : r.ok ? 'PASS ' : 'FAIL ') + r.step + (r.detail ? '\\n     ' + r.detail : '')).join('\\n');
      frame.remove();
    }
  };
  window.addEventListener('message', onMsg);
  frame.srcdoc = probe;
  document.body.append(frame);
});
</script>
</body>
</html>
`;
writeFileSync(new URL('../../mathcat-proof-demo.html', import.meta.url), html);
console.log('wrote mathcat-proof-demo.html', (html.length / 1024 / 1024).toFixed(2), 'MB');
