// test-facade.mjs — headless tests for the CM6 facade's offset API (v0.4).
//
//   cd cm6-src && npm test
//
// Runs the BUILT bundle (../codemirror/cm6-editor.js) inside jsdom, so it
// exercises the artefact index.html actually loads, not the sources. jsdom
// has no layout engine, so this covers document/state/DOM behaviour —
// offsets, edits, undo, decoration rendering and mapping — and NOT pixel
// geometry, which needs a real browser (codemirror/cm6-test.html).
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="host"></div></body></html>',
  { pretendToBeVisual: true });

for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element',
                 'Node', 'Range', 'getComputedStyle', 'DOMParser',
                 'MutationObserver', 'requestAnimationFrame',
                 'cancelAnimationFrame']) {
  if (globalThis[k] === undefined) globalThis[k] = dom.window[k];
}

const { createEditor, CM6_BUNDLE_VERSION } =
  await import('../codemirror/cm6-editor.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('   ok   ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? ' :: ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const DOC = 'line one\nline two has $|x|$ in it\nline three\nlast line';
const host = dom.window.document.getElementById('host');
const ed = createEditor(host, { initialText: DOC, language: 'latex' });

// Decorations render as spans carrying our class. A mark spanning lines is
// rendered as one span per line, so join them to recover the marked text.
// Checking TEXT rather than offsets proves the mark sits over the right
// characters after an edit, not merely that some number changed.
function markedText() {
  const els = host.querySelectorAll('.intent-finding');
  return els.length ? Array.from(els).map(e => e.textContent).join('') : null;
}
const flat = (s) => s.split('\n').join('');

console.log(`\ncm6 facade v${CM6_BUNDLE_VERSION}\n`);
ok('bundle version is 0.4.0', CM6_BUNDLE_VERSION === '0.4.0', CM6_BUNDLE_VERSION);

// ── offsets and conversion ────────────────────────────────────────────
ok('docLength matches the source string', ed.docLength() === DOC.length,
   `${ed.docLength()} vs ${DOC.length}`);
ok('getText round-trips', ed.getText() === DOC);

const barsAt = DOC.indexOf('|x|');
eq('getRange extracts the right span', ed.getRange(barsAt, barsAt + 3), '|x|');
const lc = ed.lineColAt(barsAt);
ok('lineColAt lands on line 2', lc.line === 2, JSON.stringify(lc));
ok('offsetAt inverts lineColAt', ed.offsetAt(lc.line, lc.col) === barsAt,
   `${ed.offsetAt(lc.line, lc.col)} vs ${barsAt}`);
eq('lineColAt(0) is line 1 col 1', ed.lineColAt(0), { line: 1, col: 1 });
ok('offsets clamp instead of throwing',
   ed.getRange(-50, 99999) === DOC && ed.lineColAt(99999).line === 4);

// ── replaceRange preserves undo history ───────────────────────────────
const span = ed.replaceRange(barsAt, barsAt + 3, '\\abs{x}');
eq('replaceRange reports the new span', span, { from: barsAt, to: barsAt + 7 });
ok('document now contains the macro', ed.getText().includes('\\abs{x}'));
ok('surrounding text untouched',
   ed.getText().startsWith('line one\n') && ed.getText().endsWith('last line'));

const afterEdit = ed.getText();
ok('undo() reports it did something', ed.undo() === true);
ok('undo restores the pre-edit text (history preserved)', ed.getText() === DOC,
   JSON.stringify(ed.getText().slice(0, 40)));
ed.redo();
ok('redo re-applies it', ed.getText() === afterEdit);

// The contrast that justifies replaceRange existing at all.
ed.setText(DOC);
ok('setText resets history, so it is wrong for apply', ed.undo() === false);

// ── replaceRanges: one transaction, one undo step ─────────────────────
ed.setText(DOC);
const a = DOC.indexOf('line one');
const b = DOC.indexOf('line three');
const n = ed.replaceRanges([
  { from: b, to: b + 10, insert: 'LINE THREE' },   // deliberately out of order
  { from: a, to: a + 8, insert: 'LINE ONE' },
]);
ok('replaceRanges applied both', n === 2, String(n));
ok('both replacements present',
   ed.getText().includes('LINE ONE') && ed.getText().includes('LINE THREE'));
ed.undo();
ok('a single undo reverts BOTH (one transaction)', ed.getText() === DOC);

let threw = null;
try {
  ed.replaceRanges([{ from: 0, to: 10, insert: 'x' },
                    { from: 5, to: 15, insert: 'y' }]);
} catch (e) { threw = e; }
ok('overlapping spans throw', threw !== null && /overlapping/.test(threw.message),
   threw && threw.message);
ok('document unchanged after the throw', ed.getText() === DOC);

// ── marks: multi-line, and they follow edits ──────────────────────────
ed.setText(DOC);
const mFrom = DOC.indexOf('two');
const mTo = DOC.indexOf('three') + 5;      // spans lines 2 and 3
const marked = DOC.slice(mFrom, mTo);
ok('the test span really does cross a line boundary', marked.includes('\n'));

const tok = ed.markRanges([{ from: mFrom, to: mTo }], 'intent-finding');
ok('markRanges returns a token', typeof tok === 'string' && tok.startsWith('mk-'));
eq('a MULTI-LINE mark renders over the right text', markedText(), flat(marked));
ok('it rendered as more than one span (one per line)',
   host.querySelectorAll('.intent-finding').length > 1,
   String(host.querySelectorAll('.intent-finding').length));

ed.replaceRange(0, 0, 'XXXXX');            // insert BEFORE the mark
eq('mark still covers the same text after an edit before it',
   markedText(), flat(marked));

const inner = ed.getText().indexOf('has');
ed.replaceRange(inner, inner + 3, 'contains');   // edit INSIDE the mark
ok('mark grew with an edit inside it',
   markedText() === flat(marked).replace('has', 'contains'), markedText());

ed.clearMarks(tok);
ok('clearMarks removes it', markedText() === null);

ed.setText(DOC);
ed.markRanges([{ from: 0, to: 4 }], 'intent-finding');
ok('mark placed again', markedText() === 'line', markedText());
ed.setText('a completely different document');
ok('setText drops stale marks', markedText() === null);

// ── selectRange ───────────────────────────────────────────────────────
ed.setText(DOC);
ed.selectRange(barsAt, barsAt + 3, { focusEditor: false });
const sel = ed.view.state.selection.main;
eq('selectRange sets the selection', { from: sel.from, to: sel.to },
   { from: barsAt, to: barsAt + 3 });

// ── v0.3 API must still behave (regression) ───────────────────────────
ed.setText(DOC);
ok('getLine still works', ed.getLine(2) === 'line two has $|x|$ in it');
ok('lineCount still works', ed.lineCount() === 4);
ok('getCursor still works', typeof ed.getCursor().line === 'number');

ed.setDiagnostics([{ line: 2, startCol: 1, endCol: 5, severity: 'warn',
                     message: 'test' }]);
ok('setDiagnostics tints the line',
   host.querySelectorAll('.pandoc-warning-line').length === 1,
   String(host.querySelectorAll('.pandoc-warning-line').length));
ed.clearDiagnostics();
ok('clearDiagnostics removes the tint',
   host.querySelectorAll('.pandoc-warning-line').length === 0);

const hl = ed.highlightRanges([{ line: 1, startCol: 1, endCol: 5 }],
                              'cleanup-preview');
ok('highlightRanges still renders',
   host.querySelectorAll('.cleanup-preview').length === 1,
   String(host.querySelectorAll('.cleanup-preview').length));
ed.clearHighlights(hl);
ok('clearHighlights still works',
   host.querySelectorAll('.cleanup-preview').length === 0);

// Line/col highlights and offset marks must coexist without interfering.
const hl2 = ed.highlightRanges([{ line: 1, startCol: 1, endCol: 5 }],
                               'cleanup-preview');
const mk2 = ed.markRanges(
  [{ from: DOC.indexOf('three'), to: DOC.indexOf('three') + 5 }],
  'intent-finding');
ok('both decoration systems render together',
   host.querySelectorAll('.cleanup-preview').length === 1 &&
   markedText() === 'three');
ed.clearHighlights(hl2);
ed.clearMarks(mk2);

ed.setLanguage('markdown'); ed.setLanguage('latex');
ed.setReadOnly(true); ed.setReadOnly(false);
ed.setLineWrap(false); ed.setLineWrap(true);
ok('config setters do not throw', true);
ok('reconfiguration preserved the text', ed.getText() === DOC);

console.log(`\nfacade: ${pass} passed, ${fail} failed`);
ed.destroy();
process.exit(fail === 0 ? 0 : 1);
