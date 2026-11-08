// snippets/snippet-panel.js -- the snippet tool in the platform editor (sidebar section "Intent snippets").
// [CLAUDE 2026-11-08] Build step "integrate into the platform editor" [NICHOLAS 2026-11-08: "Build it this
// way", Alt+Shift+I]. The author selects math in the editor, presses Alt+Shift+I (or opens the section),
// finds a concept, presses Enter: the snippet core writes the kernel markup into the editor as ONE undoable
// edit. When the core cannot tell the parts, a form asks for them (typed), as on snippets/demo.html.
//
// Two layers:
//   createSnippetController({ core, editor })  no DOM; tested by snippets/test/test-panel.mjs
//   initSnippetPanel(ctx)                       wires the controller to the sidebar controls in index.html
// Reads only the slim copy (math-conversion/intent-concepts-slim.json) through the snippet core; the
// converter is untouched. Filters are session-only (no stored settings) [NICHOLAS 2026-11-08].
// Editor: the CM6 facade (getText, getSelection, getRange, replaceRange, selectRange, undo, focus).
import { createSnippetCore } from './src/snippet-core.js';

export const SLIM_URL = './math-conversion/intent-concepts-slim.json';
export const SHORTCUT = { key: 'I', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false };

/** The logic, with no page: { selection, search, apply, applyParts, undo, core }. */
export function createSnippetController({ core, editor }) {
  let lastEdit = null;   // { start, end } of the last text written, for messages

  function selection() {
    const s = editor.getSelection();
    return { start: s.from, end: s.to, text: editor.getRange(s.from, s.to) };
  }

  // write a 'ready' result into the editor as one undoable edit, and select what was written
  function write(r) {
    const span = editor.replaceRange(r.edit.start, r.edit.end, r.edit.text);
    editor.selectRange(span.from, span.to, { focusEditor: false });
    lastEdit = { start: span.from, end: span.to };
    return r;
  }

  /** Apply a concept to the editor's current selection. Returns the core's result
   *  ({status: 'ready'|'needs-operands'|'refused', ...}); 'ready' has already been written. */
  function apply(conceptKey) {
    const sel = selection();
    if (sel.start === sel.end) return { status: 'refused', reason: { code: 'no-selection', message: 'Select some math in the editor first.' } };
    const r = core.apply(editor.getText(), { start: sel.start, end: sel.end }, conceptKey);
    return r.status === 'ready' ? write(r) : r;
  }

  /** The author typed the parts (concept order). */
  function applyParts(conceptKey, texts) {
    const sel = selection();
    if (sel.start === sel.end) return { status: 'refused', reason: { code: 'no-selection', message: 'Select some math in the editor first.' } };
    const r = core.applyWithOperandTexts(editor.getText(), { start: sel.start, end: sel.end }, conceptKey, texts);
    return r.status === 'ready' ? write(r) : r;
  }

  return {
    core,
    selection,
    search: (query, opts = {}) => core.search(query, opts),
    apply,
    applyParts,
    undo: () => { lastEdit = null; return editor.undo(); },
    lastEdit: () => lastEdit,
  };
}

/** A plain-language line for the status region. */
export function describeResult(r) {
  if (r.status === 'ready') {
    const parts = r.operands.length ? ` Parts: ${r.operands.map(o => `${o.name} = ${o.text}`).join('; ')}.` : '';
    const warn = r.warnings?.length ? ` Check: ${r.warnings.map(w => w.message).join(' ')}` : '';
    return `Applied ${r.value}.${parts}${warn}`;
  }
  if (r.status === 'needs-operands') return `Mark the parts: ${r.reason.message}`;
  return `Not applied: ${r.reason.message}`;
}

/** Is this keydown the snippet shortcut (Alt+Shift+I)? */
export const isShortcut = e => e.altKey === SHORTCUT.altKey && e.shiftKey === SHORTCUT.shiftKey &&
  !e.ctrlKey && !e.metaKey && (e.key === 'I' || e.key === 'i' || e.code === 'KeyI');

/**
 * ctx: { editor, updateStatus(kind, text), openSection() (opens the sidebar on this section), fetchJson? }
 * Expects the controls in index.html's #prepSnippets section (ids snip*). Returns { controller, open }.
 */
