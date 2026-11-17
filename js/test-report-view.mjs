// test-report-view.mjs — the Report view's data, js/report-view.js createReportState.
//   node test-report-view.mjs          (cwd: js)
// Written by latex-preprocess session 292 (the combined report's platform step 2,
// PLAN-COMBINED-PLATFORM-s278) BEFORE js/report-view.js existed, and seen to fail.
//
// REAL: the tool, the platform's preprocess/ copy (run, capability, the names list,
// findings, the checker, the combined report). The state is handed what
// js/preprocess.js's keepRun hands the page (test-preprocess.mjs E20), then what a
// conversion gives (Pandoc's JSON log, its error text), and must hand the tool's
// combineEntries the run's own unread parts, openings and package uses
// (unreadParts / openingsOf / packageUsesOf of the run and the ORIGINAL files), the
// main file, and the order the checker read the files in.
//   R1 the lists and options combineEntries is given after a run
//   R2 the conversion the press started: Pandoc's lines placed in the original main file
//   R3 a conversion of another file: not taken, the report says it is from the last run
//   R4 a second conversion of the same file: not taken twice
//   R5 Pandoc stopped: its error text is one entry
//   R6 the level line (counts.levels) and the list by position (positionLines)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLATFORM = new URL('../', import.meta.url);
const at = (rel) => new URL(rel, PLATFORM).href;
const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(at(rel)), 'utf8'));
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
const { createReportState } = await import(new URL('js/report-view.js', PLATFORM).href);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};
const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const sect = (t) => console.log('\n' + t);

// A small project: a style file with a command whose definition holds a drawing, used twice;
// a chapter \input; an unknown command in running text (\fitb, defined nowhere).
const R = String.raw;
const FILES = {
  'main.tex': R`\documentclass{article}` + '\n' + R`\usepackage{handout}` + '\n' + R`\begin{document}` + '\n' +
    R`Hello \fitb{x}.` + '\n' + R`\input{chap1}` + '\n' + R`\answerbox` + '\n' + R`\end{document}` + '\n',
  'chap1.tex': 'Chapter text.\n',
  'handout.sty': R`\ProvidesPackage{handout}` + '\n' + R`\newcommand{\answerbox}{\fbox{\parbox{2in}{\vspace{1in}}}}` + '\n',
};
const run = TOOL.runProject(FILES, { capability, entry: 'main.tex', latexNames });
const kept = { tool: TOOL, run, files: FILES, entry: 'main.tex', converted: 'main-pp.tex' };

// The tool, spied: what combineEntries is given.
const given = [];
const SPY = { ...TOOL, combineEntries: (lists, options) => { given.push({ lists, options }); return TOOL.combineEntries(lists, options); } };

sect('R1 after a run: combineEntries gets the run\'s entries, the checker\'s, unread / opens / packages, main and order');
{
  const s = createReportState();
  s.keep({ ...kept, tool: SPY });
  const c = s.combined(TOOL.showFor('Everything'));
  const g = given[given.length - 1] || { lists: {}, options: {} };
  const checked = TOOL.checkRun(run, FILES);
  eq('R1a preprocessor entries = runEntries(run, files)', g.lists.preprocessor, TOOL.runEntries(run, FILES));
  eq('R1b checker entries = checkRun(run, files).entries', g.lists.checker, checked.entries);
  eq('R1c no Pandoc entries yet', g.lists.pandoc, []);
  eq('R1d unread = unreadParts(run, files)', g.options.unread, TOOL.unreadParts(run, FILES));
  eq('R1e opens = openingsOf(run, files)', g.options.opens, TOOL.openingsOf(run, FILES));
  eq('R1f packages = packageUsesOf(run, files)', g.options.packages, TOOL.packageUsesOf(run, FILES));
  eq('R1g main and order', [g.options.main, g.options.order], ['main.tex', checked.files]);
  ok('R1h the names list reached the run: \\fitb is reported as nobody understands it',
     !!c && c.entries.some((e) => e.category === 'unknown' && /fitb/.test(e.message)), JSON.stringify(c && c.entries.map((e) => e.category)));
  eq('R1i the state says: from the run, Pandoc not yet', { pandoc: s.status().pandoc, stale: s.status().stale }, { pandoc: 'waiting', stale: false });
}

