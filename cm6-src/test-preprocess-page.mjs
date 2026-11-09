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
// 2026-11-09 (Nicholas): LaTeX Find/Replace, the sidebar section once called Cleanup, moved here as the fifth.
ok('five accordions, in order', accTitles.join(' | ') === 'Images | LaTeX preprocessing | Math notation review | Intent snippets | LaTeX Find/Replace', accTitles.join(' | '));
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
// 2026-11-09 (Nicholas): an "Autoprocess" box beside the button, and an Options accordion under it with "Hide temp
// files" ("I am thinking of adding an accordion under the "Process file" button, and having the checkbox live in that
// accordion"). Was: it holds exactly one button.
const btns = s5 ? [...s5.querySelectorAll('button')] : [];
const btn = btns[0] || null;
ok('it holds two buttons: Process file, then the Options accordion\'s toggle',
  btns.length === 2 && btns[1].classList.contains('prep-accordion-toggle'), btns.map((b) => b.id).join(','));
ok('a prep-btn of type button', !!btn && btn.classList.contains('prep-btn') && btn.getAttribute('type') === 'button');
ok('labelled "Process file"', text(btn) === 'Process file', text(btn));
const bid = btn?.id || '';
ok('with an id no other element has', !!bid && doc.querySelectorAll('[id="' + bid + '"]').length === 1, bid);
ok('no hint, description or tooltip', !!btn && !btn.hasAttribute('aria-describedby') && !btn.hasAttribute('title')
  && !s5?.querySelector('.prep-status') && !doc.getElementById('preprocessHint'));
const h = text(doc.getElementById('preprocessNote'));
for (const w of ['Process file', 'copies', 'main-pp.tex', 'original'])
  ok('the Preprocess view\'s note mentions ' + w, h.includes(w), h.slice(0, 80));

// ── P1, 2026-11-09 (Nicholas, preprocess-autoconvert\NOTE-PREPROCESS-AUTOCONVERT-ANALYSIS.md) ──────────────────
// "the "preprocess" button should [have] an "autoconvert" checkbox similar to the "image handling buttons" ... have
// preprocessing run when the "convert" button is pushed"; "-pp" copies hidden by default ("hide temp files"), the box
// in an accordion under "Process file". Settings are not remembered between visits (as the image boxes).
group('P1 2026-11-09: Autoprocess beside Process file; Options with Hide temp files; Convert through preprocessing');
ok('the panel is a two-column grid, as Images is', !!s5 && s5.classList.contains('prep-grid'));
const autoBox = doc.getElementById('chkAutoPreprocess');
const autoLbl = autoBox && autoBox.closest('label');
ok('an "Autoprocess" checkbox, ticked, beside the button in the same row, styled as the image boxes',
  !!autoBox && autoBox.type === 'checkbox' && autoBox.hasAttribute('checked') && !!autoLbl &&
  autoLbl.classList.contains('image-auto') && !!btn && autoLbl.parentElement === btn.parentElement &&
  btn.parentElement.classList.contains('image-row') && text(autoLbl).startsWith('Autoprocess'), autoLbl ? text(autoLbl) : '');
ok('its name adds screen-reader-only words, as the image boxes\' do', !!autoLbl && !!autoLbl.querySelector('.sr-only'));
const optAcc = doc.getElementById('prepPreprocessOptions');
const optToggle = doc.getElementById('prepPreprocessOptionsToggle');
const optPanel = doc.getElementById('prepPreprocessOptionsPanel');
ok('an Options accordion inside the panel, right after the row', !!optAcc && !!s5 && s5.contains(optAcc) &&
  optAcc.classList.contains('prep-accordion') && !!btn && optAcc.previousElementSibling === btn.parentElement);
ok('its heading is an h4 holding the toggle "Options"', !!optToggle && optToggle.parentElement?.tagName === 'H4' &&
  optToggle.classList.contains('prep-accordion-toggle') && text(optToggle).endsWith('Options'), optToggle ? text(optToggle) : '');
ok('the toggle controls its panel, starts open, and remembers under its own key, as the other accordions do',
  !!optToggle && !!optPanel && optToggle.getAttribute('aria-controls') === optPanel.id &&
  optToggle.getAttribute('aria-expanded') === 'true' && optToggle.dataset.store === 'atc.prep.preprocess.options' &&
  optPanel.getAttribute('role') === 'region' && optPanel.getAttribute('aria-labelledby') === optToggle.id);
