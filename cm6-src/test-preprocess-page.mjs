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
import { createHash } from 'node:crypto';
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
// Since 2026-10-06 (Nicholas) File Preparation is four accordions, in this order, with no numbered
// steps: Images ("TikZ to PDF", then "PDF to SVG"), LaTeX preprocessing, Math notation review,
// Source cleanup (temporary; it will go once preprocessing does more).
// latex-preprocess s299 (lists plan step 6, his "Yes, start step 6", 2026-11-03): Source cleanup, which held only
// Smart Cleanup, is retired - the List Markers filter replaces it. Three accordions now.
const accs = prep ? [...prep.querySelectorAll('.sidebar-body > .prep-accordion')] : [];
const accTitles = accs.map((a) => text(a.querySelector('.prep-accordion-toggle')).replace(/^▸/, ''));
// [CLAUDE 2026-11-08] Intent snippets added as the fourth (snippet tool in the editor, Alt+Shift+I;
// Nicholas 2026-11-08 "Build it this way").
ok('four accordions, in order', accTitles.join(' | ') === 'Images | LaTeX preprocessing | Math notation review | Intent snippets', accTitles.join(' | '));
ok('no numbered steps left', steps.length === 0 && !prep?.querySelector('.prep-num'), String(steps.length));
const imgPanel = doc.getElementById('prepImagesPanel');
const imgBtns = imgPanel ? [...imgPanel.querySelectorAll('button')].map((b) => b.id + '=' + text(b)).join(',') : '';
ok('Images: "TikZ to PDF", then "PDF to SVG"', imgBtns === 'btnImageHandling=TikZ to PDF,btnConvertPdfs=PDF to SVG', imgBtns);
const tabs = [...doc.querySelectorAll('#selOutputView option')].map((o) => o.getAttribute('value'));
// latex-preprocess s292: Report added (the combined report's platform step 2), Preprocess and Log kept
ok('the Output view options are Output, Code, Preprocess, Log, Report (revised 2026-10-06; Intent moved to the sidebar; Report s292)',
  tabs.join(',') === 'preview,source,preprocess,log,report', tabs.join(' | '));
const A_IMPORT = "import { initMathCATProof } from './js/mathcat-proof.js';";
// MathCAT's start-up call. The committed page never had a btnMathCATProof button; MathCAT is driven
// by the "Math subtitles" drop-down (updated 2026-10-06; was a btnMathCATProof click listener).
const A_MATHCAT = 'const mathcatProof = initMathCATProof({';
const A_PP_SECTION = '// LATEX PREPROCESSING — js/preprocess.js';
const A_TABS = '// OUTPUT TABS — js/output-tabs.js';
for (const a of [A_IMPORT, A_MATHCAT, A_PP_SECTION, A_TABS])
  ok('the script holds, once: ' + a, count(js, a) === 1, String(count(js, a)));

// ── F2, call 87: the fifth Prepare step ───────────────────────────────
// (Step 5, then step 3, until 2026-10-06; now the "LaTeX preprocessing" accordion, right after
// Images, holding only its button "Process file", with no hint or tooltip: Nicholas. What it does
// (works on -pp copies; originals never changed) is now said in the Preprocess view's note.)
group('F2 call 87: the LaTeX preprocessing accordion and its "Process file" button');
const s5 = doc.getElementById('prepPreprocessPanel');
ok('it comes right after Images', accs[0]?.id === 'prepImages' && !!s5 && !!accs[1]?.contains(s5), accs.map((a) => a.id).join(','));
const btns = s5 ? [...s5.querySelectorAll('button')] : [];
const btn = btns[0] || null;
ok('it holds exactly one button', btns.length === 1, String(btns.length));
ok('a prep-btn of type button', !!btn && btn.classList.contains('prep-btn') && btn.getAttribute('type') === 'button');
ok('labelled "Process file"', text(btn) === 'Process file', text(btn));
const bid = btn?.id || '';
ok('with an id no other element has', !!bid && doc.querySelectorAll('[id="' + bid + '"]').length === 1, bid);
ok('no hint, description or tooltip', !!btn && !btn.hasAttribute('aria-describedby') && !btn.hasAttribute('title')
  && !s5?.querySelector('.prep-status') && !doc.getElementById('preprocessHint'));
const h = text(doc.getElementById('preprocessNote'));
for (const w of ['Process file', 'copies', 'main-pp.tex', 'original'])
  ok('the Preprocess view\'s note mentions ' + w, h.includes(w), h.slice(0, 80));

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
  text(panel).includes('Process file'), text(panel).slice(0, 80));   // the button's name since 2026-10-06 (was "Preprocess & convert")

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

