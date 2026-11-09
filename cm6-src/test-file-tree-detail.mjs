// test-file-tree-detail.mjs — 2026-11-09: the file tree's details line has one source, detailText(path), which the
// page also uses to leave room for the filled-in line when it sizes Project Files (sizeProjectFiles in index.html).
// Found in the browser: sized only for the empty line, selecting the only file grew the line 15 -> 39 px and hid part
// of the file's own row. Run: node cm6-src/test-file-tree-detail.mjs
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('ok    ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
};

const dom = new JSDOM(`<!doctype html><body>
  <select id="fileTreeFilter"></select><p id="fileTreeSummary"></p>
  <div id="fileTreeHost"></div><div id="fileTreeEmpty" hidden></div>
  <div id="fileTreeDetail" aria-live="polite"></div></body>`);
const w = dom.window;
globalThis.window = w;
globalThis.document = w.document;
globalThis.CSS = w.CSS && w.CSS.escape ? w.CSS : { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };

const { initFileTree } = await import(pathToFileURL(join(HERE, '..', 'filetree', 'file-tree.js')).href);
const entries = [
  { path: 'main.tex', role: 'document', text: 'x'.repeat(2048), isMain: true },
  { path: 'figures/plot.pdf', role: 'image', bytes: new Uint8Array(1024) },
];
const tree = initFileTree({ getEntries: () => entries, getSummaryText: () => '2 files.', getTargetPath: () => 'main.tex',
  onOpen: () => {}, onToggleInclude: () => {} });
tree.render({ expandNew: true });

ok('the tree offers detailText(path)', typeof tree.detailText === 'function');
const dt = (p) => (typeof tree.detailText === 'function' ? tree.detailText(p) : '(none)');
ok('a document that is the conversion target', dt('main.tex') === 'main.tex · document · 2.0 KB · conversion target', dt('main.tex'));
ok('an image in a folder', dt('figures/plot.pdf') === 'figures/plot.pdf · image · 1.0 KB', dt('figures/plot.pdf'));
ok('a folder, an unknown path, or nothing: empty', dt('figures') === '' && dt('nope.tex') === '' && dt(null) === '');

// Selecting a file shows exactly detailText's words in the details line (one source).
const detail = w.document.getElementById('fileTreeDetail');
const row = w.document.querySelector('li[data-path="figures/plot.pdf"]');
if (row) row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok('selecting a file shows the same words in the details line', !!row && detail.textContent === dt('figures/plot.pdf'),
  detail.textContent);

console.log(`──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
