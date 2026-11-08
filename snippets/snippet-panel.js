// snippets/snippet-panel.js -- the snippet tool in the platform editor (sidebar section "Intent snippets").
// [CLAUDE 2026-11-08] Build step "integrate into the platform editor" [NICHOLAS 2026-11-08: "Build it this
// way"; shortcut Ctrl+Period, chosen after Alt+Shift+I clashed]. The author selects math in the editor, presses
// Ctrl+Period (or opens the section), finds a concept, presses Enter: the snippet core writes the kernel markup
// into the editor as ONE undoable
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
// [CLAUDE 2026-11-08] Ctrl+Period [NICHOLAS 2026-11-08], replacing Alt+Shift+I, which Chrome and Edge use for
// "Send feedback" (and Left Alt+Shift switches Windows keyboard languages). Checked free in: the editor's
// CodeMirror keymaps, Chrome, Edge, Windows and macOS shortcut lists, NVDA's key reference, JAWS keystrokes.
// Same meaning as VS Code's Ctrl+Period: actions for what is selected. Control on a Mac too (not Command).
export const SHORTCUT = { key: '.', code: 'Period', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, label: 'Ctrl+Period' };

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

  // [CLAUDE 2026-11-08] `target` = the selection remembered when the shortcut was pressed. NVDA live check:
  // opening the sidebar collapsed the editor's selection, so the panel applies to the remembered span, after
  // checking the text there is still what was selected (else it asks for a new selection).
  function resolve(target) {
    if (!target) return selection();
    if (editor.getRange(target.start, target.end) !== target.text) return { ...target, stale: true };
    return target;
  }
  const stale = { status: 'refused', reason: { code: 'selection-changed', message: 'The document changed since the math was chosen. Select the math again.' } };
  const empty = { status: 'refused', reason: { code: 'no-selection', message: 'Select some math in the editor first.' } };

  /** Apply a concept to the remembered selection (target) or the editor's current one. Returns the core's
   *  result ({status: 'ready'|'needs-operands'|'refused', ...}); 'ready' has already been written. */
  function apply(conceptKey, target = null) {
    const sel = resolve(target);
    if (sel.stale) return stale;
    if (sel.start === sel.end) return empty;
    const r = core.apply(editor.getText(), { start: sel.start, end: sel.end }, conceptKey);
    return r.status === 'ready' ? write(r) : r;
  }

  /** The author typed the parts (concept order). */
  function applyParts(conceptKey, texts, target = null) {
    const sel = resolve(target);
    if (sel.stale) return stale;
    if (sel.start === sel.end) return empty;
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

/** A plain-language line for the status region. [CLAUDE 2026-11-08] The core's messages say "operand"; the
 *  panel says "part" (live check: "Mark the parts: ... Mark the operands." was read out). */
const plain = s => String(s).replace(/\boperands\b/g, 'parts').replace(/\boperand\b/g, 'part').replace(/\bOperand\b/g, 'Part');
export function describeResult(r) {
  if (r.status === 'ready') {
    const parts = r.operands.length ? ` Parts: ${r.operands.map(o => `${o.name} = ${o.text}`).join('; ')}.` : '';
    const warn = r.warnings?.length ? ` Check: ${r.warnings.map(w => plain(w.message)).join(' ')}` : '';
    return `Applied ${r.value}.${parts}${warn}`;
  }
  if (r.status === 'needs-operands') return plain(r.reason.message);
  return `Not applied: ${plain(r.reason.message)}`;
}

/** Is this keydown the snippet shortcut (Ctrl+Period)? The physical key or the "." character, so other
 *  keyboard layouts work; not with Shift (">"), Alt or Command, and not the number pad's decimal key. */
export const isShortcut = e => e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey &&
  (e.code === SHORTCUT.code || (e.key === SHORTCUT.key && e.code !== 'NumpadDecimal'));

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
  // [CLAUDE 2026-11-08] NVDA live check: sending every message to the page's status bar as well made NVDA
  // say it three times (panel region + status bar twice, with "LaTeX UTF-8 Ln 1, Col 81"). Routine
  // messages now go to the panel's own status region only; the status bar gets only what happens without
  // the author acting in the panel (the concept list failing to load).
  const say = (msg, kind = 'ready', { bar = false } = {}) => {
    el.status.textContent = '';
    setTimeout(() => { el.status.textContent = msg; }, 30);   // re-announce the same text
    if (bar) ctx.updateStatus?.(kind === 'warning' ? 'ready' : kind, msg);   // the status dot knows ready / loading / error
  };
  let controller = null;
  try {
    const data = await (ctx.fetchJson ? ctx.fetchJson(SLIM_URL) : fetch(SLIM_URL).then(r => r.json()));
    controller = createSnippetController({ core: createSnippetCore(data), editor: ctx.editor });
  } catch (e) {
    say(`The snippet tool could not load the concept list (${SLIM_URL}): ${e.message}`, 'error', { bar: true });
    for (const k of ['filter', 'group', 'source', 'notUsed', 'rwm', 'list', 'apply']) el[k].disabled = true;
    return null;
  }
  for (const g of controller.core.groups()) el.group.add(new Option(`${g.id.replace(/-/g, ' ')} (${g.count})`, g.id));
  for (const s of controller.core.sources()) el.source.add(new Option(`${s.id} (${s.count})`, s.id));
  let pending = null;   // { key, forms } while the parts form is open
  let target = null;    // the selection remembered when the panel opened ({ start, end, text })

  function showSelection() {
    const s = target ?? controller.selection();
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
    // [CLAUDE 2026-11-08] the list shows at most 300; say so rather than "300 shown" (live check)
    el.count.textContent = hits.length >= 300 ? `first ${hits.length}` : String(hits.length);
  }
  function closeParts() { pending = null; el.parts.hidden = true; el.fields.textContent = ''; }
  function partsForm(key, r) {
    pending = { key, forms: r.forms.length ? r.forms : [{ arity: 1, operands: ['a1'] }] };
    el.partsWhy.textContent = describeResult(r);
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
    target = null;
    el.undo.setAttribute('aria-disabled', 'false');
    say(describeResult(r), r.warnings?.length ? 'warning' : 'ready');
    ctx.editor.focus();
  }
  function apply() {
    const key = el.list.value;
    if (!key) { say('Choose a concept from the list first.', 'warning'); return; }
    const r = controller.apply(key, target);
    if (r.status === 'ready') return done(r);
    if (r.status === 'needs-operands') return partsForm(key, r);
    say(describeResult(r), 'error');
  }
  // back to the editor with the remembered selection put back, so the author can try again or carry on
  function back(message) {
    closeParts();
    if (target && target.start !== target.end && ctx.editor.getRange(target.start, target.end) === target.text)
      ctx.editor.selectRange(target.start, target.end, { focusEditor: false });
    target = null;
    if (message) say(message);
    ctx.editor.focus();
  }
  function open() {
    target = controller.selection();   // remember it FIRST: opening the sidebar can collapse it
    ctx.openSection?.();
    if (el.toggle && el.toggle.getAttribute('aria-expanded') !== 'true') el.toggle.click();
    if (target.start !== target.end) ctx.editor.selectRange(target.start, target.end, { focusEditor: false });
    closeParts();
    showSelection();
    if (!el.list.options.length) fill();
    el.filter.focus();
    el.filter.select();
  }
  const inPanel = () => el.panel.contains(document.activeElement);

  // [CLAUDE 2026-11-08] live check: refilling the list on every keystroke made NVDA say "list item" several
  // times; refill once typing pauses (the list is read when the author arrows into it).
  let fillTimer = null;
  el.filter.addEventListener('input', () => { clearTimeout(fillTimer); fillTimer = setTimeout(fill, 250); });
  for (const k of ['group', 'source', 'notUsed', 'rwm']) el[k].addEventListener('change', fill);
  el.filter.addEventListener('focus', () => { if (!target) target = controller.selection(); showSelection(); });
  el.filter.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); clearTimeout(fillTimer); fill(); el.list.focus(); }
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(fillTimer); fill(); apply(); }
  });
  el.list.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  el.list.addEventListener('dblclick', apply);
  el.apply.addEventListener('click', apply);
  el.back.addEventListener('click', () => back('Back to the editor. Nothing was changed.'));
  // [CLAUDE 2026-11-08] live check: disabling the focused Undo button dropped focus to the page. It is now
  // marked aria-disabled (stays focusable, announced as unavailable) and does nothing then.
  const undoOff = () => el.undo.getAttribute('aria-disabled') === 'true';
  el.undo.addEventListener('click', () => {
    if (undoOff()) { say('Nothing to undo.', 'warning'); return; }
    if (controller.undo()) { say('The last snippet was undone.'); el.undo.setAttribute('aria-disabled', 'true'); }
    else say('Nothing to undo.', 'warning');
  });
  el.parts.addEventListener('submit', e => {
    e.preventDefault();
    if (!pending) return;
    const texts = [...el.fields.querySelectorAll('input')].map(i => i.value);
    const r = controller.applyParts(pending.key, texts, target);
    if (r.status === 'ready') return done(r);
    say(describeResult(r), 'error');
  });
  el.partsCancel.addEventListener('click', () => { closeParts(); say('Cancelled. Nothing was changed.'); el.filter.focus(); });
  el.panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); back('Back to the editor. Nothing was changed.'); }
  });
  // Ctrl+Period: from the editor (or anywhere else) opens the panel; from inside the panel goes back to the
  // editor [CLAUDE 2026-11-08: NVDA can keep Escape for itself (leaving focus mode), so the shortcut toggles]
  document.addEventListener('keydown', e => {
    if (!isShortcut(e)) return;
    e.preventDefault(); e.stopPropagation();
    // [CLAUDE 2026-11-08] say any failure out loud instead of failing silently (live check: a press after a
    // burst of selection changes sometimes did nothing; this tells a page error from a key that never arrived)
    try { if (inPanel()) back('Back to the editor. Nothing was changed.'); else open(); }
    catch (err) { console.error('[snippet panel]', err); say(`The snippet panel could not open: ${err.message}`, 'error', { bar: true }); }
  }, true);
  fill();
  return { controller, open };
}