// Pandoc's JSON log as pandoc-wasm returns it for the main file given on stdin (source "").
const LOG = [{ type: 'SkippedContent', verbosity: 'INFO', contents: R`\fitb`, source: '', line: 4, column: 11,
               pretty: R`Skipped '\fitb' at line 4 column 11` }];

sect('R2 the conversion the press started: Pandoc\'s lines join, in the original main file');
{
  const s = createReportState();
  s.keep(kept);
  const took = s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  const c = s.combined(TOOL.showFor('Everything'));
  const p = c.entries.filter((e) => e.source === 'pandoc' || e.also.some((a) => a.source === 'pandoc'));
  ok('R2a taken', took === true);
  ok('R2b one Pandoc line, in main.tex, line 4', p.length === 1 &&
     ((p[0].source === 'pandoc' ? p[0] : p[0].also.find((a) => a.source === 'pandoc')).where || {}).file === 'main.tex',
     JSON.stringify(p.map((e) => [e.source, e.where])));
  eq('R2c status', s.status().pandoc, 'joined');
}

sect('R3 a conversion of another file: not taken; the report says it is from the last run');
{
  const s = createReportState();
  s.keep(kept);
  const took = s.pandoc({ target: 'other.tex', warnings: LOG, stderr: '' });
  ok('R3a not taken', took === false);
  eq('R3b no Pandoc entries; stale', { n: s.combined(TOOL.showFor('Everything')).counts.pandoc, stale: s.status().stale }, { n: 0, stale: true });
}

sect('R4 a second conversion of the same file: not taken twice');
{
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  const again = s.pandoc({ target: 'main-pp.tex', warnings: [...LOG, ...LOG], stderr: '' });
  eq('R4a not taken; Pandoc count stays 1; stale', [again, s.combined().counts.pandoc, s.status().stale], [false, 1, true]);
  s.keep(kept);
  eq('R4b a new run: fresh again', [s.status().stale, s.status().pandoc, s.combined().counts.pandoc], [false, 'waiting', 0]);
}

sect('R5 Pandoc stopped: its error text is one entry, placed in the main file');
{
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', error: 'Error at (line 4, column 1):\nunexpected end of input' });
  const stops = s.combined(TOOL.showFor('Everything')).entries.filter((e) => e.category === 'pandoc-stop');
  eq('R5a one stop, in main.tex', stops.map((e) => e.where.file), ['main.tex']);
}

sect('R6 the level line and the list by position');
{
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  const show = TOOL.showFor('Fix this');
  const c = s.combined(show);
  eq('R6a the level line from counts.levels', s.levelLine(c),
     `Fix this: ${c.counts.levels['Fix this']}. Check would add ${c.counts.levels['Check']}, Everything ${c.counts.levels['Everything']}.`);
  eq('R6b the lines = positionLines(combined, show)', s.lines(c, show), TOOL.positionLines(c, show));
  ok('R6c nothing kept: combined is null', createReportState().combined() === null);
}

// ---------------------------------------------------------------- step 3 (session 293)
// Click to the line, and the marks handed to the editor. Written BEFORE the code, seen to fail.
//   R7  which file and range a click on an entry targets (clickTarget)
//   R8  a file not in the project: the place as text, said to be missing
//   R9  the ranges of a place over several lines, and of a place with no column
//   R10 the marks handed to the editor: tool.marks(combined, show), main file only, in setDiagnostics' shape
//   R11 the ticks drive the marks
const { clickTarget, lineRanges } = await import(new URL('js/report-view.js', PLATFORM).href);
const textOf = (p) => (p in FILES ? FILES[p] : null);

