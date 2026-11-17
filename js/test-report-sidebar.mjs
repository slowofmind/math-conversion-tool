// test-report-sidebar.mjs — the Report section in the Tools panel, js/report-sidebar.js (report-sidebar step B1).
//   node js/test-report-sidebar.mjs        (cwd: the platform)
// Written by latex-preprocess session 314 BEFORE js/report-sidebar.js existed, and seen to fail. jsdom (from cm6-src's
// node_modules) gives a document; the tool is the platform's preprocess/ copy; the state is js/report-view.js's own,
// shared with a Report view drawn in the same document (HANDOFF-B1.md: "One shared state ... so ticks, counts and the
// two drawings cannot disagree").
//   S1 before a run: the note only
//   S2 after a run: the three levels (with counts) and the status line; no live region
//   S3 Settings: one closed accordion, an inner closed accordion per group (his words: "use accordions for the lower
//      level labels as well (fix this, check, etc.)"), a tick per category; its ids its own
//   S4 one copy: a tick or level changed in either drawing shows in both
//   S5 the list grouped by file; one row or closed line per line shown; "Line N" first in a row's name
//   S6 a row: click to the line (today's goTo, unchanged), its details open beneath, one open at a time
//   S7 a redraw keeps the open row and the focus
//   S8 the accordions remembered, closed by default
//   S9 summary(): what the status bar and call 4's auto-open read
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PLATFORM = new URL('../', import.meta.url);
const at = (rel) => new URL(rel, PLATFORM).href;
const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(at(rel)), 'utf8'));
const { JSDOM } = createRequire(new URL('cm6-src/package.json', PLATFORM))('jsdom');
const TOOL = {
  ...(await import(at('preprocess/v2/run.mjs'))),
  ...(await import(at('preprocess/v2/capability.mjs'))),
  ...(await import(at('preprocess/v2/latex-names.mjs'))),
  ...(await import(at('preprocess/v2/findings.mjs'))),
  ...(await import(at('preprocess/v2/a11y/check.mjs'))),
  ...(await import(at('preprocess/v2/combined.mjs'))),
};
const capability = TOOL.createCapability(read('preprocess/data/pandoc-latex-reader-index.json'));
const latexNames = TOOL.createLatexNames(read('preprocess/data/latex-names.json'));
const RV = await import(at('js/report-view.js'));
let SB = {};
try { SB = await import(at('js/report-sidebar.js')); } catch (e) { console.log('  (js/report-sidebar.js does not load: ' + e.message + ')'); }

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};
const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const sect = (t) => console.log('\n' + t);
const guard = (name, fn) => { try { fn(); } catch (e) { fail++; console.log(`  FAIL ${name} threw: ${e && e.message}`); } };
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const shown = (el) => !!el && !el.closest('[hidden]');
// an element's name as a screen reader gets it here: its text without what is aria-hidden (the chevrons)
const name = (el) => { if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove()); return text(c); };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

// The project test-report-view.mjs uses: \fitb unknown (Fix this), a drawing in \answerbox, a chapter \input.
const R = String.raw;
const FILES = {
  'main.tex': R`\documentclass{article}` + '\n' + R`\usepackage{handout}` + '\n' + R`\begin{document}` + '\n' +
    R`Hello \fitb{x}.` + '\n' + R`\input{chap1}` + '\n' + R`\answerbox` + '\n' + R`\end{document}` + '\n',
  'chap1.tex': 'Chapter text.\n',
  'handout.sty': R`\ProvidesPackage{handout}` + '\n' + R`\newcommand{\answerbox}{\fbox{\parbox{2in}{\vspace{1in}}}}` + '\n',
};
const run = TOOL.runProject(FILES, { capability, entry: 'main.tex', latexNames });
const kept = { tool: TOOL, run, files: FILES, entry: 'main.tex', converted: 'main-pp.tex' };
const textOf = (p) => (p in FILES ? FILES[p] : null);
const LOG = [{ type: 'SkippedContent', verbosity: 'INFO', contents: R`\fitb`, source: '', line: 4, column: 11,
               pretty: R`Skipped '\fitb' at line 4 column 11` }];

