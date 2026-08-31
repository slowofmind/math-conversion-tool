// test-page-load.mjs — smoke test: does index.html's module script actually
// EXECUTE end to end after the modularity refactor?
//
// jsdom does not run <script type="module">, so this builds the real DOM
// from index.html (scripts parsed, not run), then imports the inline script
// as an ES module from the platform root so its './js/…' imports resolve.
// It catches exactly the class of failure the refactor risks: temporal dead
// zones, missing exports, bad import paths, null DOM lookups.
//
// It does NOT prove the page WORKS — Pandoc WASM, fetch and the CDN cannot
// run here. It proves the script gets to the end without throwing.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const PLAT = 'C:/Users/nim022/Desktop/mma-code/Accessible-STEM-Project/pandoc-for-math-conversion';
const html = readFileSync(join(PLAT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element',
                 'Node', 'Range', 'getComputedStyle', 'DOMParser', 'Blob',
                 'MutationObserver', 'requestAnimationFrame', 'FileReader',
                 'cancelAnimationFrame', 'localStorage', 'location', 'Event',
                 'CustomEvent', 'XMLSerializer', 'DocumentFragment']) {
  if (globalThis[k] === undefined && dom.window[k] !== undefined) {
    globalThis[k] = dom.window[k];
  }
}

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('   ok   ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? ' :: ' + d : '')); } };

// Pull out the inline module script and run it from the platform root.
const m = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(x => x[2].trim().length > 0);
ok('exactly one non-empty inline script', m.length === 1, String(m.length));
ok('it is a module script', /type\s*=\s*["']module["']/.test(m[0][1]), m[0][1]);

const tmp = join(PLAT, '_page-load-probe.mjs');
writeFileSync(tmp, m[0][2]);

let err = null;
try {
  await import(pathToFileURL(tmp).href);
} catch (e) {
  err = e;
}
unlinkSync(tmp);

ok('the module script executed without throwing', err === null,
   err ? (err.constructor.name + ': ' + err.message).slice(0, 200) : '');
if (err && err.stack) {
  console.log('\n--- stack ---\n' + err.stack.split('\n').slice(0, 6).join('\n'));
}

// Let deferred work settle, then look for wiring that only exists if the
// script ran to the end.
await new Promise(r => setTimeout(r, 300));

const D = dom.window.document;
ok('editor mounted into the page', !!D.querySelector('#aceEditor .cm-editor'));
ok('output source editor mounted', !!D.querySelector('#outputSource .cm-editor'));
ok('intent panel present', !!D.getElementById('intentPanel'));
ok('intent scan button present', !!D.getElementById('btnIntentScan'));
ok('cleanup pattern list rendered', !!D.getElementById('patternList'));
ok('format selects populated by init',
   D.getElementById('selFrom').options.length > 0
   || D.getElementById('statusText').textContent.length > 0);

console.log(`\npage load: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
