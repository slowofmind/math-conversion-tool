// test-preprocess-page.mjs — PLAN-9 step F's test, written first (call 86).
//
// jsdom builds the DOM from index.html with its scripts parsed, NOT run,
// and this checks the page's STRUCTURE for the pieces calls 87 to 92
// decided: the fifth Prepare step, the Preprocess tab and its panel, and
// where the import and the start-up call sit in the module script. It
// reads index.html and writes nothing, in the platform or anywhere (call
// 86). test-page-load.mjs already runs the whole script; once step F is
// in, it runs the start-up call too.
//
// Groups are named for the calls they check: F2 is call 87, F3 call 88,
// F5 call 90, F6 call 91, F7 call 92. F1, call 86, is this file. F4, call
// 89 - the report shown as plain text, then the tab switched to - is what
// the page DOES on a press, not what it contains: it is checked in step H.
// F0 checks the page as it stands, so a failure elsewhere is not a page
// that failed to load. Written before index.html changes: F0 passes, and
// every group after it fails, until the page's changes go in.
//
// Run from cm6-src, where jsdom resolves:   node test-preprocess-page.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const PLAT = 'C:/Users/nim022/Desktop/mma-code/Accessible-STEM-Project/pandoc-for-math-conversion';
const html = readFileSync(join(PLAT, 'index.html'), 'utf8');
const doc = new JSDOM(html).window.document;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('   ok   ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? ' :: ' + d : '')); } };
const group = (t) => console.log('\n' + t);
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const count = (s, sub) => s.split(sub).length - 1;

// ── F0: the page as it stands ─────────────────────────────────────────
group('F0 the page as it stands');
const scripts = [...doc.querySelectorAll('script')].filter((s) => s.textContent.trim());
ok('exactly one non-empty inline script', scripts.length === 1, String(scripts.length));
const js = scripts.length ? scripts[0].textContent : '';
ok('it is a module script', scripts[0]?.getAttribute('type') === 'module');
const prep = doc.getElementById('railPanelPrepare');
ok('the Prepare panel is there', !!prep);
const steps = prep ? [...prep.querySelectorAll('.prep-step')] : [];
// Steps 1-2 have been their buttons alone since 2026-09-30 (Nicholas: no number, title, count or
// explanation), so a step is known by its title, else by its button's text (updated 2026-10-06).
const titles = steps.map((s) => text(s.querySelector('.prep-title') || s.querySelector('.prep-btn')));
const FOUR = ['TikZ images', 'PDF images', 'Source cleanup', 'Math notation review'];
ok('its first four steps, in order', FOUR.every((t, i) => titles[i] === t), titles.join(' | '));
const tabs = [...doc.querySelectorAll('#selOutputView option')].map((o) => o.getAttribute('value'));
ok('the Output view options are Output, Code, Preprocess, Log (revised 2026-10-06; Intent moved to the sidebar)',
  tabs.join(',') === 'preview,source,preprocess,log', tabs.join(' | '));
const A_IMPORT = "import { initMathCATProof } from './js/mathcat-proof.js';";
// MathCAT's start-up call. The committed page never had a btnMathCATProof button; MathCAT is driven
// by the "Math subtitles" drop-down (updated 2026-10-06; was a btnMathCATProof click listener).
const A_MATHCAT = 'const mathcatProof = initMathCATProof({';
const A_PP_SECTION = '// LATEX PREPROCESSING — js/preprocess.js';
const A_TABS = '// OUTPUT TABS — js/output-tabs.js';
for (const a of [A_IMPORT, A_MATHCAT, A_PP_SECTION, A_TABS])
  ok('the script holds, once: ' + a, count(js, a) === 1, String(count(js, a)));

// ── F2, call 87: the fifth Prepare step ───────────────────────────────
group('F2 call 87: step 5, LaTeX preprocessing');
const s5 = steps[4] || null;
ok('there are five Prepare steps', steps.length === 5, String(steps.length));
ok('step 5 follows step 4 directly', !!s5 && s5.previousElementSibling === steps[3]);
ok('its number is 5', text(s5?.querySelector('.prep-num')) === '5', text(s5?.querySelector('.prep-num')));
ok('its title is "LaTeX preprocessing"', titles[4] === 'LaTeX preprocessing', titles[4]);
const btns = s5 ? [...s5.querySelectorAll('button')] : [];
const btn = btns[0] || null;
ok('it holds exactly one button', btns.length === 1, String(btns.length));
ok('a prep-btn of type button', !!btn && btn.classList.contains('prep-btn') && btn.getAttribute('type') === 'button');
ok('labelled "Preprocess & convert"', text(btn) === 'Preprocess & convert', text(btn));
const bid = btn?.id || '';
ok('with an id no other element has', !!bid && doc.querySelectorAll('[id="' + bid + '"]').length === 1, bid);
const hid = btn?.getAttribute('aria-describedby') || '';
const hint = hid ? doc.getElementById(hid) : null;
ok('described by a hint inside step 5',
  !!hint && !!s5 && s5.contains(hint) && hint.classList.contains('prep-status'), hid);
const h = text(hint);
for (const w of ['copies', 'main-pp.tex', 'original', 'Preprocess view'])
  ok('the hint mentions ' + w, h.includes(w), h.slice(0, 80));

// ── F3, call 88: the Preprocess tab, after Intent, and its panel ──────
group('F3 call 88, revised 2026-10-06: Preprocess in the Output view drop-down, and its panel');
const vsel = doc.getElementById('selOutputView');
const popts = vsel ? [...vsel.querySelectorAll('option[value="preprocess"]')] : [];
const tab = popts[0] || null;
ok('exactly one Output view option for preprocess', popts.length === 1, String(popts.length));
ok('it comes directly after Source (order confirmed 2026-10-06)',
  !!tab && tab.previousElementSibling?.getAttribute('value') === 'source');
ok('an option labelled "Preprocess"', !!tab && text(tab) === 'Preprocess', tab ? text(tab) : '');
ok('not the default view', !!tab && !tab.hasAttribute('selected'));
const panel = doc.getElementById('tabPreprocess');
ok('the panel output-tabs.js looks for, tabPreprocess, is there', !!panel);
ok('a view area (tab-content) without tab roles', !!panel &&
  panel.classList.contains('tab-content') && !panel.hasAttribute('role'));
ok('it comes directly after the Code view area (the Intent view moved to the sidebar, 2026-10-06)',
  !!panel && panel.previousElementSibling === doc.getElementById('tabSource'));
ok('until the first press it holds a note naming the button',
  text(panel).includes('Preprocess & convert'), text(panel).slice(0, 80));

// ── F5, call 90: no live region on the report ─────────────────────────
group('F5 call 90: no live region in the Preprocess panel');
const live = panel ? [panel, ...panel.querySelectorAll('*')].filter((el) =>
  el.hasAttribute('aria-live') || ['status', 'log', 'alert'].includes(el.getAttribute('role'))) : null;
ok('the panel and all it holds: no aria-live, no status, log or alert role',
  !!live && live.length === 0, live ? String(live.length) : 'no panel');

// ── F6, call 91: the button is not disabled by the page ───────────────
group('F6 call 91: the button is not disabled');
ok('the button carries no disabled attribute', !!btn && !btn.hasAttribute('disabled'));

// ── F7, call 92: the import, the start-up call, the tool not loaded at start
group('F7 call 92: where the import and the start-up call sit');
const B_IMPORT = "import { initPreprocess } from './js/preprocess.js';";
const jl = js.split(/\r?\n/);
const ia = jl.indexOf(A_IMPORT);
ok('the import, once', count(js, B_IMPORT) === 1, String(count(js, B_IMPORT)));
ok("on the line after MathCAT's import", ia >= 0 && jl[ia + 1] === B_IMPORT, jl[ia + 1]);
const pc = js.indexOf('initPreprocess(');
ok('the start-up call, once', count(js, 'initPreprocess(') === 1, String(count(js, 'initPreprocess(')));
ok("after MathCAT's block, before the output tabs are made",
  js.indexOf(A_MATHCAT) >= 0 && js.indexOf(A_MATHCAT) < js.indexOf(A_PP_SECTION)
  && pc > js.indexOf(A_PP_SECTION) && pc < js.indexOf(A_TABS));
const call = pc >= 0 ? js.slice(pc, js.indexOf(A_TABS)) : '';
for (const k of ['model', 'editor', 'openProjectFile', 'syncAuxFiles', 'runConversion',
  'showReport', 'updateLog', 'updateStatus', 'loadTable', 'loadTool'])
  ok('it is handed ' + k, new RegExp('\\b' + k + '\\b').test(call));
ok('the tool is not imported at start: no import from ./preprocess/',
  !/^\s*import\b[^;]*from\s*['"]\.\/preprocess\//m.test(js));

// ── F8, call 101: the reader table a file opened from the tree needs ──
// openProjectFile reads READER_BY_EXT[entry.ext]. The file tree's commit,
// a6eed16, used that name and never defined it, so every text file opened
// from the tree threw there, and so did the press (HANDOFF 40.3). Call 101:
// an exact copy of handleFileUpload's formatMap, entry for entry and in its
// order, declared before openProjectFile. Written before index.html's fix:
// all three fail until it goes in.
group('F8 call 101: READER_BY_EXT, the reader for a file opened from the tree');
const R_DECL = 'const READER_BY_EXT = Object.freeze({';
const rd = jl.findIndex((l) => l.trim() === R_DECL);
const po = jl.findIndex((l) => l.trim().startsWith('async function openProjectFile('));
const between = (at, end) => { const out = [];
  if (at < 0) return out;
  for (let i = at + 1; i < jl.length && jl[i].trim() !== end; i++) out.push(jl[i].trim());
  return out; };
const rEntries = between(rd, '});');
const fEntries = between(jl.findIndex((l) => l.trim() === 'const formatMap = {'), '};');
ok('declared once', count(js, 'const READER_BY_EXT') === 1, String(count(js, 'const READER_BY_EXT')));
ok('before openProjectFile', rd >= 0 && po >= 0 && rd < po, rd + ' ' + po);
ok("its entries are handleFileUpload's formatMap's, line for line",
  rEntries.length > 0 && rEntries.join(' | ') === fEntries.join(' | '),
  rEntries.length + ' lines against ' + fEntries.length);

console.log('\n──────── ' + pass + ' passed, ' + fail + ' failed ────────');
process.exitCode = fail ? 1 : 0;