sect('R7 a click targets the entry\'s file, line and range');
{
  const s = createReportState();
  s.keep(kept);
  const c = s.combined(TOOL.showFor('Everything'));
  const fitb = c.entries.find((e) => e.category === 'unknown' && /fitb/.test(e.message));
  const w = fitb && fitb.where;
  eq('R7a \\fitb (main.tex): opens main, line 4, its own range', fitb && clickTarget(fitb, textOf),
     w && { file: 'main.tex', line: 4, column: w.column, opens: 'main', ranges: [{ line: 4, startCol: w.column, endCol: w.endColumn }] });
  eq('R7b \\fitb sits on "\\fitb" in the line', w && FILES['main.tex'].split('\n')[3].slice(w.column - 1, w.column + 4), R`\fitb`);
  const sty = c.entries.find((e) => e.where && e.where.file === 'handout.sty' && e.where.line != null);
  ok('R7c an entry in handout.sty: opens "file", in handout.sty', !!sty && clickTarget(sty, textOf).opens === 'file' &&
     clickTarget(sty, textOf).file === 'handout.sty', JSON.stringify(sty && sty.where));
  eq('R7d an entry with no place: no target', clickTarget({ where: { file: null, line: null }, opens: null }, textOf), null);
}

sect('R8 a file not uploaded with the project: the place as text, said to be missing');
{
  const e = { where: { file: 'questions.tex', line: 12, column: 3, endLine: 12, endColumn: 9 }, opens: 'file' };
  eq('R8a missing, "questions.tex:12"', clickTarget(e, textOf), { file: 'questions.tex', line: 12, column: 3, opens: 'file', missing: true, text: 'questions.tex:12' });
}

sect('R9 ranges: one line, several lines, no column');
{
  const text = 'abc\ndefgh\nij\n';
  eq('R9a one line', lineRanges({ line: 2, column: 2, endLine: 2, endColumn: 4 }, text), [{ line: 2, startCol: 2, endCol: 4 }]);
  eq('R9b several lines: to the line end, whole middle lines, to the end column',
     lineRanges({ line: 1, column: 2, endLine: 3, endColumn: 2 }, text),
     [{ line: 1, startCol: 2, endCol: 4 }, { line: 2, startCol: 1, endCol: 6 }, { line: 3, startCol: 1, endCol: 2 }]);
  eq('R9c ending at column 1 of a line: that line not marked', lineRanges({ line: 1, column: 1, endLine: 2, endColumn: 1 }, text),
     [{ line: 1, startCol: 1, endCol: 4 }]);
  eq('R9d no column: the whole line', lineRanges({ line: 2, column: null, endLine: null, endColumn: null }, text), [{ line: 2, startCol: 1, endCol: 6 }]);
  eq('R9e no end: one character', lineRanges({ line: 3, column: 2, endLine: null, endColumn: null }, text), [{ line: 3, startCol: 2, endCol: 3 }]);
  eq('R9f an empty line: one column', lineRanges({ line: 4, column: null }, text), [{ line: 4, startCol: 1, endCol: 2 }]);
  // seen in the page (s293, ws2-3): Pandoc places "Could not load include file fontspec.sty" at main.tex:3:22, just past
  // the end of "\usepackage{fontspec}"; a range there marks nothing, so the whole line is marked
  eq('R9g a place past the line\'s end: the whole line', lineRanges({ line: 2, column: 6, endLine: null, endColumn: null }, text),
     [{ line: 2, startCol: 1, endCol: 6 }]);
  eq('R9h a place past the line\'s end, with an end: the whole line', lineRanges({ line: 1, column: 4, endLine: 1, endColumn: 5 }, text),
     [{ line: 1, startCol: 1, endCol: 4 }]);
}

