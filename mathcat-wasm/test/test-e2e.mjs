// E2E: real parent module + real engine + real agent, parent page and a
// srcdoc preview frame in jsdom (jsdom does not emulate the sandbox's opaque
// origin; the browser demo page covers that). Checks the popup shows exactly
// the golden speech-viewer text.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done, collapse } from './lib.mjs';
import { initMathCATProof } from '../../js/mathcat-proof.js';
import { createMathCATEngine } from '../mathcat.js';
import { AGENT_SRC } from './agent-env.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const quad = golden.rows.find(r => r.name === 'quadratic');
const parent = new JSDOM('<!DOCTYPE html><body><iframe id="previewFrame"></iframe></body>', { runScripts: 'dangerously' });
const frame = parent.window.document.getElementById('previewFrame');
const engine = await createMathCATEngine({ bytes: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
const proof = initMathCATProof({ win: parent.window, getPreviewFrame: () => frame,
  loadEngine: async () => engine, loadAgentSource: async () => AGENT_SRC });
await proof.enable();
const page = `<!DOCTYPE html><html lang="en"><body><p>Solve: ${quad.mathml}</p></body></html>`;
// jsdom does not implement srcdoc; write the same string into the frame.
const fdoc0 = frame.contentWindow.document;
fdoc0.open(); fdoc0.write(proof.injectForPreview(page)); fdoc0.close();
await new Promise(r => setTimeout(r, 50));
// jsdom leaves MessageEvent.source null; browsers set it. Shim postMessage on
// both sides so events carry the correct source, as in a browser.
const fwin = frame.contentWindow, pwin = parent.window;
pwin.postMessage = (data) => setTimeout(() => pwin.dispatchEvent(new pwin.MessageEvent('message', { data, source: fwin })), 0);
fwin.postMessage = (data) => setTimeout(() => fwin.dispatchEvent(new fwin.MessageEvent('message', { data, source: pwin })), 0);
const fdoc = frame.contentWindow.document;
check('agent script present in preview', !!fdoc.querySelector('script[data-astem-mathcat-agent]'));
fdoc.querySelector('math mi').dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles: true }));
let text = null;
for (let i = 0; i < 100 && !text; i++) {
  await new Promise(r => setTimeout(r, 20));
  const r = fdoc.querySelector('.ASTEM_MathCAT_Region > div');
  if (r && r.textContent !== '\u00a0') text = r.textContent;
}
eq('popup text == NVDA speech-viewer golden', text, collapse(quad.nvdaViewerRaw));
eq('meta line', (fdoc.querySelector('.ASTEM_MathCAT_Region_meta') || {}).textContent, 'MathCAT 0.7.2 \u00b7 NVDA 2026.2');
check('export string untouched', !page.includes('data-astem-mathcat-agent'));
done('E2E');
