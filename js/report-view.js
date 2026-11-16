// js/report-view.js — the Report view: the combined report of the LaTeX
// preprocessor, the accessibility checker and Pandoc, in the output panel.
//
// Written by latex-preprocess session 292: the combined report's platform step 2
// (latex-preprocess sessions/PLAN-COMBINED-PLATFORM-s278.md, signed off 2026-10-30;
// the report's order and levels, PLAN-REPORT-ORDER-s284). Session 293 added step 3,
// click to the line: each entry with a place is a button that opens its file at the
// line (clickTarget, lineRanges), and the main file's shown entries mark the editor
// (diagnostics, from the tool's marks). The old Preprocess and Log views stay until
// Nicholas has tested this one.
//
// Two halves:
//   createReportState()  the data, no `document`: what js/preprocess.js's keepRun
//                        hands over after Process file, then Pandoc's log from the
//                        conversion that press started. Tested in Node by
//                        js/test-report-view.mjs (written first, seen to fail).
//   initReportView(...)  the drawing: the level line, the settings panel (the three
//                        levels and the ticks, each under its level), the list by
//                        position, "Copy report". The ticks are remembered in
//                        localStorage 'atc.report.show'.
// Every function of the report comes from the tool (preprocess/v2/combined.mjs and
// the modules it names); nothing here decides what an entry is.

// ---------------------------------------------------------------- click to the line (session 293, step 3)
// The editor's ranges for a place: [{ line, startCol, endCol }], one per line, columns from 1, endCol one past
// the last character (the tool's endColumn is the same: the end is exclusive). A place over several lines runs to
// each line's end; a place with no column, or past its line's end, is its whole line; with no end, one character.
export function lineRanges(where, text) {
  const lines = String(text ?? '').split('\n');
  const len = (n) => (lines[n - 1] ?? '').replace(/\r$/, '').length;
  const whole = (n) => ({ line: n, startCol: 1, endCol: Math.max(2, len(n) + 1) });
  // no column, or one past the line's end (Pandoc places some messages there, s293): the whole line
  if (where.column == null || where.column > len(where.line)) return [whole(where.line)];
  const endLine = where.endLine ?? where.line;
  if (where.endColumn == null || endLine < where.line) return [{ line: where.line, startCol: where.column, endCol: where.column + 1 }];
  if (endLine === where.line)
    return [{ line: where.line, startCol: where.column, endCol: Math.max(where.endColumn, where.column + 1) }];
  const out = [{ line: where.line, startCol: where.column, endCol: Math.max(len(where.line) + 1, where.column + 1) }];
  for (let n = where.line + 1; n < endLine; n++) out.push(whole(n));
  if (where.endColumn > 1) out.push({ line: endLine, startCol: 1, endCol: where.endColumn });
  return out;
}

// What a click on an entry opens: null for no place; the place as text when the file is not in the project
// (textOf(file) gives null); else the file, line, column and ranges. `opens` is the tool's: "main" or "file".
export function clickTarget(entry, textOf) {
  const w = entry && entry.where;
  if (!w || !w.file || w.line == null) return null;
  const at = { file: w.file, line: w.line, column: w.column ?? null, opens: entry.opens || 'file' };
  const text = textOf(w.file);
  if (text == null) return { ...at, missing: true, text: w.file + ':' + w.line };
  return { ...at, ranges: lineRanges(w, text) };
}

// The page's own Log rows -> the tool's platform messages (latex-preprocess s309; report-sidebar\PLAN-REPORT-SIDEBAR.md
// step A2; "Other messages", his call 1 "A"). Only the platform's own kinds, told by the row's type; Pandoc's rows come
// through pandocRows. The tool decides what each is (platformEntries); this only carries the row's fields across.
// A row's `at` ({ file, line, ref }, index.html conversionPathWarnings) is a place in the converted text.
const PLATFORM_KINDS = Object.freeze({ preprocess: ['preprocess', 'preprocessing'], 'project-paths': ['paths', 'project paths'],
  placeholder: ['placeholder', 'image placeholder'], package: ['packaging', 'packaging'], 'preview-image': ['preview', 'preview'],
  exception: ['conversion', 'conversion'] });
export function platformMessages(rows) {
  return (rows || []).filter((r) => r && Object.prototype.hasOwnProperty.call(PLATFORM_KINDS, r.type)).map((r) => {
    const [said, label] = PLATFORM_KINDS[r.type], a = r.at || null;
    return { level: r.level, message: String(r.message ?? ''), said, label, file: a ? a.file ?? null : null,
             line: a ? a.line ?? null : null, in: a ? 'converted' : null, ref: a ? a.ref ?? null : null };
  });
}