export async function initSnippetPanel(ctx) {
  const $ = id => document.getElementById(id);
  const el = {
    toggle: $('prepSnippetsToggle'), panel: $('prepSnippetsPanel'), sel: $('snipSelection'), filter: $('snipFilter'),
    group: $('snipGroup'), source: $('snipSource'), notUsed: $('snipNotUsed'), rwm: $('snipRwm'), list: $('snipList'),
    count: $('snipCount'), apply: $('btnSnipApply'), back: $('btnSnipBack'), undo: $('btnSnipUndo'), status: $('snipStatus'),
    parts: $('snipParts'), partsWhy: $('snipPartsWhy'), arityWrap: $('snipArityWrap'), arity: $('snipArity'),
    fields: $('snipPartFields'), partsCancel: $('btnSnipPartsCancel'),
  };
  if (!el.panel) return null;
  const say = (msg, kind = 'ready') => {
    el.status.textContent = '';
    setTimeout(() => { el.status.textContent = msg; }, 30);   // re-announce the same text
    ctx.updateStatus?.(kind === 'warning' ? 'ready' : kind, msg);   // the status dot knows ready / loading / error
  };
  let controller = null;
  try {
    const data = await (ctx.fetchJson ? ctx.fetchJson(SLIM_URL) : fetch(SLIM_URL).then(r => r.json()));
    controller = createSnippetController({ core: createSnippetCore(data), editor: ctx.editor });
  } catch (e) {
    say(`The snippet tool could not load the concept list (${SLIM_URL}): ${e.message}`, 'error');
    for (const k of ['filter', 'group', 'source', 'notUsed', 'rwm', 'list', 'apply']) el[k].disabled = true;
    return null;
  }
  for (const g of controller.core.groups()) el.group.add(new Option(`${g.id} (${g.count})`, g.id));
  for (const s of controller.core.sources()) el.source.add(new Option(`${s.id} (${s.count})`, s.id));
  let pending = null;   // { key, forms } while the parts form is open

  function showSelection() {
    const s = controller.selection();
    el.sel.textContent = s.start === s.end ? 'Nothing is selected in the editor.' : `Selected: ${s.text}`;
  }
  function fill() {
    el.list.textContent = '';
    const hits = controller.search(el.filter.value, { group: el.group.value || null, source: el.source.value || null,
      includeNotUsed: el.notUsed.checked, includeReadsWithoutMarkup: el.rwm.checked, limit: 300 });
    for (const d of hits) {
      const ops = d.forms.length ? `${d.arityText} part${d.arityText === '1' ? '' : 's'}` : `parts: ${d.arityText}`;
      const tags = [d.hasKernelForm ? 'ready-made form' : '', d.readsWithoutMarkup ? 'reads correctly with no markup' : '',
        d.notUsed ? 'NOT USED' : ''].filter(Boolean).map(t => ` — ${t}`).join('');
      el.list.add(new Option(`${d.label} — ${ops}${tags}`, d.key));
    }
    if (el.list.options.length) el.list.selectedIndex = 0;
    el.count.textContent = String(el.list.options.length);
  }
  function closeParts() { pending = null; el.parts.hidden = true; el.fields.textContent = ''; }
  function partsForm(key, r) {
    pending = { key, forms: r.forms.length ? r.forms : [{ arity: 1, operands: ['a1'] }] };
    el.partsWhy.textContent = r.reason.message;
    el.arity.textContent = '';
    for (const f of pending.forms) el.arity.add(new Option(`${f.arity} (${f.operands.join(', ')})`, String(f.arity)));
    el.arityWrap.hidden = pending.forms.length < 2;
    const build = () => {
      const f = pending.forms.find(x => String(x.arity) === el.arity.value) ?? pending.forms[0];
      el.fields.textContent = '';
      f.operands.forEach((name, i) => {
        const id = `snipPart${i}`;
        const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = `Part ${i + 1} of ${f.operands.length} (${name})`;
        const inp = document.createElement('input'); inp.type = 'text'; inp.id = id; inp.spellcheck = false; inp.autocomplete = 'off';
        el.fields.append(lab, inp);
      });
    };
    el.arity.onchange = build;
    build();
    el.parts.hidden = false;
    say(describeResult(r), 'warning');
    el.fields.querySelector('input')?.focus();
  }
  function done(r) {
    closeParts();
    el.undo.disabled = false;
    say(describeResult(r), r.warnings?.length ? 'warning' : 'ready');
    ctx.editor.focus();
  }
  function apply() {
    const key = el.list.value;
    if (!key) { say('Choose a concept from the list first.', 'warning'); return; }
    const r = controller.apply(key);
    if (r.status === 'ready') return done(r);
    if (r.status === 'needs-operands') return partsForm(key, r);
    say(describeResult(r), 'error');
  }
  function open() {
    ctx.openSection?.();
    if (el.toggle && el.toggle.getAttribute('aria-expanded') !== 'true') el.toggle.click();
    closeParts();
    showSelection();
    if (!el.list.options.length) fill();
    el.filter.focus();
    el.filter.select();
  }

  for (const k of ['filter']) el[k].addEventListener('input', fill);
  for (const k of ['group', 'source', 'notUsed', 'rwm']) el[k].addEventListener('change', fill);
  el.filter.addEventListener('focus', showSelection);
  el.filter.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); el.list.focus(); }
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  });
  el.list.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  el.list.addEventListener('dblclick', apply);
  el.apply.addEventListener('click', apply);
  el.back.addEventListener('click', () => { closeParts(); ctx.editor.focus(); });
  el.undo.addEventListener('click', () => {
    if (controller.undo()) { say('The last snippet was undone.'); el.undo.disabled = true; } else say('Nothing to undo.', 'warning');
  });
  el.parts.addEventListener('submit', e => {
    e.preventDefault();
    if (!pending) return;
    const texts = [...el.fields.querySelectorAll('input')].map(i => i.value);
    const r = controller.applyParts(pending.key, texts);
    if (r.status === 'ready') return done(r);
    say(describeResult(r), 'error');
  });
  el.partsCancel.addEventListener('click', () => { closeParts(); say('Cancelled. Nothing was changed.'); el.filter.focus(); });
  el.panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeParts(); say('Back to the editor. Nothing was changed.'); ctx.editor.focus(); }
  });
  document.addEventListener('keydown', e => { if (isShortcut(e)) { e.preventDefault(); e.stopPropagation(); open(); } }, true);
  fill();
  return { controller, open };
}