sect('R10 the marks handed to the editor: tool.marks(combined, show), the main file only');
{
  const spied = [];
  const MSPY = { ...TOOL, marks: (c, show) => { spied.push({ c, show }); return TOOL.marks(c, show); } };
  const s = createReportState();
  s.keep({ ...kept, tool: MSPY });
  s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  const show = TOOL.showFor('Everything');
  const c = s.combined(show);
  const d = s.diagnostics(c, show, textOf);
  const last = spied[spied.length - 1];
  ok('R10a tool.marks was asked, with this combined and these ticks', !!last && last.c === c && last.show === show);
  const want = TOOL.marks(c, show).filter((m) => m.file === 'main.tex');
  eq('R10b for main.tex, one per main-file mark', [d.file, d.diags.length], ['main.tex', want.length]);
  const byId = new Map(c.entries.map((e) => [e.id, e]));
  const fitb = c.entries.find((e) => e.category === 'unknown' && /fitb/.test(e.message));
  const i = want.findIndex((m) => m.id === (fitb && fitb.id));
  eq('R10c \\fitb\'s mark: setDiagnostics\' shape', i >= 0 ? d.diags[i] : null,
     fitb && { line: 4, startCol: fitb.where.column, endCol: fitb.where.endColumn, severity: { error: 'error', warning: 'warn', note: 'info' }[fitb.level],
               message: fitb.label + ': ' + fitb.message });
  ok('R10d every mark in setDiagnostics\' shape, on one line', d.diags.every((x) => Number.isInteger(x.line) && x.startCol >= 1 &&
     x.endCol > x.startCol && ['error', 'warn', 'info'].includes(x.severity) && typeof x.message === 'string'), JSON.stringify(d.diags));
  ok('R10e nothing from chap1.tex or handout.sty', want.every((m) => byId.get(m.id).where.file === 'main.tex'));
  eq('R10f nothing kept: no marks', createReportState().diagnostics(null, show, textOf), null);
}

sect('R11 the ticks drive the marks');
{
  const s = createReportState();
  s.keep(kept);
  const all = TOOL.showFor('Everything');
  const c = s.combined(all);
  const fitb = c.entries.find((e) => e.category === 'unknown' && /fitb/.test(e.message));
  const off = all.filter((k) => k !== fitb.category);
  const c2 = s.combined(off);
  const n = (cc, sh) => s.diagnostics(cc, sh, textOf).diags.length;
  eq('R11a \\fitb\'s tick off: one mark fewer', n(c, all) - n(c2, off), c.entries.filter((e) => e.category === fitb.category && e.where.file === 'main.tex' && e.where.line != null).length);
  ok('R11b and at least one', n(c, all) > n(c2, off));
}

// R12 (s293, seen in the page): pandoc-wasm names the main file given on stdin "/stdin", not "" as desktop
// Pandoc does; its lines must still be placed in the original main file (s292's page showed a "/stdin" heading).
sect('R12 pandoc-wasm\'s "/stdin": Pandoc\'s lines placed in the original main file');
{
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', warnings: LOG.map((x) => ({ ...x, source: '/stdin' })), stderr: '' });
  const c = s.combined(TOOL.showFor('Everything'));
  const files = c.entries.flatMap((e) => [e, ...e.also]).filter((e) => e.source === 'pandoc').map((e) => e.where && e.where.file);
  eq('R12a one Pandoc line, in main.tex', files, ['main.tex']);
}