// ── L6, latex-preprocess s299: lists plan step 6 (LISTS-HTML-FILTER-PLAN-s294) ──
// His words (2026-11-03): List Markers checked by default; Default Lists unchecked, "only there as a backup in case
// someone needs to format lists in the output without using the preprocessor"; Smart Cleanup retired. The filter's
// text is the platform's filters/list-markers.lua, embedded in BUILT_IN_FILTERS as Default Lists is. Written before
// index.html changes: every check here fails until they go in.
group('L6 s299: List Markers on, Default Lists off, Smart Cleanup retired');
const bfAt = js.indexOf('const BUILT_IN_FILTERS = [');
const bfEnd = bfAt >= 0 ? js.indexOf('\n];', bfAt) : -1;
let BF = [];
try { BF = bfAt >= 0 && bfEnd > bfAt ? new Function('return ' + js.slice(bfAt + 'const BUILT_IN_FILTERS = '.length, bfEnd + 2))() : []; }
catch (e) { ok('BUILT_IN_FILTERS reads as JavaScript', false, e.message); }
const bf = (id) => BF.find((f) => f.id === id);
// latex-preprocess s307: 'blanks' joins the order after list-markers (blanks plan step 7, his "Yes, copy them",
// 2026-11-04) - the agreed new entry; the rest of the order is unchanged.
ok('built-in filters in order: default-lists, list-markers, blanks, resolve-image-paths, embed-images',
  BF.map((f) => f.id).join(',') === 'default-lists,list-markers,blanks,resolve-image-paths,embed-images', BF.map((f) => f.id).join(','));
ok('Default Lists is off by default', bf('default-lists')?.defaultEnabled === false, String(bf('default-lists')?.defaultEnabled));
ok('its tooltip says it is the backup for files not run through the preprocessor',
  /backup/i.test(bf('default-lists')?.description || '') && /preprocessor/i.test(bf('default-lists')?.description || ''), bf('default-lists')?.description);
const LM = bf('list-markers');
ok('List Markers: named "List Markers", file list-markers.lua, on by default',
  LM?.name === 'List Markers' && LM?.filename === 'list-markers.lua' && LM?.defaultEnabled === true, JSON.stringify(LM && { ...LM, content: undefined }));
ok('its tooltip is the planned one (unticked, every list marker appears twice)',
  (LM?.description || '').startsWith('List Markers: shows each list item') && /appears twice/.test(LM?.description || ''), LM?.description);
let lmFile = '';
try { lmFile = readFileSync(join(PLAT, 'filters', 'list-markers.lua'), 'utf8'); } catch { /* missing */ }
ok('filters/list-markers.lua is there', lmFile.length > 0);
ok('the embedded text is exactly filters/list-markers.lua', !!LM && LM.content === lmFile,
  LM ? 'embedded ' + LM.content.length + ' chars, file ' + lmFile.length : 'no entry');
ok('Smart Cleanup is gone from the page: no button, hint or accordion',
  !doc.getElementById('btnSmartCleanup') && !doc.getElementById('smartCleanupHint') && !doc.getElementById('prepSourceCleanup'));
ok('and from the script: no import or start-up of smart-cleanup', !/smart-cleanup|initSmartCleanup/.test(js));

// ── L7, latex-preprocess s307: blanks plan step 7 (BLANKS-FILTER-PLAN-s300) ──
// His words (2026-11-04): "Start step 7", then "Yes, copy them". The Blanks filter shows each handout.sty
// fill-in-the-blank (\fitb, \cfitb, \mfitb, \fitbox, \cfitbox) as a line with a lighter "blank" on it, and a
// solution's answer bold on its line. On by default, run right after List Markers (L6 checks the order). Its text is
// the platform's filters/blanks.lua, a copy of the tool folder's _work/blanks.lua, embedded as List Markers is.
// Written before index.html changes: every check here fails until they go in.
group('L7 s307: Blanks on, embedded, the same text as the tool folder\'s filter');
const BL = bf('blanks');
ok('Blanks: named "Blanks", file blanks.lua, on by default',
  BL?.name === 'Blanks' && BL?.filename === 'blanks.lua' && BL?.defaultEnabled === true, JSON.stringify(BL && { ...BL, content: undefined }));
ok('its tooltip is the planned one (names \\fitb, says "[blank]" elsewhere, unticked a blank shows nothing)',
  (BL?.description || '').startsWith('Blanks: shows each fill-in-the-blank (\\fitb, \\cfitb, \\fitbox ...)')
  && (BL?.description || '').includes('"[blank]"') && /unticked, a blank shows nothing/.test(BL?.description || ''), BL?.description);
let blFile = '';
try { blFile = readFileSync(join(PLAT, 'filters', 'blanks.lua'), 'utf8'); } catch { /* missing */ }
ok('filters/blanks.lua is there', blFile.length > 0);
ok('the embedded text is exactly filters/blanks.lua', !!BL && BL.content === blFile,
  BL ? 'embedded ' + BL.content.length + ' chars, file ' + blFile.length : 'no entry');
const TOOL_BLANKS = join(PLAT, '..', 'latex-preprocess', '_work', 'blanks.lua');
let toolBl = '';
try { toolBl = readFileSync(TOOL_BLANKS, 'utf8'); } catch { /* missing */ }
const sha12 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
ok('filters/blanks.lua is the tool folder\'s _work/blanks.lua, byte for byte (s304: 999a244c3083)',
  blFile.length > 0 && blFile === toolBl, 'platform ' + (blFile ? sha12(blFile) : 'missing') + ', tool ' + (toolBl ? sha12(toolBl) : 'missing'));

console.log('\n──────── ' + pass + ' passed, ' + fail + ' failed ────────');
process.exitCode = fail ? 1 : 0;
