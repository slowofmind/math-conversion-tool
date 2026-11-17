// js/report-sidebar.js — the combined report in the Tools panel's "Report" section.
//
// Written by latex-preprocess session 314: report-sidebar step B1 (report-sidebar\PLAN-REPORT-SIDEBAR.md, HANDOFF-B1.md;
// mockup https://claude.ai/artifact/1wpyBEKBG2zhjSGuRqjqgR). His words (2026-11-15): "I would still want to "jump click"
// functionality that we had added to the report, but used from the sidebar"; "The settings sidebar/panel/area for this
// should use accordions for the lower level labels as well (fix this, check, etc.)".
//
// It draws the Report view's own state (js/report-view.js createReportState): the same run, Pandoc's messages, the
// page's other messages and the ticks. A tick or a level changed here is set on the state, which redraws every drawing,
// so the Report view, this section and the counts cannot disagree. Nothing here decides what an entry is: the tool does.
//
// Top to bottom: the three levels with their counts; a status line (static text, never a live region: the status bar
// speaks for the page); "Settings", a closed accordion holding an accordion per group of ticks; then the findings,
// grouped by file (step B5 makes them an outline under the document's headings). A row is a button: pressed, it goes to
// its place with the page's click to the line, unchanged (it opens the file, jumps, highlights; the editor takes the
// focus), and opens the row's details beneath it - one row open at a time; pressed again, its details close. Which
// accordions are open is remembered under 'atc.report.sidebar'; the ticks are remembered by the state.
//
// words: { clickTarget, said, oneLine } from js/report-view.js, handed in by the page (a module here never names another
// by a relative path: cm6-src/test-asset-urls.mjs), so an entry is worded and placed exactly as in the Report view.

const OPEN_KEY = 'atc.report.sidebar';
const SVGNS = 'http://www.w3.org/2000/svg';