// R13 (latex-preprocess s309; report-sidebar\PLAN-REPORT-SIDEBAR.md step A2): the page's own Log rows reach the
// report as "Other messages" (his call 1 "A", 2026-11-16). The rows are the page's shapes (index.html, js/preprocess.js),
// with words seen in the page (report-sidebar\a0\S2.json, S4.json, S5.json). Pandoc's rows are not platform messages.
sect('R13 the platform\'s own messages: mapped from the page\'s rows, joined with the conversion the press started');
{
  const RV = await import(new URL('js/report-view.js', PLATFORM).href);
  const ROWS = [
    { level: 'info', type: 'preprocess', message: 'Preprocess: main.tex changed; saved main-pp.tex; converting main-pp.tex as main.tex.' },
    { level: 'warn', type: 'project-paths', line: null, matchedText: null, at: { file: 'main.tex', line: 5, ref: 'missing' },
      message: R`Could not follow \input{missing}: no file of that name in the project. Its text is not in the output.` },
    { level: 'warn', type: 'placeholder', message: 'Missing image "x.png" — replaced with 1×1 transparent placeholder.' },
    { level: 'warn', type: 'package', message: 'Canvas content: 1 image was not found, so doc.imscc doesn\'t include it: x.png' },
    { level: 'warn', type: 'preview-image', message: 'Image "x.png" (on main.html) is not in the output, so it can\'t be shown.' },
    { level: 'error', type: 'exception', message: 'Tip: Upload "x.png" via the Media tab.' },
    { level: 'info', type: 'SkippedContent', line: 3, message: R`Skipped '\vspace{1em}'` },
    { level: 'error', type: 'stderr', message: 'ERROR: Error at "/stdin" (line 16, column 23):' },
    { level: 'info', message: 'MathCAT proofing ready' },
  ];
  const m = RV.platformMessages(ROWS);
  eq('R13a the six platform kinds, in order; Pandoc\'s rows and untyped rows are not among them',
     m.map((x) => [x.said, x.label, x.level]),
     [['preprocess', 'preprocessing', 'info'], ['paths', 'project paths', 'warn'], ['placeholder', 'image placeholder', 'warn'],
      ['packaging', 'packaging', 'warn'], ['preview', 'preview', 'warn'], ['conversion', 'conversion', 'error']]);
  eq('R13b a path row keeps its place, in the converted text, and the file it names', [m[1].file, m[1].line, m[1].in, m[1].ref, m[0].file, m[0].in],
     ['main.tex', 5, 'converted', 'missing', null, null]);
  const s = createReportState();
  s.keep({ ...kept, tool: SPY });
  s.combined(TOOL.showFor('Everything'));
  eq('R13c before a conversion: no platform messages', (given[given.length - 1] || { lists: {} }).lists.platform, []);
  ok('R13d not taken before the conversion joins', s.other({ rows: ROWS }) === false);
  s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '', rows: ROWS });
  const c = s.combined(TOOL.showFor('Everything'));
  const plat = c.entries.filter((e) => e.source === 'platform');
  const path = plat.find((e) => e.rule === 'platform/paths');
  eq('R13e joined with the conversion: six, five problems and one piece of information',
     [c.counts.platform, c.counts.byCategory['other-problem'], c.counts.byCategory['other-info']], [6, 5, 1]);
  ok('R13f the path message is placed in main.tex', !!path && path.where.file === 'main.tex' && Number.isInteger(path.where.line),
     JSON.stringify(path && path.where));
  ok('R13g later rows of the same conversion are taken', s.other({ rows: ROWS }) === true);
  eq('R13h the same list again: replaced, not added', s.combined(TOOL.showFor('Everything')).counts.platform, 6);
  s.other({ rows: [...ROWS, { level: 'warn', type: 'package', message: 'Canvas content: the package could not be made' }] });
  eq('R13i a list with one more row: one more', s.combined(TOOL.showFor('Everything')).counts.platform, 7);
  s.pandoc({ target: 'other.tex', warnings: [], stderr: '' });
  ok('R13j after a conversion of another file: not taken', s.other({ rows: ROWS }) === false);
  ok('R13k no report kept: not taken', createReportState().other({ rows: ROWS }) === false);
  const t = createReportState();
  t.keep(kept);
  t.pandoc({ target: 'other.tex', warnings: [], stderr: '', rows: ROWS });
  eq('R13l rows with a conversion of another file: not taken', t.combined(TOOL.showFor('Everything')).counts.platform, 0);
}