const hideBox = doc.getElementById('chkHideTempFiles');
ok('"Hide temp files", ticked, in the Options panel', !!hideBox && hideBox.type === 'checkbox' &&
  hideBox.hasAttribute('checked') && !!optPanel && optPanel.contains(hideBox) &&
  text(hideBox.closest('label')).startsWith('Hide temp files'), hideBox ? text(hideBox.closest('label')) : '');
const convAt = js.indexOf("document.getElementById('btnConvert').addEventListener('click'");
const conv = convAt >= 0 ? js.slice(convAt, convAt + 900) : '';
ok('Convert goes through preprocessing (auto) when Autoprocess applies, else converts as before',
  /if \(autoPreprocessApplies\(\)\) runPreprocess\(\{ auto: true \}\);\s*else runConversion\(\);/.test(conv), conv.slice(0, 160));
const appAt = js.indexOf('function autoPreprocessApplies(');
const applies = appAt >= 0 ? js.slice(appAt, appAt + 500) : '';
ok('...which needs Autoprocess ticked, no binary input file, and LaTeX input',
  /chkAutoPreprocess/.test(applies) && /inputBinaryFile/.test(applies) && /'latex'/.test(applies), applies.slice(0, 160));
ok('runConversion takes the preprocessed text (pre)', /async function runConversion\(pre = null\)/.test(js));
ok('the file tree and its summary leave out tagged copies while Hide temp files is ticked, and redraw on a change',
  /const hideTempFile = \(e\) => e\.source === 'preprocessed' && !!document\.getElementById\('chkHideTempFiles'\)\?\.checked;/.test(js) &&
  /hideEntry: hideTempFile/.test(js) && /projectModel\.summaryText\(\{ skip: hideTempFile \}\)/.test(js) &&
  /getElementById\('chkHideTempFiles'\)\?\.addEventListener\('change', \(\) => fileTree\.render\(\)\)/.test(js));

// ── P2, 2026-11-09: preprocessing's log lines survive the conversion they start ──────────────────────
// Found in the browser: every conversion redraws the whole Log, so a press's own lines (what was saved; with
// Autoprocess, why preprocessing did not run) vanished once its conversion logged. They are collected while a press
// runs and put at the top of that conversion's Log; a press that converts nothing leaves nothing behind.
group('P2 2026-11-09: a press\'s log lines kept at the top of its conversion\'s Log');
ok('the glue logs through logPreprocess: shown at once, and collected while a press runs',
  /let preprocessLines = null;/.test(js) &&
  /function logPreprocess\(w\) \{ if \(preprocessLines\) preprocessLines\.push\(\.\.\.w\); updateLog\(w\); \}/.test(js) &&
  /updateLog: logPreprocess/.test(js));