// Pandoc's stop as the page gets it (latex-preprocess s310; report-sidebar step A2b; seen in report-sidebar\a0\S6.json):
// pandoc-wasm gives `ERROR: Error at "/stdin" (line 16, column 23):` and the lines after it. The tool reads desktop
// Pandoc's form, `Error at (line 16, column 23):` for unnamed input (pandocRows), so the prefix goes from each line,
// "/stdin" is read as the unnamed input (as for the JSON log, R12), and lines before the stop are left out of it.
// Text with no stop gives null: a line such as "File 'x' not found in resource path" is not one (the page tells it
// with its "Missing image ... placeholder" message).
export function pandocStopText(text) {
  const t = String(text || '').replace(/^ERROR: /gm, '').replace(/^Error at "\/stdin" \(/m, 'Error at (');
  const at = t.search(/^Error at /m);
  return at < 0 ? null : t.slice(at);
}

// Which of the output panel's views to leave out (latex-preprocess s312; report-sidebar step A3). His words
// (2026-11-16): "No preprocessing or combined report should appear in the preview window for non latex input"; LaTeX
// converted without a preprocessing run: "Option A (the log file, like non-latex input)". So the Report view is offered
// only while it holds the latest conversion (a run's, joined, not stale), and input that is not LaTeX gets neither it
// nor the Preprocess view. status: the report state's status(); from: the input format ("latex", "latex+raw_tex" ...).
// s313 (step A4; his call 3, "Option A is good for now"): the Preprocess view is left out always and the Log while the
// report holds the latest conversion, unless "Show old views" is ticked (showOld; LaTeX only).
export function hiddenViews(status, from, { showOld = false } = {}) {
  const latex = String(from || '').split(/[+-]/)[0] === 'latex';
  const current = !!(status && status.kept && status.pandoc === 'joined' && !status.stale);
  return { report: !(latex && current), preprocess: !(latex && showOld), log: latex && current && !showOld };
}

const SEVERITY = { error: 'error', warning: 'warn', note: 'info' };
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// "label: message", unless the message already starts with its label
const said = (e) => { const m = oneLine(e.message); return m.toLowerCase().startsWith(String(e.label).toLowerCase()) ? m : e.label + ': ' + m; };

// ---------------------------------------------------------------- the data
export function createReportState() {
  let k = null;          // { tool, run, files, entry, converted, pre, checker, order, unread, opens, packages }
  let pandoc = [];       // Pandoc's entries, from the conversion the press started
  let pandocState = 'none';   // 'none' | 'waiting' | 'joined'
  let stale = false;     // a later conversion happened that this report does not hold
  let other = [];        // s309: the platform's own messages for the joined conversion (platformMessages)

  // After Process file: everything from the run and the ORIGINAL files.
  function keep({ tool, run, files, entry, converted }) {
    const pre = tool.runEntries(run, files);
    let checked = { entries: [], files: null };
    try { checked = tool.checkRun(run, files); } catch (e) { console.warn('Report: the checker failed (' + (e && e.message) + ')'); }
    k = { tool, run, files, entry, converted, pre, checker: checked.entries || [],
          order: checked.files || (run.reader && run.reader.chain) || [entry],
          unread: tool.unreadParts(run, files), opens: tool.openingsOf(run, files),
          packages: tool.packageUsesOf(run, files) };
    pandoc = []; other = []; pandocState = 'waiting'; stale = false;
  }

  // After a conversion: { target, warnings, stderr, error }. Taken only for the
  // conversion the press started (the file it converted, once); any other means
  // this report is from the last run, and it says so.
  // s309: `rows`, the page's Log rows for that conversion; its own among them become "Other messages".
  function takePandoc({ target, warnings, stderr, error, rows: pageRows } = {}) {
    if (!k) return false;
    if (pandocState !== 'waiting' || target !== k.converted) { stale = true; return false; }
    // pandoc-wasm names the file given on stdin "/stdin" (desktop Pandoc: ""); the tool's stdin option reads ""
    // (s293, test R12)
    const log = (warnings || []).map((w) => (w && w.source === '/stdin' ? { ...w, source: '' } : w));
    const rows = k.tool.pandocRows(log, { output: k.run.output, stdin: k.entry,
      // s310: pandocStopText reads pandoc-wasm's form; an error the page caught that is not in it stays as given
      error: error ? (pandocStopText(error) || error) : pandocStopText(stderr) });
    pandoc = k.tool.pandocEntries(rows, k.run, k.files);
    pandocState = 'joined';
    if (pageRows) other = platformMessages(pageRows);
    return true;
  }

  // s309: later rows of the joined conversion (packaging, preview images). The page hands its whole list for that
  // conversion, so the list replaces the one held (a row is never told twice). Nothing is taken before a conversion
  // joins or once a later conversion has made the report stale.
  function takeOther({ rows } = {}) {
    if (!k || pandocState !== 'joined' || stale) return false;
    other = platformMessages(rows);
    return true;
  }

  function combined(show) {
    if (!k) return null;
    return k.tool.combineEntries({ preprocessor: k.pre, checker: k.checker, pandoc,
        platform: k.tool.platformEntries ? k.tool.platformEntries(other, k.run, k.files) : [] },
      { main: k.entry, order: k.order, unread: k.unread, opens: k.opens, packages: k.packages,
        ...(show ? { show } : {}) });
  }

  function levelLine(c) {
    const lv = c.counts.levels, [FIX, CHECK, ALL] = k.tool.LEVELS;
    return `${FIX}: ${lv[FIX]}. ${CHECK} would add ${lv[CHECK]}, ${ALL} ${lv[ALL]}.`;
  }

  // The editor's marks for the main file (gutter, underline, line tint): the tool's marks(combined, show), so the
  // ticks drive them, in the shape setDiagnostics takes (applyDecorations' shape), each on its first line.
  // A package command's message is marked at its .sty place, not at each use (carried, s291).
  function diagnostics(c, show, textOf) {
    if (!k || !c) return null;
    const byId = new Map(c.entries.map((e) => [e.id, e]));
    const text = textOf(k.entry);
    const diags = k.tool.marks(c, show).filter((m) => m.file === k.entry).map((m) => {
      const e = byId.get(m.id), [r] = lineRanges(m, text);
      return { line: r.line, startCol: r.startCol, endCol: r.endCol, severity: SEVERITY[m.level] || 'info', message: said(e) };
    });
    return { file: k.entry, diags };
  }

  return {
    keep, pandoc: takePandoc, other: takeOther, combined, levelLine, diagnostics,
    // s313: a press that stopped (nothing converted) leaves a report that no longer holds the latest
    outdate: () => { if (k) stale = true; },
    lines: (c, show) => k.tool.positionLines(c, show),
    status: () => ({ kept: !!k, entry: k && k.entry, converted: k && k.converted, pandoc: pandocState, stale }),
    tool: () => k && k.tool,
  };
}

// ---------------------------------------------------------------- the drawing
const SHOW_KEY = 'atc.report.show';

// The editor hooks (step 3), from index.html: textOf(path) the project's text of a file or null when it is not in
// the project; goTo(target) opens target.file if another is shown, jumps and highlights; mark({ file, diags })
// hands the main file's marks to the editor.
export function initReportView({ root, storage = globalThis.localStorage, clipboard = globalThis.navigator && globalThis.navigator.clipboard,
  textOf = () => null, goTo = null, mark = null, oldViews = null } = {}) {
  // s313: oldViews { get(), set(v) }, the page's "Show old views" (his call 3 A), drawn as a tick box in Settings
  const state = createReportState();
  if (!root) return { keep: state.keep, pandoc: state.pandoc, other: state.other, state };
  const doc = root.ownerDocument;
  const el = (tag, props = {}, ...kids) => {
    const n = doc.createElement(tag);
    for (const [key, v] of Object.entries(props)) {
      if (key === 'class') n.className = v;
      else if (key === 'text') n.textContent = v;
      else if (key.startsWith('on')) n.addEventListener(key.slice(2), v);
      else if (v === true) n.setAttribute(key, '');
      else if (v !== false && v != null) n.setAttribute(key, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };

  // The ticks: remembered, else the default level's (set once the tool is known).
  let show = null;
  try { const v = JSON.parse(storage.getItem(SHOW_KEY)); if (Array.isArray(v)) show = v; } catch {}
  const remember = () => { try { storage.setItem(SHOW_KEY, JSON.stringify(show)); } catch {} };

  root.replaceChildren();
  const status = el('p', { class: 'report-status', role: 'status', 'aria-live': 'polite' });
  const settingsBtn = el('button', { type: 'button', class: 'output-tab-action', 'aria-expanded': 'false',
    'aria-controls': 'reportSettings', text: 'Settings' });
  const copyBtn = el('button', { type: 'button', class: 'output-tab-action', text: 'Copy report', 'aria-disabled': 'true' });
  const copied = el('span', { class: 'report-copied', role: 'status' });
  const settings = el('div', { id: 'reportSettings', class: 'report-settings', hidden: true });
  const list = el('div', { class: 'report-list' });
  const note = el('p', { class: 'report-note', text: 'Press Process file (LaTeX preprocessing, in File Preparation) ' +
    'to see the combined report: the preprocessor\'s and the accessibility checker\'s entries, then Pandoc\'s once the ' +
    'conversion has run, down your main file.' });
  root.append(el('div', { class: 'report-bar' }, status, el('span', { class: 'report-spacer' }), copied, settingsBtn, copyBtn),
    settings, note, list);

  settingsBtn.addEventListener('click', () => {
    const open = settings.hidden;
    settings.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
  });
  copyBtn.addEventListener('click', async () => {
    const tool = state.tool();
    if (!tool || !clipboard) return;
    const c = state.combined(show);
    try { await clipboard.writeText(tool.renderCombined(c, { show })); copied.textContent = 'Report copied.'; }
    catch { copied.textContent = 'Could not copy.'; }
  });

  // ---- the settings panel: the levels, then the ticks under each level
  function drawSettings(c) {
    const tool = state.tool();
    const by = c.counts.byCategory || {};
    const current = tool.levelOf(show);
    const label = new Map(tool.CATEGORIES.map((x) => [x.key, x.label]));
    const levels = el('fieldset', { class: 'report-levels' }, el('legend', { text: 'Level' }));
    for (const lv of tool.LEVELS) {
      const id = 'reportLevel-' + lv.replace(/\W+/g, '');
      levels.append(el('label', { for: id },
        el('input', { type: 'radio', name: 'reportLevel', id, value: lv, checked: current === lv,
          onchange: () => { show = tool.showFor(lv); remember(); draw(); } }),
        ' ' + lv + ' (' + c.counts.levels[lv] + ')'));
    }
    levels.append(el('span', { class: 'report-custom', text: current === 'Custom' ? 'Custom: ticks changed by hand' : '' }));
    const groups = [...tool.LEVELS.map((lv) => [lv, lv]), [null, 'Accessibility checker (outside the levels)']];
    const boxes = groups.map(([lv, title]) => {
      const fs = el('fieldset', { class: 'report-ticks' }, el('legend', { text: title }));
      for (const cat of tool.CATEGORIES.filter((x) => x.level === lv)) {
        const id = 'reportTick-' + cat.key;
        const name = (cat.parent ? label.get(cat.parent) + ': ' : '') + cat.label;
        fs.append(el('div', { class: 'report-tick' + (cat.parent ? ' report-tick-child' : '') },
          el('input', { type: 'checkbox', id, checked: show.includes(cat.key), 'aria-describedby': id + '-why',
            onchange: (ev) => {
              show = ev.target.checked ? [...new Set([...show, cat.key])] : show.filter((x) => x !== cat.key);
              remember(); draw();
            } }),
          el('label', { for: id, text: ' ' + name + ' (' + (by[cat.key] || 0) + ')' }),
          el('span', { id: id + '-why', class: 'report-why', text: cat.why })));
      }
      return fs;
    });
    // s313: "Show old views" (off by default, not remembered): the Preprocess and Log views back in the View drop-down
    const old = !oldViews ? null : el('fieldset', { class: 'report-ticks' }, el('legend', { text: 'While testing' }),
      el('div', { class: 'report-tick' },
        el('input', { type: 'checkbox', id: 'reportShowOld', checked: !!oldViews.get(),
          onchange: (ev) => oldViews.set(ev.target.checked) }),
        el('label', { for: 'reportShowOld', text: ' Show old views (Preprocess and Log)' })));
    settings.replaceChildren(levels, ...boxes, ...(old ? [old] : []));
  }

  // ---- the list, by position
  const placeText = (w) => !w || !w.file ? '(no place)' : w.line == null ? w.file : w.file + ':' + w.line + (w.column != null ? ':' + w.column : '');
  // an entry: a button that opens its file at its line (step 3), the place first in its name; a file not in the
  // project shows its place as text and says so; an entry with no place stays text
  function entryItem(e, byId, copy) {
    const t = goTo ? clickTarget(e, textOf) : null;
    const parts = (place) => [el('span', { class: 'report-place', text: place }), ' ',
      el('span', { class: 'report-level', text: e.level }), ' ',
      el('span', { class: 'report-message', text: (copy ? '(copy) ' : '') + said(e) })];
    const li = el('li', { class: 'report-entry report-' + e.level });
    if (t && !t.missing) li.append(el('button', { type: 'button', class: 'report-go', onclick: () => goTo(t) }, ...parts(placeText(e.where))));
    else if (t) li.append(...parts(t.text), ' ', el('span', { class: 'report-missing', text: '(' + t.file + ' is not in the project)' }));
    else li.append(...parts(placeText(e.where)));
    const more = [];
    if (e.need) more.push(e.need);
    if (e.source === 'checker' && e.fixes && e.fixes.length) more.push('How to fix (best first): ' + e.fixes.map((f) => oneLine(f.description)).join(' | '));
    if (e.calls) more.push('Called at ' + e.calls.map((id) => placeText(byId.get(id).where)).join(', '));
    for (const a of e.also || []) more.push('Also told by ' + a.source + ': ' + oneLine(a.message));
    if (more.length) li.append(el('ul', { class: 'report-details' }, ...more.map((t) => el('li', { text: t }))));
    return li;
  }
  // a closed line: a button that opens the entries under it
  function closedItem(text, items) {
    const inner = el('ul', { class: 'report-inner', hidden: true }, ...items);
    const btn = el('button', { type: 'button', class: 'report-fold', 'aria-expanded': 'false', text });
    btn.addEventListener('click', () => {
      const open = inner.hidden;
      inner.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    return el('li', { class: 'report-closed' }, btn, inner);
  }
  function drawList(c) {
    const byId = new Map(c.entries.map((e) => [e.id, e]));
    const out = [];
    let file, ul = null;
    for (const line of state.lines(c, show)) {
      if (!ul || line.file !== file) {
        file = line.file;
        out.push(el('h3', { class: 'report-file', text: (file ?? 'Not tied to a place') + (/\.(sty|cls)$/i.test(file || '') ? ' (package file)' : '') }));
        ul = el('ul', { class: 'report-entries' });
        out.push(ul);
      }
      if (line.again) {
        const a = line.again;
        ul.append(closedItem(placeText(a.where) + '  ' + a.file + ', read again: ' + a.count + (a.count === 1 ? ' message' : ' messages') +
          ', same as at ' + (a.first.file === a.where.file ? 'line ' + a.first.line : a.first.file + ':' + a.first.line),
          a.ids.map((id) => entryItem(byId.get(id), byId, true))));
      } else if (line.use) {
        const u = line.use;
        ul.append(closedItem(placeText(u.where) + '  ' + u.name + (u.via ? ' (through ' + u.via + ')' : '') + ': ' + u.count +
          (u.count === 1 ? ' message' : ' messages') + ' in its definition, ' + u.defined.file + ':' + u.defined.line,
          u.ids.map((id) => entryItem(byId.get(id), byId, true))));
      } else if (line.fold) {
        const f = line.fold;
        ul.append(closedItem((file ?? '(no place)') + ':' + f.from + (f.to !== f.from ? '-' + f.to : '') + '  ' + f.level + '  ' +
          f.label + ': ' + f.count + ' in a row', line.ids.map((id) => entryItem(byId.get(id), byId, false))));
      } else ul.append(entryItem(byId.get(line.ids[0]), byId, false));
    }
    if (!out.length) out.push(el('p', { class: 'report-note', text: 'Nothing to show at this level. Choose Check or Everything in Settings to see more.' }));
    list.replaceChildren(...out);
  }

  function draw() {
    const tool = state.tool();
    if (!tool) return;
    if (!show) show = tool.showFor(tool.LEVELS[0]);
    const c = state.combined(show);
    const st = state.status();
    const shown = state.lines(c, show).length;
    const parts = [state.levelLine(c), 'Showing ' + tool.levelOf(show) + ': ' + shown + (shown === 1 ? ' line.' : ' lines.')];
    if (c.counts.unread && !show.includes('unread'))
      parts.push(c.counts.unread.total + ' more from parts of other files this document does not read (hidden).');
    if (st.pandoc === 'waiting') parts.push('Pandoc\'s messages join once the conversion has run.');
    if (st.stale) parts.push('From the last Process file of ' + st.entry + '; later conversions are not in it.');
    status.textContent = parts.join(' ');
    note.hidden = true;
    copyBtn.removeAttribute('aria-disabled');
    // the panel is drawn afresh: the tick or level the keyboard was on keeps the focus
    const focused = doc.activeElement && settings.contains(doc.activeElement) ? doc.activeElement.id : null;
    drawSettings(c);
    drawList(c);
    if (mark) mark(state.diagnostics(c, show, textOf));
    if (focused && doc.getElementById(focused)) doc.getElementById(focused).focus();
  }

  return {
    keep(k) { state.keep(k); draw(); },
    pandoc(p) { const took = state.pandoc(p); draw(); return took; },
    other(o) { const took = state.other(o); if (took) draw(); return took; },
    state,
  };
}