// R14 (latex-preprocess s310; report-sidebar step A2b): Pandoc's stop as the page gets it from pandoc-wasm. Seen in the
// page (report-sidebar\a0\S6.json): the Log's five rows `ERROR: Error at "/stdin" (line 16, column 23):`, `unexpected }`,
// `expecting \end{document}`, the source line, `^`, while the report said "Pandoc: stopped (0)".
sect('R14 Pandoc\'s stop from pandoc-wasm ("ERROR: Error at "/stdin" ..."): one "Pandoc stopped" entry, in the original');
{
  const RV = await import(new URL('js/report-view.js', PLATFORM).href);
  const S6 = 'ERROR: Error at "/stdin" (line 16, column 23):\nunexpected }\nexpecting ' + R`\end{document}` +
    '\nA stray closing brace } and an environment end with no beginning:\n                      ^\n';
  const t = RV.pandocStopText(S6);
  eq('R14a the prefix goes and "/stdin" is the unnamed input; the rest is kept', t && t.split('\n').slice(0, 3),
     ['Error at (line 16, column 23):', 'unexpected }', R`expecting \end{document}`]);
  eq('R14b a line that is not a stop is not one', [RV.pandocStopText("ERROR: File 'figures/x.png' not found in resource path\n"), RV.pandocStopText('')],
     [null, null]);
  eq('R14c lines before the stop are left out of it', (RV.pandocStopText('[WARNING] something\n' + S6) || '').split('\n')[0],
     'Error at (line 16, column 23):');
  // the same text for the test project: the -pp line holding \input{chap1}
  const pp = run.output.get('main.tex').split('\n');
  const L = pp.findIndex((l) => l.includes(R`\input{chap1}`)) + 1;
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', warnings: [], stderr: S6.replace('line 16, column 23', 'line ' + L + ', column 1') });
  const c = s.combined(TOOL.showFor('Fix this'));
  const stop = c.entries.filter((e) => e.source === 'pandoc');
  eq('R14d one Pandoc entry, "Pandoc stopped", shown at Fix this', stop.map((e) => [e.category, e.shown, e.label]),
     [['pandoc-stop', true, 'Pandoc stopped']]);
  eq('R14e placed in main.tex at the original line of \\input{chap1} (line 5)', stop.map((e) => [e.where.file, e.where.line]), [['main.tex', 5]]);
  const u = createReportState();
  u.keep(kept);
  u.pandoc({ target: 'main-pp.tex', warnings: [], stderr: "ERROR: File 'figures/x.png' not found in resource path\n" });
  eq('R14f a missing-resource line alone: no Pandoc entry (the page\'s placeholder message tells it)',
     u.combined(TOOL.showFor('Everything')).entries.filter((e) => e.source === 'pandoc').length, 0);
}

// R15 (latex-preprocess s312; report-sidebar step A3): one place to look per conversion. His words (2026-11-16): "No
// preprocessing or combined report should appear in the preview window for non latex input", and for LaTeX without a
// preprocessing run, "Option A (the log file, like non-latex input)". So the Report view is offered only while it holds
// the latest conversion, and input that is not LaTeX gets neither it nor the Preprocess view.
sect('R15 which output views to leave out: the Report view only for the latest conversion of a run; no LaTeX, no Preprocess');
{
  const RV = await import(new URL('js/report-view.js', PLATFORM).href);
  const s = createReportState();
  const hid = (from) => RV.hiddenViews(s.status(), from);
  // s313 (step A4, his call 3 "Option A is good for now"): the Preprocess view is left out always, and the Log while
  // the report holds the latest conversion, unless "Show old views" is ticked (R16). R15's cases updated on purpose.
  const NO_REPORT = { report: true, preprocess: true, log: false }, REPORT = { report: false, preprocess: true, log: true };
  eq('R15a nothing kept yet, LaTeX: no Report view; the Log', hid('latex'), NO_REPORT);
  s.keep(kept);
  eq('R15b a run, its conversion not yet joined: no Report view', hid('latex'), NO_REPORT);
  s.pandoc({ target: 'main-pp.tex', warnings: [], stderr: '' });
  eq('R15c the run\'s conversion joined: the Report view, not the Log', hid('latex'), REPORT);
  eq('R15d "latex+raw_tex" is LaTeX', hid('latex+raw_tex'), REPORT);
  eq('R15e input that is not LaTeX: the Log only, even with a report held', [hid('markdown'), hid('docx'), hid('')],
     [NO_REPORT, NO_REPORT, NO_REPORT]);
  s.pandoc({ target: 'main.tex', warnings: [], stderr: '' });
  eq('R15f a later conversion without a run (the report is stale): the Log', hid('latex'), NO_REPORT);
  eq('R15g no status at all: the Log', RV.hiddenViews(null, 'latex'), NO_REPORT);
}

