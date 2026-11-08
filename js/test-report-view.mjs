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

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
