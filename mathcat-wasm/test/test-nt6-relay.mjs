// N-T6 (PLAN-MATHCAT-NAVIGATION.md section 6), parent side (js/mathcat-proof.js):
// nav requests are relayed to the engine with their flags; replies carry the
// request's id and counter; goto (reserved, N13) is relayed; foreign sources and
// a disabled toggle are ignored; an engine without navigate() answers NVDA's
// message (N21); unknown commands are refused by the real engine (N14).
// The first plan's single message listener is kept (T4 checks it too).
// (Engine-side reloads are tested in test-nt1-nav-engine.mjs.)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { check, eq, done } from './lib.mjs';
import { initMathCATProof } from '../../js/mathcat-proof.js';
import { createMathCATEngine } from '../mathcat.js';

function fakeWin() {
  const listeners = [];
  return { listeners, addEventListener: (t, f) => t === 'message' && listeners.push(f), removeEventListener() {} };
}
function frameWin() { const got = []; return { got, postMessage: (m, o) => got.push({ m, o }) }; }
async function setup(engine) {
  const win = fakeWin(), fw = frameWin();
  const proof = initMathCATProof({ win, getPreviewFrame: () => ({ contentWindow: fw }),
    loadEngine: async () => engine, loadAgentSource: async () => '(function(){})();' });
  await proof.enable();
  return { win, fw, proof, send: (source, data) => win.listeners[0]({ source, data }) };
}
const calls = [];
const fake = { version: '0.7.2', nvda: '2026.2', speak: async () => ({ ok: true, text: 'S' }),
  navigate: async (mathml, command, opts) => { calls.push(['navigate', mathml, command, opts]);
    return { ok: true, text: 'N:' + command, nodeTag: 'astem-2', highlightTags: ['astem-2'], error: null }; },
  goTo: async (mathml, tag, opts) => { calls.push(['goTo', mathml, tag, opts]);
    return { ok: true, text: 'G:' + tag, nodeTag: tag, highlightTags: [tag], error: null }; } };

{
  const { win, fw, proof, send } = await setup(fake);
  eq('still one message listener (first plan)', win.listeners.length, 1);
  await send(fw, { type: 'mathcat-proof:nav', id: 7, nav: 3, command: 'MoveNext', mathml: 'M', fresh: true, entering: false });
  eq('nav relayed to engine.navigate', JSON.stringify(calls[0]), JSON.stringify(['navigate', 'M', 'MoveNext', { fresh: true, entering: false }]));
  const r = fw.got[0];
  check('reply posted', !!r);
  if (r) {
    eq('reply type', r.m.type, 'mathcat-proof:navspeech');
    eq('reply id', r.m.id, 7);
    eq('reply counter echoed', r.m.nav, 3);
    eq('reply fields', JSON.stringify([r.m.ok, r.m.text, r.m.nodeTag, r.m.highlightTags, r.m.version, r.m.nvda]),
      JSON.stringify([true, 'N:MoveNext', 'astem-2', ['astem-2'], '0.7.2', '2026.2']));
    eq('targetOrigin * (opaque frame)', r.o, '*');
  }
  await send(fw, { type: 'mathcat-proof:nav', id: 8, nav: 4, command: 'ZoomIn', mathml: 'M' });
  eq('missing flags arrive as false', JSON.stringify(calls[1] && calls[1][3]), JSON.stringify({ fresh: false, entering: false }));
  await send(fw, { type: 'mathcat-proof:goto', id: 9, nav: 5, tag: 'astem-4', mathml: 'M' });
  eq('goto relayed to engine.goTo', JSON.stringify(calls[2]), JSON.stringify(['goTo', 'M', 'astem-4', { fresh: false }]));
  eq('goto reply', fw.got[2] && fw.got[2].m.text, 'G:astem-4');
  const n = fw.got.length;
  await send({}, { type: 'mathcat-proof:nav', id: 10, nav: 6, command: 'ZoomIn', mathml: 'M' });
  eq('foreign source ignored', fw.got.length, n);
  proof.disable();
  await send(fw, { type: 'mathcat-proof:nav', id: 11, nav: 7, command: 'ZoomIn', mathml: 'M' });
  eq('disabled: ignored', fw.got.length, n);
  await send(fw, { type: 'mathcat-proof:speak', id: 12, mathml: 'M' });
  eq('disabled: speech ignored too (first plan)', fw.got.length, n);
}
{
  const old = { version: '0.7.2', nvda: '2026.2', speak: async () => ({ ok: true, text: 'S' }) };
  const { fw, send } = await setup(old);
  await send(fw, { type: 'mathcat-proof:nav', id: 1, nav: 1, command: 'ZoomIn', mathml: 'M' });
  const r = fw.got[0];
  eq('engine without navigate(): ok false', r && r.m.ok, false);
  eq("engine without navigate(): NVDA's message", r && r.m.text, 'Error in navigating math');
}
{
  const engine = await createMathCATEngine({ bytes: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
  const { fw, send } = await setup(engine);
  const mathml = '<math xml:lang="en"><mrow id="astem-1"><mi id="astem-2">x</mi><mo id="astem-3">+</mo><mn id="astem-4">1</mn></mrow></math>';
  await send(fw, { type: 'mathcat-proof:nav', id: 1, nav: 1, command: 'DeleteEverything', mathml, fresh: true });
  const r = fw.got[0];
  eq('real engine: unknown command refused (N14)', r && r.m.ok, false);
  eq("real engine: refusal shows NVDA's message", r && r.m.text, 'Error in navigating math');
  await send(fw, { type: 'mathcat-proof:nav', id: 1, nav: 2, command: 'ZoomIn', mathml, fresh: true, entering: true });
  eq('real engine: a real command works', fw.got[1] && fw.got[1].m.ok, true);
}
done('N-T6 relay');