sect('R16 "Show old views" (his call 3 A): the Preprocess and Log views come back for LaTeX; outdate()');
{
  const RV = await import(new URL('js/report-view.js', PLATFORM).href);
  const s = createReportState();
  s.keep(kept);
  s.pandoc({ target: 'main-pp.tex', warnings: [], stderr: '' });
  const old = { showOld: true };
  eq('R16a ticked, the report current: all three', RV.hiddenViews(s.status(), 'latex', old), { report: false, preprocess: false, log: false });
  eq('R16b ticked, input that is not LaTeX: still the Log only', RV.hiddenViews(s.status(), 'markdown', old),
     { report: true, preprocess: true, log: false });
  eq('R16c not ticked (the default): as R15', RV.hiddenViews(s.status(), 'latex', {}), { report: false, preprocess: true, log: true });
  s.outdate();
  eq('R16d outdate(): the report no longer holds the latest (a press that stopped)', [s.status().stale, RV.hiddenViews(s.status(), 'latex')],
     [true, { report: true, preprocess: true, log: false }]);
  ok('R16e outdate() with nothing kept does nothing', (() => { const t = createReportState(); t.outdate(); return t.status().stale === false; })());
}

// R17 (latex-preprocess s314; report-sidebar step B1, HANDOFF-B1.md "One shared state"): one copy of the report for every
// drawing. The ticks live in the state (remembered under 'atc.report.show' when a storage is given), and every change
// to the state is told to each drawing that subscribed, so the Report view and the sidebar cannot disagree.
sect('R17 the ticks in the state, remembered; every change told to the drawings');
try {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  const store = mem();
  const s = createReportState({ storage: store });
  eq('R17a nothing kept, nothing remembered: no ticks', s.ticks(), null);
  let told = 0;
  const off = s.subscribe(() => { told++; });
  s.keep(kept);
  eq('R17b after a run: the default level\'s ticks, not yet remembered', [s.ticks(), store.getItem('atc.report.show')], [TOOL.showFor('Fix this'), null]);
  eq('R17c a run is told', told, 1);
  const mine = TOOL.showFor('Check');
  s.setTicks(mine);
  eq('R17d setTicks: the ticks, remembered, told', [s.ticks(), JSON.parse(store.getItem('atc.report.show')), told], [mine, mine, 2]);
  eq('R17e a new state with the same storage reads them back (before a run too)', createReportState({ storage: store }).ticks(), mine);
  s.pandoc({ target: 'main-pp.tex', warnings: LOG, stderr: '' });
  eq('R17f the conversion joining is told', told, 3);
  s.other({ rows: [] });
  s.pandoc({ target: 'other.tex', warnings: [], stderr: '' });
  eq('R17g later rows, then a later conversion (stale): each told', told, 5);
  s.outdate(); s.refresh();
  eq('R17h outdate() and refresh() told', told, 7);
  off();
  s.setTicks(TOOL.showFor('Everything'));
  eq('R17i after unsubscribing: not told', told, 7);
  eq('R17j no storage: setTicks works', (() => { const t = createReportState(); t.keep(kept); t.setTicks(mine); return t.ticks(); })(), mine);
  const fresh = createReportState({ storage: mem() });
  ok('R17k a drawing that throws does not stop the others', (() => { let n = 0; fresh.subscribe(() => { throw new Error('drawn badly'); });
    fresh.subscribe(() => { n++; }); fresh.keep(kept); return n === 1; })());
} catch (e) { fail++; console.log('  FAIL R17 threw: ' + (e && e.message)); }

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
