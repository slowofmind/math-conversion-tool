// snippets/test/test-panel.mjs -- the snippet panel's controller (no page) against the real slim copy.
// [CLAUDE 2026-11-08] Editor integration step. A stand-in editor with the facade's methods (getText,
// getSelection, getRange, replaceRange, selectRange, undo, focus) records what the panel does to the document.
// Run: node test/test-panel.mjs
import { createSnippetController, describeResult, isShortcut } from '../snippet-panel.js';
import { createSnippetCore } from '../src/snippet-core.js';
import { loadExport } from './lib/fixtures.mjs';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => { if (c) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); } };
const R = String.raw;

function fakeEditor(text) {
  let doc = text, sel = { from: 0, to: 0 };
  const history = [];
  return {
    getText: () => doc, getSelection: () => ({ ...sel }), getRange: (f, t) => doc.slice(f, t),
    replaceRange(f, t, ins) { history.push(doc); doc = doc.slice(0, f) + ins + doc.slice(t); return { from: f, to: f + ins.length }; },
    selectRange(f, t) { sel = { from: f, to: t ?? f }; },
    undo() { if (!history.length) return false; doc = history.pop(); return true; },
    focus() {},
    select(s) { const i = doc.indexOf(s); sel = { from: i, to: i + s.length }; },
  };
}
const core = createSnippetCore(loadExport());

{ // ready: written as one edit, and what was written is selected
  const ed = fakeEditor(R`Change: $\Delta x$ here.`);
  ed.select(R`\Delta x`);
  const c = createSnippetController({ core, editor: ed });
  const r = c.apply('change');
  const want = R`\MathMLintent{change:prefix($quantity)}{\Delta \MathMLarg{quantity}{x}}`;
  ok(r.status === 'ready' && ed.getText() === R`Change: $` + want + R`$ here.`, 'apply writes the kernel markup in place', ed.getText());
  ok(ed.getRange(ed.getSelection().from, ed.getSelection().to) === want, 'the written markup is selected afterwards');
  ok(/^Applied change:prefix\(\$quantity\)\. Parts: quantity = x\.$/.test(describeResult(r)), 'status line names the intent and the parts', describeResult(r));
  ok(c.undo() && ed.getText() === R`Change: $\Delta x$ here.`, 'undo restores the document');
}
{ // nothing selected
  const ed = fakeEditor(R`$\Delta x$`);
  const r = createSnippetController({ core, editor: ed }).apply('change');
  ok(r.status === 'refused' && r.reason.code === 'no-selection' && ed.getText() === R`$\Delta x$`, 'no selection: refused, document unchanged');
}
{ // needs parts, then the author types them
  const ed = fakeEditor(R`$x \to a^{+}$`);
  ed.select(R`x \to a^{+}`);
  const c = createSnippetController({ core, editor: ed });
  const r = c.apply('tends-to-from-above');
  ok(r.status === 'needs-operands' && ed.getText() === R`$x \to a^{+}$`, 'needs parts: document unchanged until the author marks them', `${r.status} ${r.reason?.code}`);
  ok(/^Mark the parts:/.test(describeResult(r)), 'status line asks for the parts');
  const r2 = c.applyParts('tends-to-from-above', ['x', 'a']);
  ok(r2.status === 'ready' && ed.getText() === R`$\MathMLintent{tends-to-from-above:infix($a1,$a2)}{\MathMLarg{a1}{x} \to \MathMLarg{a2}{a}^{+}}$`,
    'typed parts are written', ed.getText());
}
{ // refused: not used
  const ed = fakeEditor(R`$\limsup a_n$`);
  ed.select(R`\limsup a_n`);
  const r = createSnippetController({ core, editor: ed }).apply('limit-sup');
  ok(r.status === 'refused' && r.reason.code === 'not-used' && /^Not applied:/.test(describeResult(r)), 'a not-used concept is refused with its reason');
}
{ // search: labelled concepts hidden unless asked
  const c = createSnippetController({ core, editor: fakeEditor('') });
  ok(!c.search('plus').some(d => d.key === 'core:plus') && c.search('plus', { includeReadsWithoutMarkup: true }).some(d => d.key === 'core:plus'),
    'search hides "reads correctly with no markup" concepts unless asked');
}
{ // the shortcut
  ok(isShortcut({ key: 'I', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }), 'Alt+Shift+I is the shortcut');
  ok(!isShortcut({ key: 'I', altKey: false, shiftKey: true, ctrlKey: true, metaKey: false }), 'Ctrl+Shift+I (Chrome developer tools) is not');
  ok(!isShortcut({ key: 'i', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }), 'Alt+I is not');
}
console.log(`\ntest-panel: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