export function initReportSidebar({ root, state, words = null, storage = globalThis.localStorage, textOf = () => null,
  goTo = null, oldViews = null } = {}) {
  if (!root || !state || !words) return { summary: () => null };
  const { clickTarget, said, oneLine } = words;
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
  // A level's mark, a different shape for each (not colour alone): error a filled circle, warning a triangle, note a
  // ring. Decorative: the row's name says the level in words.
  const levelWord = (l) => ({ warn: 'warning', info: 'note' }[l] || l || 'note');
  function icon(lvl) {
    const s = doc.createElementNS(SVGNS, 'svg');
    for (const [k, v] of Object.entries({ class: 'rsb-icon rsb-icon-' + lvl, 'aria-hidden': 'true', focusable: 'false',
      width: '12', height: '12', viewBox: '0 0 12 12' })) s.setAttribute(k, v);
    const [tag, at] = lvl === 'warning'
      ? ['path', { d: 'M6 1.5 11 10.5H1Z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }]
      : lvl === 'error' ? ['circle', { cx: '6', cy: '6', r: '4.5', fill: 'currentColor' }]
      : ['circle', { cx: '6', cy: '6', r: '4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }];
    const shape = doc.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(at)) shape.setAttribute(k, v);
    s.append(shape);
    return s;
  }

  // ---- which accordions are open: remembered; all closed until the reader opens one
  let opened = {};
  try { const v = storage ? JSON.parse(storage.getItem(OPEN_KEY)) : null; if (v && typeof v === 'object' && !Array.isArray(v)) opened = v; } catch {}
  const rememberOpen = () => { try { if (storage) storage.setItem(OPEN_KEY, JSON.stringify(opened)); } catch {} };
  // An accordion as File Preparation's are built: a button in a heading, controlling a region it labels.
  function accordion(key, title, heading, id) {
    const toggle = el('button', { type: 'button', class: 'rsb-acc-toggle', id: id + 'Toggle', 'aria-controls': id, 'aria-expanded': 'false' },
      el('span', { class: 'rail-chevron', 'aria-hidden': 'true', text: '▸' }), title);
    const panel = el('div', { class: 'rsb-acc-panel', id, role: 'region', 'aria-labelledby': id + 'Toggle', hidden: true });
    const set = (open) => { toggle.setAttribute('aria-expanded', String(open)); panel.hidden = !open; };
    set(opened[key] === true);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      set(open);
      opened[key] = open;
      rememberOpen();
    });
    return { box: el('div', { class: 'rsb-acc' }, el(heading, { class: 'rsb-acc-heading' }, toggle), panel), panel, toggle };
  }

  root.replaceChildren();
  const note = el('p', { class: 'rsb-note', text: 'The report shows here after Process file (File Preparation, LaTeX ' +
    'preprocessing), or after Convert with Autoprocess ticked: the preprocessor\'s and the accessibility checker\'s ' +
    'findings, then Pandoc\'s once the conversion has run.' });
  const body = el('div', { class: 'rsb-body', hidden: true });
  root.append(note, body);

  // ---- built once, when the tool is first known (its levels and categories do not change); updated in place after,
  // so a tick or level keeps the keyboard's focus
  let built = null;
  function build(tool) {
    const radios = new Map();
    const row = el('div', { class: 'rsb-level-row' });
    for (const lv of tool.LEVELS) {
      const id = 'rsbLevel-' + lv.replace(/\W+/g, '');
      const input = el('input', { type: 'radio', name: 'rsbLevel', id, value: lv, onchange: () => state.setTicks(tool.showFor(lv)) });
      const words = doc.createTextNode('');
      row.append(el('label', { for: id }, input, words));
      radios.set(lv, { input, words });
    }
    const custom = el('span', { class: 'rsb-custom' });
    const levels = el('fieldset', { class: 'rsb-levels' }, el('legend', { text: 'Level' }), row, custom);
    const status = el('p', { class: 'rsb-status' });
    const settings = accordion('settings', 'Settings', 'h3', 'rsbSettings');
    const label = new Map(tool.CATEGORIES.map((x) => [x.key, x.label]));
    const ticks = new Map();
    for (const [lv, title] of [...tool.LEVELS.map((x) => [x, x]), [null, 'Accessibility checker']]) {
      const g = accordion('group:' + title, title, 'h4', 'rsbGroup-' + title.replace(/\W+/g, ''));
      for (const cat of tool.CATEGORIES.filter((x) => x.level === lv)) {
        const id = 'rsbTick-' + cat.key;
        const input = el('input', { type: 'checkbox', id, 'aria-describedby': id + '-why', onchange: (ev) => {
          const now = state.ticks() || [];
          state.setTicks(ev.target.checked ? [...now, cat.key] : now.filter((x) => x !== cat.key));
        } });
        const words = el('label', { for: id });
        // the reason is the tick's description for a screen reader; not shown, to keep Settings short (help text is
        // not settled: plan section 5, item 5)
        g.panel.append(el('div', { class: 'rsb-tick' + (cat.parent ? ' rsb-tick-child' : '') }, input, words,
          el('span', { id: id + '-why', hidden: true, text: cat.why })));
        ticks.set(cat.key, { input, words, name: (cat.parent ? label.get(cat.parent) + ': ' : '') + cat.label });
      }
      settings.panel.append(g.box);
    }
    let old = null;
    if (oldViews) {   // s313's "Show old views" (his call 3 A), the page's one flag, shared with the Report view
      const g = accordion('group:While testing', 'While testing', 'h4', 'rsbGroup-Whiletesting');
      old = el('input', { type: 'checkbox', id: 'rsbShowOld', onchange: (ev) => oldViews.set(ev.target.checked) });
      g.panel.append(el('div', { class: 'rsb-tick' }, old, el('label', { for: 'rsbShowOld', text: 'Show old views (Preprocess and Log)' })));
      settings.panel.append(g.box);
    }
    const list = el('div', { class: 'rsb-list' });
    body.append(levels, status, settings.box, el('h3', { class: 'rsb-heading', text: 'Findings' }), list);
    built = { radios, custom, status, ticks, old, list };
  }

  function update(tool, c, show, lines) {
    const lv = tool.levelOf(show);
    for (const [name, r] of built.radios) { r.input.checked = lv === name; r.words.data = ' ' + name + ' (' + c.counts.levels[name] + ')'; }
    built.custom.textContent = lv === 'Custom' ? 'Custom: ticks changed by hand' : '';
    const by = c.counts.byCategory || {};
    for (const [key, t] of built.ticks) { t.input.checked = show.includes(key); t.words.textContent = t.name + ' (' + (by[key] || 0) + ')'; }
    if (built.old) built.old.checked = !!oldViews.get();
    const st = state.status(), n = lines.length;
    const parts = ['Showing ' + lv + ': ' + n + (n === 1 ? ' line.' : ' lines.')];
    if (c.counts.unread && !show.includes('unread'))
      parts.push(c.counts.unread.total + ' more from parts of other files this document does not read (hidden).');
    if (st.pandoc === 'waiting') parts.push('Pandoc\'s messages join once the conversion has run.');
    if (st.stale) parts.push('From the last Process file of ' + st.entry + '; later conversions are not in it.');
    built.status.textContent = parts.join(' ');
  }

  // ---- the findings, grouped by file; a row per line, a closed line (folds, a file read again, a package command's
  // messages at its use) holding its rows. The selected row, the open closed lines and the focus survive a redraw.
  let rows = new Map();          // key -> { btn, detail }
  let selected = null, openRow = false;
  const openFolds = new Set();
  let seq = 0;
  const placeText = (w) => !w || !w.file ? '' : w.line == null ? w.file : w.file + ':' + w.line + (w.column != null ? ':' + w.column : '');
  // "Line N" spoken, N shown; then the level spoken
  const lineParts = (line, level) => line == null ? [el('span', { class: 'sr-only', text: level + ': ' })]
    : [el('span', { class: 'sr-only', text: 'Line ' }), el('span', { class: 'rsb-line', text: String(line) }),
       el('span', { class: 'sr-only', text: ', ' + level + ': ' })];
  function markRows() {
    for (const [key, r] of rows) {
      const on = key === selected;
      r.btn.setAttribute('aria-expanded', String(on && openRow));
      if (on) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
      r.detail.hidden = !(on && openRow);
    }
  }
  function entryRow(e, key, byId, copy) {
    const t = clickTarget(e, textOf);
    const lvl = levelWord(e.level);
    const detailId = 'rsbDetail-' + (++seq);
    const btn = el('button', { type: 'button', class: 'rsb-row rsb-' + lvl, 'data-key': key, 'aria-expanded': 'false', 'aria-controls': detailId },
      ...lineParts(e.where && e.where.line, e.level), icon(lvl), el('span', { class: 'rsb-text', text: (copy ? '(copy) ' : '') + said(e) }));
    const more = [];
    const place = placeText(e.where);
    more.push(el('p', { class: 'rsb-place', text: place ? place + (t && t.missing ? ' (' + t.file + ' is not in the project)' : '') : 'Not tied to a place in a file.' }));
    if (e.need) more.push(el('p', { text: e.need }));
    if (e.source === 'checker' && e.fixes && e.fixes.length)
      more.push(el('h5', { class: 'rsb-detail-head', text: 'How to fix (best first)' }), el('ul', {}, ...e.fixes.map((f) => el('li', { text: oneLine(f.description) }))));
    if (e.calls) more.push(el('p', { text: 'Called at ' + e.calls.map((id) => placeText(byId.get(id).where)).join(', ') }));
    for (const a of e.also || []) more.push(el('p', { text: 'Also told by ' + a.source + ': ' + oneLine(a.message) }));
    const detail = el('div', { class: 'rsb-detail', id: detailId, hidden: true }, ...more);
    btn.addEventListener('click', () => {
      if (selected === key) openRow = !openRow; else { selected = key; openRow = true; }
      markRows();
      if (t && !t.missing && goTo) goTo(t);   // today's click to the line, unchanged (index.html reportGoTo)
    });
    rows.set(key, { btn, detail });
    return el('li', { class: 'rsb-item' }, btn, detail);
  }
  function closedRow(key, line, words, items) {
    const innerId = 'rsbInner-' + (++seq), open = openFolds.has(key);
    const btn = el('button', { type: 'button', class: 'rsb-fold', 'data-key': key, 'aria-expanded': String(open), 'aria-controls': innerId },
      el('span', { class: 'rail-chevron', 'aria-hidden': 'true', text: '▸' }), ...(line == null ? [] : [el('span', { class: 'sr-only', text: 'Line ' }),
      el('span', { class: 'rsb-line', text: String(line) }), el('span', { class: 'sr-only', text: ', ' })]), el('span', { class: 'rsb-text', text: words }));
    const inner = el('ul', { class: 'rsb-inner', id: innerId, hidden: !open }, ...items);
    btn.addEventListener('click', () => {
      const now = inner.hidden;
      inner.hidden = !now;
      btn.setAttribute('aria-expanded', String(now));
      if (now) openFolds.add(key); else openFolds.delete(key);
    });
    return el('li', { class: 'rsb-item' }, btn, inner);
  }
  const many = (n) => n + (n === 1 ? ' message' : ' messages');
  function drawList(c, lines) {
    const byId = new Map(c.entries.map((e) => [e.id, e]));
    const focused = doc.activeElement && built.list.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-key') : null;
    const scroll = root.scrollTop;
    rows = new Map(); seq = 0;
    const out = [];
    let file, ul = null;
    for (const line of lines) {
      if (!ul || line.file !== file) {
        file = line.file;
        out.push(el('h4', { class: 'rsb-file', text: (file ?? 'Not tied to a place') + (/\.(sty|cls)$/i.test(file || '') ? ' (package file)' : '') }));
        ul = el('ul', { class: 'rsb-rows' });
        out.push(ul);
      }
      if (line.again) {
        const a = line.again, key = 'a:' + a.ids[0];
        ul.append(closedRow(key, a.where && a.where.line, a.file + ', read again: ' + many(a.count) + ', the same as at ' +
          (a.first.file === a.where.file ? 'line ' + a.first.line : a.first.file + ':' + a.first.line),
          a.ids.map((id) => entryRow(byId.get(id), key + '/' + id, byId, true))));
      } else if (line.use) {
        const u = line.use, key = 'u:' + u.name + '@' + placeText(u.where);
        ul.append(closedRow(key, u.where && u.where.line, u.name + (u.via ? ' (through ' + u.via + ')' : '') + ': ' + many(u.count) +
          ' in its definition, ' + u.defined.file + ':' + u.defined.line, u.ids.map((id) => entryRow(byId.get(id), key + '/' + id, byId, true))));
      } else if (line.fold) {
        const f = line.fold, key = 'f:' + line.ids[0];
        ul.append(closedRow(key, f.from + (f.to !== f.from ? '-' + f.to : ''), f.level + ': ' + f.label + ': ' + f.count + ' in a row',
          line.ids.map((id) => entryRow(byId.get(id), key + '/' + id, byId, false))));
      } else ul.append(entryRow(byId.get(line.ids[0]), 'e:' + line.ids[0], byId, false));
    }
    if (!out.length) out.push(el('p', { class: 'rsb-empty', text: 'Nothing to show at this level. Choose Check or Everything above to see more.' }));
    built.list.replaceChildren(...out);
    if (selected && !rows.has(selected)) { selected = null; openRow = false; }
    markRows();
    if (focused) { const b = [...built.list.querySelectorAll('[data-key]')].find((x) => x.getAttribute('data-key') === focused); if (b) b.focus(); }
    root.scrollTop = scroll;
  }

  function draw() {
    const tool = state.tool();
    if (!tool) { note.hidden = false; body.hidden = true; return; }
    if (!built) build(tool);
    const show = state.ticks(), c = state.combined(show), lines = state.lines(c, show);
    note.hidden = true;
    body.hidden = false;
    update(tool, c, show, lines);
    drawList(c, lines);
  }

  // What the status bar and the auto-open after a run read (his call 4 "A"): the lines shown at the current ticks, the
  // level, and the most serious level among them; null before a run.
  function summary() {
    const tool = state.tool();
    if (!tool) return null;
    const show = state.ticks(), c = state.combined(show), lines = state.lines(c, show);
    const byId = new Map(c.entries.map((e) => [e.id, e]));
    const ids = lines.flatMap((l) => l.ids || []);
    const worst = ['error', 'warning', 'note'].find((lv) => ids.some((id) => byId.get(id) && byId.get(id).level === lv)) || null;
    return { shown: lines.length, level: tool.levelOf(show), worst };
  }

  state.subscribe(draw);
  draw();
  return { summary, draw };
}