ok('every press goes through runPreprocess: collecting for that press only; a press during a press ignored',
  /const \{ run: runPreprocessPress \} = initPreprocess\(\{/.test(js) &&
  /async function runPreprocess\(opts\) \{\s*if \(preprocessLines\) return false;\s*preprocessLines = \[\];\s*try \{ return await runPreprocessPress\(opts\); \} finally \{ preprocessLines = null; \}\s*\}/.test(js));
ok('the conversion puts them first in its Log',
  /const warnings = parseWarnings\(result\.warnings, result\.stderr, sourceText \|\| ''\);\s*\n\s*\/\/[^\n]*\n\s*if \(preprocessLines && preprocessLines\.length\) warnings\.unshift\(\.\.\.preprocessLines\.splice\(0\)\);/.test(js));

// ── P3, 2026-11-09 (Nicholas): experimental sections ─────────────────────────────────────────────────────────────
// Math notation review and Intent snippets: "I want the accordion for each to appear greyed out and have a hover
// message that reads "Experimental, under construction". users can still click on them and try them ... When either
// is expanded, I want the message "Under construction" to appear directly under the expanded accordion label. When
// expanded, the labels do not need to appear greyed out." Tooltip option (b) ("I agree with you about option "(b)""):
// on hover AND keyboard focus, with the same words as the label's description for screen readers; greys pass 4.5:1.
// Then: "do the same thing for the "Cleanup" accordion, but also change the name from "Cleanup" to "LaTeX
// Find/Replace"" - a sidebar section, so its tooltip opens upward (a collapsed section can sit at the sidebar's bottom
// edge). One shared rule: a section marked "experimental" gets all of this.
group('P3 2026-11-09: experimental sections (Math notation review, Intent snippets, LaTeX Find/Replace)');
const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
  .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const cssVar = (n) => (new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})').exec(css) || [])[1];
const EXP = [
  { name: 'Math notation review', tog: 'prepReviewToggle', tip: 'prepReviewTip', note: '#prepReviewPanel', grey: '#5f5f5f',
    bgs: ['bg-primary', 'bg-elevated'], rule: '.prep-accordion.experimental .prep-accordion-toggle[aria-expanded="false"] { color: #5f5f5f; }' },
  { name: 'Intent snippets', tog: 'prepSnippetsToggle', tip: 'prepSnippetsTip', note: '#prepSnippetsPanel', grey: '#5f5f5f',
    bgs: ['bg-primary', 'bg-elevated'], rule: '.prep-accordion.experimental .prep-accordion-toggle[aria-expanded="false"] { color: #5f5f5f; }' },
  { name: 'LaTeX Find/Replace', tog: 'prepFindReplaceToggle', tip: 'prepFindReplaceTip', note: '#prepFindReplacePanel', grey: '#5f5f5f',
    bgs: ['bg-primary', 'bg-elevated'], rule: '.prep-accordion.experimental .prep-accordion-toggle[aria-expanded="false"] { color: #5f5f5f; }' },
];
for (const s of EXP) {
  const t = doc.getElementById(s.tog), tp = doc.getElementById(s.tip), box = t && t.parentElement && t.parentElement.parentElement;
  ok(`${s.name}: its section marked experimental`, !!box && box.classList.contains('experimental'));
  ok(`${s.name}: its label described by a tooltip "Experimental, under construction", right after the label in the heading`,
    !!t && !!tp && t.getAttribute('aria-describedby') === s.tip && tp.getAttribute('role') === 'tooltip' &&
    tp.classList.contains('exp-tip') && text(tp) === 'Experimental, under construction' &&
    tp.parentElement === t.parentElement && tp.previousElementSibling === t, tp ? text(tp) : '(none)');
  ok(`${s.name}: the label still a plain, clickable toggle (not disabled)`, !!t && !t.disabled && !t.hasAttribute('aria-disabled'));
  const holder = doc.querySelector(s.note), first = holder && holder.firstElementChild;
  ok(`${s.name}: "Under construction" is the first line under the label when expanded`, !!first &&
    first.classList.contains('exp-note') && text(first) === 'Under construction', first ? first.outerHTML.slice(0, 90) : '(none)');
  const rs = s.bgs.map((b) => [b, cssVar(b)]).map(([b, h]) => `${b} ${h} ${h ? ratio(s.grey, h).toFixed(2) : '?'}`);
  ok(`${s.name}: collapsed label grey ${s.grey}, passing 4.5:1 on ${s.bgs.join(' and ')}`, css.includes(s.rule) &&
    s.bgs.every((b) => cssVar(b) && ratio(s.grey, cssVar(b)) >= 4.5), rs.join(' / '));
}
// Then: "I want to change "LaTeX Find/Replace" so that it is a subcategory of "File Preparation" rather than it's own
// top-level feature." Last of File Preparation's accordions (F0); its controls keep their ids.
const fr = doc.getElementById('prepFindReplaceToggle'), frPanel = doc.getElementById('prepFindReplacePanel');
ok('LaTeX Find/Replace is an accordion inside File Preparation (an h3 under its h2), its region named by its label',
  !!fr && text(fr).replace(/^▸\s*/, '') === 'LaTeX Find/Replace' && fr.parentElement.tagName === 'H3' &&
  !!fr.closest('#railPanelPrepare') && !!frPanel && frPanel.getAttribute('aria-labelledby') === 'prepFindReplaceToggle',
  fr ? text(fr) : '(none)');
ok('its controls moved with it, ids unchanged (profile, scope, conversion box, run button)',
  ['cleanupProfile', 'profileScopeHeader', 'chkCleanupOnConvert', 'btnRunCleanup'].every((id) => !!frPanel && frPanel.contains(doc.getElementById(id))));
const railLabels = [...doc.querySelectorAll('.rail-section-toggle')].map((b) => text(b).replace(/^▸\s*/, '')).join(' | ');
ok('the sidebar has two top-level sections now: Project Files and File Preparation',
  railLabels === 'Project Files | File Preparation' && !doc.getElementById('railtab-cleanup') && !doc.getElementById('railPanelCleanup') &&
  !/railtab-cleanup|railPanelCleanup/.test(js), railLabels);
ok('no sidebar section or File Preparation accordion is labelled "Cleanup"',
  ![...doc.querySelectorAll('.rail-section-toggle, .prep-accordion-toggle')].some((b) => /\bCleanup\b/.test(text(b))));
const HEADS = '.experimental > :is(.prep-accordion-heading, .rail-section-heading)';
ok('CSS, one shared rule: tooltip hidden; shown on hover and on keyboard focus while collapsed, not once dismissed; upward when flipped',
  /\.exp-tip \{ display: none;/.test(css) &&
  css.includes(HEADS + ':not(.tip-dismissed):hover > [aria-expanded="false"] + .exp-tip') &&
  css.includes(HEADS + ':not(.tip-dismissed) > [aria-expanded="false"]:focus-visible + .exp-tip') &&
  css.includes('.exp-tip.tip-up { top: auto; bottom: 100%; }') && !css.includes('.rail-section.experimental .exp-tip {'));
ok('the old one-off names are gone (prep-experimental, prep-tip, prep-under-construction)',
  !/prep-experimental|prep-tip|prep-under-construction/.test(html));
const tipsAt = js.indexOf('function initExperimentalTips(');
const tipsJs = tipsAt >= 0 ? js.slice(tipsAt, tipsAt + 4000) : '';
ok('Escape hides a showing tooltip in any experimental section; it can show again once the pointer or focus leaves; started once',
  tipsJs.includes(`'${HEADS}'`) && /'Escape'/.test(tipsJs) && /tip-dismissed/.test(tipsJs) && /mouseleave/.test(tipsJs) &&
  /focusout/.test(tipsJs) && count(js, 'initExperimentalTips();') === 1);
// 2026-11-09, found in the browser: under LaTeX Find/Replace, File Preparation's last accordion, the tooltip was
// clipped by 6 px at the bottom of File Preparation's scrolling area. Each time a tooltip shows, it opens upward if
// that area has no room below the label (and has room above).
ok('a tooltip opens upward when the area it scrolls in has no room below its label (decided each time it shows)',
  /'mouseenter'/.test(tipsJs) && /'focusin'/.test(tipsJs) && /tip-up/.test(tipsJs) && /overflowY/.test(tipsJs) &&
  /getBoundingClientRect/.test(tipsJs));

// ── P4, 2026-11-09 (Nicholas): which File Preparation accordions start open ──────────────────────────────────────
// "I want for "Images" and "LaTeX preprocessing" to start open, but the other three (math notation, intent snippets,
// and now latex find/replace) to all start closed." Each starts as its markup says; a reader's own choice, remembered
// under its data-store key, still wins. (LaTeX preprocessing's nested Options accordion is unchanged: open.)
group('P4 2026-11-09: File Preparation accordions start open or closed as their markup says');
const START = { prepImagesToggle: true, prepPreprocessToggle: true, prepPreprocessOptionsToggle: true,
  prepReviewToggle: false, prepSnippetsToggle: false, prepFindReplaceToggle: false };
for (const [id, open] of Object.entries(START)) {
  const t = doc.getElementById(id), p = t && doc.getElementById(t.getAttribute('aria-controls'));
  ok(`${id}: its markup starts it ${open ? 'open' : 'closed'}`, !!t && !!p && t.getAttribute('aria-expanded') === String(open) && p.hidden === !open,
    t ? `aria-expanded=${t.getAttribute('aria-expanded')} hidden=${p && p.hidden}` : '(none)');
}
const initAt = js.indexOf('function initPrepAccordions()'), initEnd = js.indexOf('\ninitPrepAccordions();', initAt);
const initSrc = initAt >= 0 && initEnd > initAt ? js.slice(initAt, initEnd) : '';
const runInit = (stored) => {   // the page's own initPrepAccordions, on a fresh copy of the page, with a stand-in storage
  const d = new JSDOM(html).window.document;
  const store = { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = v; } };
  new Function('document', 'localStorage', initSrc + '\ninitPrepAccordions();')(d, store);
  return (id) => { const t = d.getElementById(id), p = t && d.getElementById(t.getAttribute('aria-controls'));
    return !!t && !!p && t.getAttribute('aria-expanded') === 'true' && !p.hidden; };
};
let fresh = null, chosen = null;
try { fresh = runInit({}); chosen = runInit({ 'atc.prep.review': 'open', 'atc.prep.images': 'closed' }); }
catch (e) { console.log('   (initPrepAccordions did not run: ' + e.message + ')'); }
ok('nothing remembered: Images and LaTeX preprocessing open; Math notation review, Intent snippets, LaTeX Find/Replace closed',
  !!fresh && fresh('prepImagesToggle') && fresh('prepPreprocessToggle') && !fresh('prepReviewToggle') &&
  !fresh('prepSnippetsToggle') && !!doc.getElementById('prepFindReplaceToggle') && !fresh('prepFindReplaceToggle'));
ok('a remembered choice still wins (Math notation review remembered open, Images remembered closed)',
  !!chosen && chosen('prepReviewToggle') && !chosen('prepImagesToggle') && !chosen('prepSnippetsToggle'));

// ── P5, 2026-11-09 (Nicholas): Project Files opens when files are loaded; File Preparation starts open ──────────────
// "I need for the "File Prep" accordion to start open. I need for the "Project Files" accordion to start closed, but to
// open when files are loaded into the platform ... if somehow only loads 1 file, it only opens a bit, but if someone
// uploads a whole project, then it opens wide enough to display all the files. If additional files are uploaded after
// the fact, then it does not need to open wider." Limit: "probably a one-third limit might be sufficient" (the divider
// still resizes it). Proposed and kept: Project Files always starts closed (files never survive a reload); File
// Preparation starts open unless the reader closed it; closed by hand and files loaded again, it opens again.
group('P5 2026-11-09: Project Files opens on load, sized to its files; File Preparation starts open');
const rt = (id) => doc.getElementById(id);
ok('markup: Project Files starts closed, File Preparation open',
  rt('railtab-files').getAttribute('aria-expanded') === 'false' && rt('railPanelFiles').hidden &&
  !rt('railPanelFiles').closest('.rail-section').classList.contains('open') &&
  rt('railtab-prepare').getAttribute('aria-expanded') === 'true' && !rt('railPanelPrepare').hidden &&
  rt('railPanelPrepare').closest('.rail-section').classList.contains('open'));
// The page's own start-up rule (RAIL_STATE_KEY through railOpen), run with a stand-in storage.
const stAt = js.indexOf('const RAIL_STATE_KEY'), roAt = stAt >= 0 ? js.indexOf('const railOpen = (() => {', stAt) : -1;
const roEnd = roAt >= 0 ? js.indexOf('})();', roAt) + 5 : -1;
const startSrc = stAt >= 0 && roAt > stAt && roEnd > roAt ? js.slice(stAt, roEnd) : '';
const startOpen = (stored) => {
  try { return [...new Function('localStorage', startSrc + '\nreturn railOpen;')({ getItem: (k) => (k in stored ? stored[k] : null) })].sort().join(','); }
  catch (e) { return 'error: ' + e.message; }
};
const st = (o) => ({ 'atc.rail.state': JSON.stringify(o) });
ok('start-up, nothing remembered: File Preparation open, Project Files closed', startOpen({}) === 'prepare', startOpen({}));
ok('start-up, File Preparation closed by the reader last time: it stays closed',
  startOpen(st({ prepare: 'closed' })) === '', startOpen(st({ prepare: 'closed' })));
ok('start-up, Project Files open last time: it still starts closed (it would be empty)',
  startOpen(st({ files: 'open', prepare: 'open' })) === 'prepare', startOpen(st({ files: 'open', prepare: 'open' })));
const fnBody = (head) => { const a = js.indexOf(head); return a < 0 ? '' : js.slice(a, js.indexOf('\n}\n', a)); };
ok('only a reader\'s own open or close (a header click) is remembered; opens made by the platform are not; the old key is cleared',
  !/localStorage/.test(fnBody('function setRailSection(')) && /localStorage\.setItem\(RAIL_STATE_KEY/.test(js) &&
  /localStorage\.removeItem\('atc\.rail\.open'\)/.test(js) && !/RAIL_OPEN_KEY/.test(js));
ok('every way a user loads files opens Project Files: single file, support files, folder, project zip',
  ['async function handleFileUpload(', 'async function addSupportFiles(', 'async function adoptProjectFiles(', 'async function importProjectZip(']
    .every((f) => fnBody(f).includes('revealProjectFiles();')));
ok('files the platform makes itself (converted images, preprocessing copies) do not: called from those four only',
  count(js, 'revealProjectFiles();') === 4, String(count(js, 'revealProjectFiles();')));
const rev = fnBody('function revealProjectFiles('), sz = fnBody('function sizeProjectFiles(');
ok('already open when files arrive: left as it is (no resizing)', /if \(railOpen\.has\('files'\)\) return;/.test(rev));
ok('sized to its file list, at least the sections\' minimum, at most a third of the height; not saved (the divider stays the reader\'s)',
  /fileTreeHost/.test(sz) && /RAIL_MIN_PX/.test(sz) && /total \/ 3/.test(sz) && /layoutRailSections\(\)/.test(sz) && !/saveRailSizes/.test(sz));
ok('measured on the next frame after the load, or once the Tools panel has opened if it was closed',
  /requestAnimationFrame\(sizeProjectFiles\)/.test(rev) && /filesSizePending/.test(fnBody('function setSidebarOpen(')) &&
  /transitionend/.test(fnBody('function sizeProjectFilesWhenShown(')) &&
  js.indexOf('let filesSizePending') >= 0 && js.indexOf('let filesSizePending') < js.indexOf('function setSidebarOpen('));

// ── P6, 2026-11-09 (Nicholas): the divider between Project Files and File Preparation, at rest ─────────────────────
// "I want to make the baseline divider a little bit thicker/darker to differentiate it from the lines above it" so
// "users have a better intuition that they can grab and drag". At rest: a 3 px #8a8a8a bar (3:1 for a control on the
// sidebar's background, WCAG 1.4.11; the 1 px #cccccc lines above are 1.47:1). Hover, drag and focus unchanged: the
// whole 5 px strip in --accent-dim, the bar stepping aside.
group('P6 2026-11-09: the sections\' divider at rest is a thicker, darker bar');
ok('at rest: a 3 px #8a8a8a bar across the divider',
  css.includes('.rail-sash::before { content: \'\'; position: absolute; left: 0; right: 0; top: 1px; height: 3px; background: #8a8a8a; }'));
ok('hover, drag and keyboard focus look as before: the bar steps aside for the --accent-dim strip',
  css.includes('.rail-sash:hover::before, .rail-sash.dragging::before, .rail-sash:focus-visible::before { background: transparent; }') &&
  css.includes('.rail-sash:hover, .rail-sash.dragging { background: var(--accent-dim); }'));
const bg2 = cssVar('bg-secondary');
ok('the bar meets 3:1 against the sidebar\'s background (a control\'s boundary, WCAG 1.4.11)',
  !!bg2 && ratio('#8a8a8a', bg2) >= 3, `${bg2} ${bg2 ? ratio('#8a8a8a', bg2).toFixed(2) : ''}`);

// ── P7, 2026-11-09: Project Files' size leaves room for the file details line filled in ──────────────────────────────
// Found while answering Nicholas's question about the details line ("it can stay as it is"): sized to fit exactly,
// selecting the only file grew the line 15 -> 39 px and hid part of the file's own row. Nicholas: "yes" (fix it). The
// sizing measures the longest details any file here gets (the tree's own detailText, cm6-src/test-file-tree-detail.mjs)
// on a hidden copy: never on the live region itself, which would announce.
group('P7 2026-11-09: Project Files\' size leaves room for the filled-in details line');
const szDetail = fnBody('function sizeProjectFiles(');
ok('the sizing measures the filled-in details line with the tree\'s own detailText',
  /fileTreeDetail/.test(szDetail) && /fileTree\.detailText\(/.test(szDetail));
ok('on a hidden copy (aria-hidden, no live region, removed afterwards); the real details line is never written to',
  /aria-hidden/.test(szDetail) && /removeAttribute\('aria-live'\)/.test(szDetail) && /\.remove\(\)/.test(szDetail) &&
  !/detailEl\.textContent\s*=/.test(szDetail));

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