// A page: a Report view and the sidebar in one document, on one state (the view's, as index.html does).
function page({ store = mem(), oldViews = null, withView = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="view"></div><div id="side"></div></body>');
  const doc = dom.window.document;
  const gone = [];
  const goTo = (t) => { gone.push(t); return true; };
  const view = withView ? RV.initReportView({ root: doc.getElementById('view'), storage: store, textOf, goTo, oldViews }) : null;
  const state = view ? view.state : RV.createReportState({ storage: store });
  // words: as index.html hands them (a module never imports another by a relative path: test-asset-urls)
  const words = { clickTarget: RV.clickTarget, said: RV.said, oneLine: RV.oneLine };
  const side = SB.initReportSidebar ? SB.initReportSidebar({ root: doc.getElementById('side'), state, words, storage: store, textOf, goTo, oldViews }) : null;
  return { doc, state, view, side, gone, store, root: doc.getElementById('side') };
}
const settingsToggle = (p) => [...p.root.querySelectorAll('h3 > button')].find((b) => name(b) === 'Settings') || null;
const groupToggles = (p) => { const t = settingsToggle(p); const panel = t && p.doc.getElementById(t.getAttribute('aria-controls'));
  return panel ? [...panel.querySelectorAll('h4 > button')] : []; };
const rowFor = (p, id) => p.root.querySelector(`[data-key="e:${id}"]`);
const fitbOf = (c) => c.entries.find((e) => e.category === 'unknown' && /fitb/.test(e.message));

sect('S1 before a run: the note only');
guard('S1', () => {
  ok('S1a initReportSidebar is exported', typeof SB.initReportSidebar === 'function');
  const p = page();
  const note = p.root.querySelector('.rsb-note');
  ok('S1b a note naming Process file', shown(note) && /Process file/.test(text(note)), text(note));
  ok('S1c no level shown yet', [...p.root.querySelectorAll('input')].every((i) => !shown(i)));
  eq('S1d summary() is null', p.side && p.side.summary(), null);
});

sect('S2 after a run: the three levels with their counts, the status line; no live region');
guard('S2', () => {
  const p = page();
  p.state.keep(kept);
  const show = p.state.ticks(), c = p.state.combined(show), n = p.state.lines(c, show).length;
  const radios = [...p.root.querySelectorAll('input[type=radio]')];
  eq('S2a three radios in one group, the levels in order', [radios.map((r) => r.value), new Set(radios.map((r) => r.name)).size], [TOOL.LEVELS, 1]);
  eq('S2b each labelled with its count (counts.levels)', radios.map((r) => text(r.closest('label'))),
     TOOL.LEVELS.map((lv) => lv + ' (' + c.counts.levels[lv] + ')'));
  ok('S2c Fix this checked (the default), all shown', radios[0].checked && !radios[1].checked && !radios[2].checked && radios.every(shown));
  ok('S2d inside a fieldset whose legend is "Level"', radios.every((r) => text(r.closest('fieldset') && r.closest('fieldset').querySelector('legend')) === 'Level'));
  eq('S2e the status line', text(p.root.querySelector('.rsb-status')),
     'Showing Fix this: ' + n + (n === 1 ? ' line.' : ' lines.') + ' Pandoc\'s messages join once the conversion has run.');
  ok('S2f no live region in the section', ![p.root, ...p.root.querySelectorAll('*')].some((el) => el.hasAttribute('aria-live') ||
     ['status', 'log', 'alert'].includes(el.getAttribute('role'))));
  ok('S2g the note hidden', !shown(p.root.querySelector('.rsb-note')));
});

sect('S3 Settings: a closed accordion; an inner closed accordion per group; a tick per category');
guard('S3', () => {
  const p = page();
  p.state.keep(kept);
  const t = settingsToggle(p);
  const panel = t && p.doc.getElementById(t.getAttribute('aria-controls'));
  ok('S3a "Settings": a button in an h3, closed, controlling a hidden region it labels', !!t && t.getAttribute('aria-expanded') === 'false' &&
     !!panel && panel.hidden && panel.getAttribute('role') === 'region' && panel.getAttribute('aria-labelledby') === t.id);
  const g = groupToggles(p);
  eq('S3b an inner accordion per group, in order', g.map(name), ['Fix this', 'Check', 'Everything', 'Accessibility checker']);
  ok('S3c each closed, controlling a hidden region it labels', g.length === 4 && g.every((b) => { const r = p.doc.getElementById(b.getAttribute('aria-controls'));
     return b.getAttribute('aria-expanded') === 'false' && !!r && r.hidden && r.getAttribute('role') === 'region' && r.getAttribute('aria-labelledby') === b.id; }));
  const boxes = panel ? [...panel.querySelectorAll('input[type=checkbox]')] : [];
  eq('S3d a tick per category, in the tool\'s order, under its own group', boxes.map((b) => [b.id, name(b.closest('[role=region]') &&
     p.doc.getElementById(b.closest('[role=region]').getAttribute('aria-labelledby')))]),
     TOOL.CATEGORIES.map((x) => ['rsbTick-' + x.key, x.level || 'Accessibility checker']));
  const show = p.state.ticks();
  eq('S3e ticked as the state\'s ticks', boxes.filter((b) => b.checked).map((b) => b.id.slice(8)), TOOL.CATEGORIES.map((x) => x.key).filter((k) => show.includes(k)));
  const by = p.state.combined(show).counts.byCategory;
  const lab = new Map(TOOL.CATEGORIES.map((x) => [x.key, x.label]));
  eq('S3f each tick\'s label: its name (a child under its parent\'s) and its count', boxes.map((b) => text(p.doc.querySelector(`label[for="${b.id}"]`))),
     TOOL.CATEGORIES.map((x) => (x.parent ? lab.get(x.parent) + ': ' : '') + x.label + ' (' + (by[x.key] || 0) + ')'));
  eq('S3g each tick\'s reason is its description', boxes.map((b) => text(p.doc.getElementById(b.getAttribute('aria-describedby')))),
     TOOL.CATEGORIES.map((x) => x.why));
  const ids = [...p.doc.querySelectorAll('[id]')].map((el) => el.id);
  ok('S3h every id in the document unique, the Report view drawn beside it', ids.length === new Set(ids).size,
     ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
  t.click();
  ok('S3i Settings opened: expanded, its region shown', t.getAttribute('aria-expanded') === 'true' && !panel.hidden);
  g[1].click();
  ok('S3j Check opened: expanded, its ticks shown', g[1].getAttribute('aria-expanded') === 'true' && shown(p.doc.getElementById('rsbTick-dropped')));
  let flag = false;
  const q = page({ oldViews: { get: () => flag, set: (v) => { flag = !!v; } } });
  q.state.keep(kept);
  eq('S3k with the page\'s "Show old views": a fifth group, "While testing"', groupToggles(q).map(name).slice(-1), ['While testing']);
  const old = q.doc.getElementById('rsbShowOld');
  ok('S3l its tick, labelled, off, sets the page\'s flag', !!old && text(q.doc.querySelector('label[for="rsbShowOld"]')) === 'Show old views (Preprocess and Log)' &&
     !old.checked && (old.click(), flag === true));
});

sect('S4 one copy: a tick or a level changed in either drawing shows in both');
guard('S4', () => {
  const p = page();
  p.state.keep(kept);
  p.doc.getElementById('rsbTick-unknown').click();
  ok('S4a a sidebar tick: the state\'s ticks change', !p.state.ticks().includes('unknown'));
  ok('S4b the Report view\'s same tick follows', !p.doc.getElementById('reportTick-unknown').checked);
  ok('S4c the sidebar\'s stays as clicked after its redraw', !p.doc.getElementById('rsbTick-unknown').checked);
  ok('S4d both say "Custom"', /Custom/.test(text(p.root.querySelector('.rsb-levels'))) && /Custom/.test(text(p.doc.querySelector('.report-levels'))));
  [...p.doc.querySelectorAll('input[name=reportLevel]')].find((r) => r.value === 'Check').click();
  const sel = [...p.root.querySelectorAll('input[type=radio]')].find((r) => r.checked);
  ok('S4e Check chosen in the Report view: the sidebar\'s Check is checked', !!sel && sel.value === 'Check');
  const on = (prefix, root) => [...root.querySelectorAll('input[type=checkbox]')].filter((b) => b.id.startsWith(prefix) && b.checked).map((b) => b.id.slice(prefix.length));
  eq('S4f the two drawings tick the same', on('rsbTick-', p.root), on('reportTick-', p.doc.getElementById('view')));
  eq('S4g and the state holds them', on('rsbTick-', p.root), TOOL.CATEGORIES.map((x) => x.key).filter((k) => p.state.ticks().includes(k)));
});

sect('S5 the list grouped by file; one row or closed line per line shown');
guard('S5', () => {
  const p = page();
  p.state.keep(kept);
  p.state.setTicks(TOOL.showFor('Everything'));
  const show = p.state.ticks(), c = p.state.combined(show), lines = p.state.lines(c, show);
  const files = lines.map((l) => l.file).filter((f, i, a) => i === 0 || a[i - 1] !== f);
  eq('S5a a heading per file, in the report\'s order', [...p.root.querySelectorAll('h4.rsb-file')].map(text),
     files.map((f) => (f ?? 'Not tied to a place') + (/\.(sty|cls)$/i.test(f || '') ? ' (package file)' : '')));
  eq('S5b one row or closed line per line shown', [...p.root.querySelectorAll('ul.rsb-rows > li')].length, lines.length);
  const f = fitbOf(c), row = f && rowFor(p, f.id);
  ok('S5c \\fitb\'s row: a button whose name starts "Line 4, <level>: " and holds its label', !!row && row.tagName === 'BUTTON' &&
     text(row).startsWith('Line 4, ' + f.level + ': ') && text(row).includes(f.label), text(row));
  ok('S5d its row holds the line number on its own, for the eye', !!row && text(row.querySelector('.rsb-line')) === '4');
  ok('S5e closed to begin with', !!row && row.getAttribute('aria-expanded') === 'false' && !row.hasAttribute('aria-current'));
});

sect('S6 a row: click to the line (goTo, unchanged); its details open beneath; one open at a time');
guard('S6', () => {
  const p = page();
  p.state.keep(kept);
  p.state.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '',
    rows: [{ level: 'warn', type: 'package', message: 'Canvas content: the package could not be made, so Download gives the plain output.' }] });
  p.state.setTicks(TOOL.showFor('Everything'));   // more rows with a place than Fix this has in this small project
  const show = p.state.ticks(), c = p.state.combined(show);
  const f = fitbOf(c), row = rowFor(p, f.id);
  row.click();
  eq('S6a goTo was given today\'s target', p.gone[p.gone.length - 1], RV.clickTarget(f, textOf));
  ok('S6b the row open and current', row.getAttribute('aria-expanded') === 'true' && row.getAttribute('aria-current') === 'true');
  const det = p.doc.getElementById(row.getAttribute('aria-controls'));
  ok('S6c its details beneath it, shown, with the place', !!det && shown(det) && row.closest('li').contains(det) &&
     text(det).includes('main.tex:4:' + f.where.column), text(det));
  const lines = p.state.lines(c, show);
  const otherId = lines.map((l) => l.ids && l.ids[0]).find((id) => id && id !== f.id && c.entries.find((e) => e.id === id).where.file);
  const other = otherId && rowFor(p, otherId);
  ok('S6d (a second row with a place exists)', !!other);
  other.click();
  ok('S6e a second row: it opens; the first closes and is no longer current', other.getAttribute('aria-expanded') === 'true' &&
     row.getAttribute('aria-expanded') === 'false' && !row.hasAttribute('aria-current') && det.hidden);
  const before = p.gone.length;
  other.click();
  ok('S6f the same row again: its details close; it goes to its place again', other.getAttribute('aria-expanded') === 'false' && p.gone.length === before + 1);
  const pk = c.entries.find((e) => e.source === 'platform' && !e.where.file);
  const prow = pk && rowFor(p, pk.id);
  const n = p.gone.length;
  ok('S6g a row with no place: under "Not tied to a place", a button with no line number', !!prow && text(prow).startsWith(pk.level + ': ') &&
     !prow.querySelector('.rsb-line'), prow ? text(prow) : 'no row');
  prow.click();
  ok('S6h activated: its details open, nothing is gone to', prow.getAttribute('aria-expanded') === 'true' && p.gone.length === n);
});

