// T4 (plan section 5): parent-side wiring (js/mathcat-proof.js) and the
// engine's URL route.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done } from './lib.mjs';
import { initMathCATProof } from '../../js/mathcat-proof.js';
import { fetchWasmBytes } from '../mathcat.js';

// ---- fake window / frame -------------------------------------------------
function fakeWin() {
  const listeners = [];
  return { listeners, addEventListener: (t, f) => t === 'message' && listeners.push(f),
           removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
}
function fakeFrameWindow() { const got = []; return { got, postMessage: (m, o) => got.push({ m, o }) }; }
const win = fakeWin();
const frameWin = fakeFrameWindow();
const frame = { contentWindow: frameWin };
const fakeEngine = { version: '0.7.2', nvda: '2026.2',
  speak: async (mml) => mml === 'BAD' ? { ok: false, text: '', error: 'Invalid MathML input: x' } : { ok: true, text: 'spoken:' + mml } };
const AGENT = '(function(){/* agent */})();';
const proof = initMathCATProof({ win, getPreviewFrame: () => frame,
  loadEngine: async () => fakeEngine, loadAgentSource: async () => AGENT });

// ---- injection -----------------------------------------------------------
const html = '<html><body><p>x</p></body></html>';
eq('disabled: html untouched', proof.injectForPreview(html), html);
await proof.enable();
check('enabled', proof.isEnabled());
const inj = proof.injectForPreview(html);
check('agent inserted before </body>', inj.includes(AGENT + '</' + 'script></body>'), inj);
eq('exactly one agent', inj.split('data-astem-mathcat-agent').length - 1, 1);
check('no </body>: appended', proof.injectForPreview('<p>x</p>').endsWith('</' + 'script>'));
const upper = proof.injectForPreview('<BODY>a</BODY>');
check('case-insensitive </BODY>', upper.indexOf('<script') < upper.indexOf('</BODY>'), upper);
const nonAscii = proof.injectForPreview('<body>\u0130\u0130\u0130</body>');
check('non-ASCII before </body> keeps position', nonAscii.endsWith('</' + 'script></body>'), nonAscii);
proof.disable();
eq('disabled again: untouched', proof.injectForPreview(html), html);
await proof.enable();

// ---- unsafe agent source is refused -------------------------------------
for (const bad of ['x</' + 'script>y', 'a<!--b', 'X</SCRIPT']) {
  const p2 = initMathCATProof({ win: fakeWin(), getPreviewFrame: () => frame,
    loadEngine: async () => fakeEngine, loadAgentSource: async () => bad });
  let threw = false; try { await p2.enable(); } catch { threw = true; }
  check(`unsafe agent refused: ${JSON.stringify(bad)}`, threw);
}

// ---- the REAL agent file must be inline-safe (M16) -----------------------
const realAgent = readFileSync(new URL('../../js/mathcat-proof-agent.js', import.meta.url), 'utf8');
check('real agent has no </script or <!--', !/<\/script|<!--/i.test(realAgent));

// ---- messages ------------------------------------------------------------
const listener = win.listeners[0];
check('one message listener installed', win.listeners.length === 1);
await listener({ source: {}, data: { type: 'mathcat-proof:speak', id: 1, mathml: 'M' } });
eq('foreign source ignored', frameWin.got.length, 0);
await listener({ source: frameWin, data: { type: 'something-else', id: 2 } });
eq('other message types ignored', frameWin.got.length, 0);
await listener({ source: frameWin, data: { type: 'mathcat-proof:speak', id: 3, mathml: 'M' } });
eq('reply posted to the frame', frameWin.got.length, 1);
const rep = frameWin.got[0];
eq('reply type', rep.m.type, 'mathcat-proof:speech');
eq('reply id', rep.m.id, 3);
eq('reply text', rep.m.text, 'spoken:M');
eq('reply version', rep.m.version, '0.7.2');
eq('reply nvda', rep.m.nvda, '2026.2');
eq('targetOrigin * (opaque frame)', rep.o, '*');
await listener({ source: frameWin, data: { type: 'mathcat-proof:speak', id: 4, mathml: 'BAD' } });
eq('error reply ok=false', frameWin.got[1].m.ok, false);
proof.disable();
await listener({ source: frameWin, data: { type: 'mathcat-proof:speak', id: 5, mathml: 'M' } });
eq('disabled: requests ignored', frameWin.got.length, 2);

// ---- engine URL route (F10 route b / platform loading pattern) ----------
const binPath = new URL('../mathcat-wasm.bin', import.meta.url);
const server = createServer((req, res) => {
  if (!req.url.startsWith('/mathcat-wasm.bin')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(readFileSync(binPath));
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/mathcat-wasm.bin?sha1=x`;
const bytes = await fetchWasmBytes(url);
const want = gunzipSync(readFileSync(binPath));
check('url route: bytes equal gunzip(bin)', Buffer.from(bytes).equals(want));
let threw404 = false;
try { await fetchWasmBytes(url.replace('/mathcat-wasm.bin', '/missing')); } catch { threw404 = true; }
check('url route: fetch failure throws', threw404);
server.close();
done('T4 messaging');
