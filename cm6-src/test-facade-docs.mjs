// test-facade-docs.mjs — v0.5 multi-document behaviour.
//
// Two things must hold, and both have bitten real projects:
//   1. Switching away must capture the state AS IT IS NOW. Reusing the
//      state a document was created with silently discards every edit —
//      the exact mistake reported on the CodeMirror forum.
//   2. Decoration/mark state must be PER DOCUMENT. makeDecoField and
//      makeMarkField keep working data in closures, so a shared pair
//      would let one file's marks render on another.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="host"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
// node 26 exposes navigator as a getter-only global; skip it.
for (const k of ['Node', 'Element', 'HTMLElement', 'Range', 'DOMParser',
                 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame']) {
  if (dom.window[k] !== undefined) global[k] = dom.window[k];
}

const { createEditor, CM6_BUNDLE_VERSION } =
  await import('../codemirror/cm6-editor.js');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  FAIL ${n} ${d}`); } };
const eq = (n, g, w) => ok(n, g === w, `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const host = document.getElementById('host');
const ed = createEditor(host, { language: 'latex' });

console.log(`\ncm6 facade v${CM6_BUNDLE_VERSION} — multi-document\n`);

// ── edits survive a round trip ─────────────────────────────────────
ed.openDocument('main.tex', 'MAIN original\n');
eq('current id', ed.currentDocumentId(), 'main.tex');
eq('text loaded', ed.getText(), 'MAIN original\n');

ed.replaceRange
  ? ed.replaceRange(0, 4, 'EDITED')      // offset API exists in v0.4+
  : null;
ok('edit applied', ed.getText().startsWith('EDITED'), ed.getText());
const editedMain = ed.getText();

ed.openDocument('ch1.tex', 'CHAPTER one\n');
eq('switched', ed.currentDocumentId(), 'ch1.tex');
eq('new document text', ed.getText(), 'CHAPTER one\n');

// THE bug this API exists to avoid.
ed.openDocument('main.tex');
eq('edits survived the round trip', ed.getText(), editedMain);

// ── undo survives switching ────────────────────────────────────────
ok('undo available after returning', ed.undo() === true);
eq('undo restored pre-edit text', ed.getText(), 'MAIN original\n');
ed.redo();
eq('redo works after a switch', ed.getText(), editedMain);

// ── peek without switching ─────────────────────────────────────────
eq('peek other document', ed.peekDocument('ch1.tex'), 'CHAPTER one\n');
eq('still on main', ed.currentDocumentId(), 'main.tex');
eq('peek unknown is null', ed.peekDocument('nope.tex'), null);
ok('hasDocument', ed.hasDocument('ch1.tex') && !ed.hasDocument('nope.tex'));
eq('documentIds', ed.documentIds().sort().join(','), 'ch1.tex,main.tex');

// ── marks do NOT bleed between documents ───────────────────────────
// The shared-closure bug: mark document A, switch to B, and B must be
// clean. Then return to A and its mark must still be there.
const markCount = () => host.querySelectorAll('.doctest-mark').length;

ed.openDocument('main.tex');
ed.markRanges([{ from: 0, to: 6 }], 'doctest-mark');
ok('mark rendered on main', markCount() > 0, String(markCount()));

ed.openDocument('ch1.tex');
eq('ch1 has NO marks from main', markCount(), 0);

ed.markRanges([{ from: 0, to: 7 }], 'doctest-mark');
ok('ch1 has its own mark', markCount() > 0);

ed.openDocument('main.tex');
ok('main mark still present after round trip', markCount() > 0, String(markCount()));

// ── diagnostics are per document too ───────────────────────────────
const tintCount = () => host.querySelectorAll('.pandoc-error-line').length;
ed.setDiagnostics([{ line: 1, startCol: 1, endCol: 4, severity: 'error', message: 'x' }]);
ok('diagnostic tint on main', tintCount() > 0, String(tintCount()));
ed.openDocument('ch1.tex');
eq('ch1 has NO diagnostic from main', tintCount(), 0);
ed.openDocument('main.tex');
ok('main diagnostic survived', tintCount() > 0);

// ── replaceAll is undoable (restore-a-checkpoint primitive) ────────
ed.openDocument('rev.tex', 'BASELINE\n');
const baseline = ed.getText();
ed.replaceAll('EXPERIMENT\n');
eq('replaceAll changed the text', ed.getText(), 'EXPERIMENT\n');
ok('replaceAll is undoable', ed.undo() === true);
eq('undo returned to the baseline', ed.getText(), baseline);
// setText, by contrast, is NOT undoable — that is why restore uses replaceAll.
ed.setText('WIPED\n');
eq('setText replaced', ed.getText(), 'WIPED\n');
ok('setText cleared history', ed.undo() === false);

// ── REGRESSION: blanking the editor must not destroy the open doc ──
// clearBinaryInput() used to call setText(''), which wrote an EMPTY
// state into the CURRENT document's record. Symptoms reported from
// testing: switching back showed an empty editor, or showed the text
// but with Ctrl+Z dead. detachDocument() must save, then blank.
ed.openDocument('keep.tex', 'KEEP ME\n');
ed.replaceAll('KEEP ME EDITED\n');
ed.detachDocument();
eq('view is blank after detach', ed.getText(), '');
eq('no current document', ed.currentDocumentId(), null);
ed.openDocument('keep.tex');
eq('text survived the blanking', ed.getText(), 'KEEP ME EDITED\n');
ok('undo survived the blanking', ed.undo() === true);
eq('undo restored the pre-edit text', ed.getText(), 'KEEP ME\n');

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