sect('S7 a redraw keeps the open row and the focus');
guard('S7', () => {
  const p = page();
  p.state.keep(kept);
  const c = p.state.combined(p.state.ticks()), f = fitbOf(c);
  const row = rowFor(p, f.id);
  row.focus(); row.click();
  p.state.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  const again = rowFor(p, f.id);
  ok('S7a after Pandoc joins (a redraw), the same row is open and current', !!again && again.getAttribute('aria-expanded') === 'true' &&
     again.getAttribute('aria-current') === 'true' && shown(p.doc.getElementById(again.getAttribute('aria-controls'))));
  ok('S7b and has the focus', p.doc.activeElement === again, p.doc.activeElement && p.doc.activeElement.outerHTML.slice(0, 80));
  const box = p.doc.getElementById('rsbTick-drawing');
  box.focus(); box.click();
  ok('S7c a tick clicked keeps the focus through the redraw', p.doc.activeElement === p.doc.getElementById('rsbTick-drawing'));
});

sect('S8 the accordions remembered, closed by default');
guard('S8', () => {
  const store = mem();
  const p = page({ store });
  p.state.keep(kept);
  settingsToggle(p).click();
  groupToggles(p)[1].click();
  ok('S8a remembered under "atc.report.sidebar"', store.getItem('atc.report.sidebar') != null);
  const q = page({ store });
  q.state.keep(kept);
  eq('S8b a new page: Settings and Check open again, the rest closed', [settingsToggle(q), ...groupToggles(q)].map((b) => b.getAttribute('aria-expanded')),
     ['true', 'false', 'true', 'false', 'false']);
  const r = page({ store: mem() });
  r.state.keep(kept);
  r.state.refresh();
  ok('S8c a redraw does not close what is open', (settingsToggle(r).click(), r.state.refresh(), settingsToggle(r).getAttribute('aria-expanded') === 'true'));
});

sect('S9 summary(): the lines shown, the level, the most serious shown');
guard('S9', () => {
  const p = page();
  eq('S9a nothing kept: null', p.side.summary(), null);
  p.state.keep(kept);
  const show = p.state.ticks(), c = p.state.combined(show), lines = p.state.lines(c, show);
  const byId = new Map(c.entries.map((e) => [e.id, e]));
  const ids = lines.flatMap((l) => l.ids || []);
  const worst = ['error', 'warning', 'note'].find((lv) => ids.some((id) => byId.get(id) && byId.get(id).level === lv)) || null;
  eq('S9b shown, level, worst', p.side.summary(), { shown: lines.length, level: 'Fix this', worst });
  p.state.setTicks([]);
  eq('S9c nothing ticked: 0 lines, "Custom", none', p.side.summary(), { shown: 0, level: 'Custom', worst: null });
});

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
