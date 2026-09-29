// test-preprocess.mjs — PLAN-9 step E: the glue, js/preprocess.js.
//   node test-preprocess.mjs          (cwd: js)
// Written by latex-preprocess session 50 BEFORE js/preprocess.js existed,
// and seen to fail against a do-nothing stub through a pointed copy in the
// tool's _work\ (judgement call 83). Outside npm test, like step D's (84).
//
// REAL: the project model (project/project-model.js) and the tool (the
// platform's preprocess/ copy, its table read from preprocess/data/), so a
// tag or a name the glue gets wrong shows up in the model's own swap (78).
// STAND-INS, only for the page: the editor, copying cm6-src/facade.js's
// openDocument (L320) and dropDocument (L353) rules exactly - text is used
// only the first time a document is opened; opening the current one does
// nothing - and openProjectFile, copying index.html L3210's text-file branch
// (capture the editor into the model, open, setMainDocument with keepTarget
// for a file that is not convertible) followed by syncAuxFiles. Convert,
// sync, show the report and log only record what they were given. The tool
// is wrapped, not replaced, so the files it is handed can be read; E10 alone
// hands the glue a tool, or a table, that throws.
// Node has no `document`: every check that passes shows its path never
// touched the page.
//
// Every expected tool output below is copied from session 50's probes of
// the real tool (latex-preprocess _work\_s50-probe.txt, -probe2, -probe3).
//
// The glue's entry, as this test calls it (PLAN-9 2.4, calls 79, 85):
//   initPreprocess({ model, editor, openProjectFile, syncAuxFiles,
//     runConversion, showReport, updateLog, updateStatus, loadTable,
//     loadTool }) -> { run }       run() is one press of the button.
// E1-E4 PLAN-9 E's list; E5 the held name; E6 a second press; E7 call 81;
// E8 call 82; E9 Nicholas's session-50 decision (the tool's own reading
// says the target is not a document: refused); E10 a failure; E11 call 79.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The two lines a pointed copy replaces (call 83): where the platform is,
// and which glue is under test.
const PLATFORM = new URL('../', import.meta.url);
const GLUE = new URL('js/preprocess.js', PLATFORM);

const at = (rel) => new URL(rel, PLATFORM).href;
const { initProjectModel } = await import(at('project/project-model.js'));
const REAL = {
  ...(await import(at('preprocess/v2/run.mjs'))),
  ...(await import(at('preprocess/v2/capability.mjs'))),
  ...(await import(at('preprocess/v2/report.mjs'))),
};
const TABLE = JSON.parse(fs.readFileSync(
  fileURLToPath(at('preprocess/data/pandoc-latex-reader-index.json')), 'utf8'));
const { initPreprocess } = await import(GLUE.href);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};
const ok = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const sect = (t) => console.log('\n' + t);
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => (b == null ? null : new TextDecoder().decode(b));

// ── Fixture texts, each as a probe ran it ─────────────────────────
const R = String.raw;
const DOC = R`\documentclass{article}` + '\n';
const BODY = R`\begin{document}` + '\nHello \\hello.\n' + R`\end{document}` + '\n';
const HEAD = R`\NeedsTeXFormat{LaTeX2e}` + '\n' + R`\ProvidesPackage{handout}` + '\n';
const USE = R`\usepackage{handout}` + '\n';
const CLEAN = DOC + R`\begin{document}` + '\nHello.\n' + R`\end{document}` + '\n'; // probe 1 C
const STY = HEAD + R`\long\def\hello{Hi}` + '\n';                  // probe 1 B, in
const STY_OUT = HEAD + R`\def\hello{Hi}` + '\n';                   // probe 1 B, out
const MAIN_STY = DOC + USE + BODY;                                 // probe 1 B, unchanged
const MAIN_LONG = DOC + R`\long\def\hello{Hi}` + '\n' + BODY;      // probe 1 A, in
const MAIN_LONG_OUT = DOC + R`\def\hello{Hi}` + '\n' + BODY;       // probe 1 A, out
const P2C_IN = DOC + USE + R`\long\def\extra{X}` + '\n' + BODY;    // probe 3 P2C, in
const P2C_OUT = DOC + USE + R`\def\extra{X}` + '\n' + BODY;        // probe 3 P2C, out
const CHAP_MAIN = DOC + R`\begin{document}` + '\n' + R`\input{chap1}` + '\n' +
  R`\end{document}` + '\n';                                        // probe 2 H
const CHAP = 'Chapter text.\n';
const COMMENTED = '% ' + DOC + 'Hello.\n';                         // probe 2 K
const MINE = 'My own file, named -pp by me.\n';                    // probe 3 MIX
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';
const TYPED = MAIN_STY + '% typed in the editor, not yet captured\n';
const REPORT_HEAD = 'LaTeX preprocessing report';                  // probe 1, every run

// The model as sorted "path | tag | text" lines; the projection as a
// sorted path -> text object; "nothing written" is the first unchanged.
const snap = (m) => [...m.project.entries.values()]
  .map((e) => `${e.path} | ${e.source} | ${m.getText(e.path)}`).sort();
const view = (aux) => Object.fromEntries(
  Object.keys(aux).sort().map((k) => [k, dec(aux[k])]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const line = (path, tag, text) => `${path} | ${tag} | ${text}`;

// ── The editor: cm6-src/facade.js L320 openDocument, L353 dropDocument ─
function makeEditor() {
  const docs = new Map();              // id -> saved text (the facade's state)
  let current = null, shown = '';
  return {
    getText: () => shown,
    setText(t) { shown = t; if (current !== null) docs.set(current, t); },
    openDocument(id, text) {
      if (current === id) return false;              // text ignored
      if (current !== null && docs.has(current)) docs.set(current, shown);
      if (!docs.has(id)) docs.set(id, text ?? '');   // text used ONLY here
      current = id; shown = docs.get(id);
      return true;
    },
    dropDocument(id) { if (id === current) current = null; return docs.delete(id); },
    type(t) { shown = t; },            // the author typing: not captured
    get current() { return current; },
  };
}

// The real tool, wrapped so the files it is handed can be read (E4, E6).
const spy = (rec) => ({
  ...REAL,
  runProject(files, opts) {
    const f = files instanceof Map ? Object.fromEntries(files) : { ...files };
    rec.handed.push({ entry: opts ? opts.entry : undefined, files: f });
    return REAL.runProject(files, opts);
  },
});

// One project, opened the way the page opens it. files: [path, text, tag?].
async function world(files, { open = 'main.tex', typed, exclude = [],
                              tool, table } = {}) {
  const m = initProjectModel();
  for (const [p, t, source] of files) m.addFile(p, enc(t), source ? { source } : {});
  for (const p of exclude) m.setInclude(p, false);
  const editor = makeEditor();
  const rec = { opens: [], syncs: [], convs: [], reports: [], logs: [],
                status: [], handed: [], toolLoads: 0, tableLoads: 0 };
  const syncAuxFiles = () => { rec.syncs.push(snap(m)); };
  async function openProjectFile(entry) {          // index.html L3210
    if (!entry) return;
    const mp = m.project.mainPath;                 // captureEditorIntoModel, L3074
    if (mp) m.updateText(mp, editor.getText());
    const keepTarget = !entry.convertible;
    const text = m.getText(entry.path) ?? '';
    editor.openDocument(entry.path, text);
    m.setMainDocument(entry.path, editor.getText(), { keepTarget });
    rec.opens.push(entry.path);
    syncAuxFiles();
  }
  const runConversion = async () => {
    rec.convs.push({ target: m.project.convertTargetPath, stdin: editor.getText(),
                     aux: view(m.toAuxFiles()) });
  };
  await openProjectFile(m.getEntry(open));
  rec.opens.length = 0; rec.syncs.length = 0;
  if (typed !== undefined) editor.type(typed);
  const glue = initPreprocess({
    model: m, editor, openProjectFile, syncAuxFiles, runConversion,
    showReport: (t) => { rec.reports.push(String(t)); },
    // The page's own shapes (call 94, latex-preprocess s55): updateLog takes
    // [{ level, message }] (js/log-display.js) and throws on a string;
    // updateStatus takes (state, text) (index.html L2825), the state being
    // the status dot's class. Levels and states are the page's CSS classes
    // (index.html L925-927, L964-966). Each stand-in throws on anything the
    // page's own function would mishandle, and records what it was given.
    updateLog: (warnings) => {
      if (!Array.isArray(warnings)) throw new TypeError('updateLog wants an array of { level, message }');
      for (const w of warnings) {
        if (!w || !['info', 'warn', 'error'].includes(w.level) || typeof w.message !== 'string')
          throw new TypeError('updateLog wants { level, message }: ' + JSON.stringify(w));
        (rec.levels ??= []).push(w.level); rec.logs.push(w.message);
      }
    },
    updateStatus: (state, text) => {
      if (!['ready', 'loading', 'error'].includes(state) || typeof text !== 'string')
        throw new TypeError('updateStatus wants (state, text): ' + JSON.stringify([state, text]));
      (rec.states ??= []).push(state); rec.status.push(text);
    },
    loadTable: async () => { rec.tableLoads++; return table ? table() : TABLE; },
    loadTool: async () => { rec.toolLoads++; return tool || spy(rec); },
  });
  return { m, editor, rec, press: () => glue.run(), open: openProjectFile };
}
// Reports and log lines written since a mark, so a second press is judged
// on what IT said, not on what the first press said.
const since = (arr, n) => arr.slice(n);
const names = (arr, s) => arr.some((x) => x.includes(s));

// ── E1 ─────────────────────────────────────────────────────────────
sect('E1 nothing changed: no copies, the report, the original converted');
{
  const { m, rec, press } = await world([['main.tex', CLEAN]]);
  await press();
  eq('E1a no copies; main.tex converted as it is',
     { files: snap(m), convs: rec.convs.map((c) => [c.target, c.stdin]) },
     { files: [line('main.tex', 'upload', CLEAN)], convs: [['main.tex', CLEAN]] });
  ok('E1b the tool\'s report shown, once',
     rec.reports.length === 1 && rec.reports[0].startsWith(REPORT_HEAD), JSON.stringify(rec.reports));
  ok('E1c the log names main.tex', names(rec.logs, 'main.tex'), JSON.stringify(rec.logs));
}

// ── E2 ─────────────────────────────────────────────────────────────
sect('E2 a style file changed: its -pp copy and main-pp.tex, converted through the swap');
{
  const { m, editor, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  await press();
  eq('E2a copies of the changed file and of the target, tagged; originals as they were', snap(m), [
    line('handout-pp.sty', 'preprocessed', STY_OUT), line('handout.sty', 'upload', STY),
    line('main-pp.tex', 'preprocessed', MAIN_STY), line('main.tex', 'upload', MAIN_STY)].sort());
  eq('E2b the editor on main-pp.tex, and main-pp.tex the target',
     [m.project.mainPath, m.project.convertTargetPath, editor.getText()],
     ['main-pp.tex', 'main-pp.tex', MAIN_STY]);
  eq('E2c converted once, handout-pp.sty served as handout.sty', rec.convs,
     [{ target: 'main-pp.tex', stdin: MAIN_STY,
        aux: { 'handout.sty': STY_OUT, 'main.tex': MAIN_STY } }]);
  ok('E2d the page resynced after the last change to the model',
     rec.syncs.length > 0 && same(rec.syncs[rec.syncs.length - 1], snap(m)));
  ok('E2e the tool\'s report shown, once',
     rec.reports.length === 1 && rec.reports[0].startsWith(REPORT_HEAD), JSON.stringify(rec.reports));
  ok('E2f the log names main-pp.tex', names(rec.logs, 'main-pp.tex'), JSON.stringify(rec.logs));
}

// ── E3 ─────────────────────────────────────────────────────────────
sect('E3 the main file itself changed');
{
  const { m, rec, press } = await world([['main.tex', MAIN_LONG]]);
  await press();
  eq('E3a main-pp.tex carries the change; no other copy', snap(m),
     [line('main-pp.tex', 'preprocessed', MAIN_LONG_OUT), line('main.tex', 'upload', MAIN_LONG)].sort());
  eq('E3b main-pp.tex converted as the tool wrote it',
     rec.convs.map((c) => [c.target, c.stdin]), [['main-pp.tex', MAIN_LONG_OUT]]);
}

// ── E4 ─────────────────────────────────────────────────────────────
sect('E4 the right files handed over');
{
  const { rec, press } = await world([
    ['main.tex', MAIN_STY], ['handout.sty', STY], ['notes.tex', 'Notes, never loaded.\n'],
    ['gen.tex', 'Generated text.\n', 'derived'], ['worksheet.cls', R`\ProvidesClass{worksheet}` + '\n'],
    ['my-pp.tex', MINE], ['ex.sty', 'Excluded.\n'], ['fig.png', 'PNG'],
    ['handout-pp.sty', STY_OUT, 'preprocessed']],
    { exclude: ['ex.sty'], typed: TYPED });
  await press();
  const h = rec.handed[0] || { files: {} };
  eq('E4a every included .tex .sty .cls not tagged preprocessed, and nothing else',
     Object.keys(h.files).sort(),
     ['gen.tex', 'handout.sty', 'main.tex', 'my-pp.tex', 'notes.tex', 'worksheet.cls']);
  eq('E4b the target named as the entry', h.entry, 'main.tex');
  eq('E4c the editor\'s file handed as the editor\'s text', h.files['main.tex'], TYPED);
  eq('E4d a file not in the editor handed as the model holds it', h.files['handout.sty'], STY);
}

// ── E5 ─────────────────────────────────────────────────────────────
sect('E5 a -pp name held by a file the tool did not make stops the run');
for (const held of ['handout-pp.sty', 'main-pp.tex']) {
  const { m, editor, rec, press } = await world(
    [['main.tex', MAIN_STY], ['handout.sty', STY], [held, 'The author\'s own file.\n']],
    { typed: TYPED });
  const before = snap(m);
  await press();
  eq(`E5 ${held}: nothing written, nothing converted, the editor untouched, the report names it`,
     { same: same(snap(m), before), convs: rec.convs.length, named: names(rec.reports, held),
       editor: [editor.current, editor.getText()] },
     { same: true, convs: 0, named: true, editor: ['main.tex', TYPED] });
  ok(`E5 ${held}: the log names it`, names(rec.logs, held), JSON.stringify(rec.logs));
}

// ── E6 ─────────────────────────────────────────────────────────────
sect('E6 a second press, from main-pp.tex, replaces only the tool\'s own earlier files');
{
  const { m, editor, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY],
    ['my-pp.tex', MINE], ['figs/plot.svg', SVG, 'derived']]);
  await press();                                     // as E2: two copies
  m.updateText('handout.sty', STY_OUT);              // the author fixes the style
  m.updateText('main.tex', P2C_IN);                  // and edits the main file
  await press();                                     // probe 3 P2C
  eq('E6a the stale copy gone, main-pp.tex rewritten, everything else untouched', snap(m), [
    line('figs/plot.svg', 'derived', SVG), line('handout.sty', 'upload', STY_OUT),
    line('main-pp.tex', 'preprocessed', P2C_OUT), line('main.tex', 'upload', P2C_IN),
    line('my-pp.tex', 'upload', MINE)].sort());
  const h = rec.handed[1] || { files: {} };
  eq('E6b pressed from main-pp.tex, the tool is handed its original',
     { entry: h.entry, pp: 'main-pp.tex' in h.files }, { entry: 'main.tex', pp: false });
  eq('E6c the editor shows the NEW main-pp.tex, and the model agrees, unedited',
     [editor.getText(), m.getText('main-pp.tex'), m.isDirty('main-pp.tex')], [P2C_OUT, P2C_OUT, false]);
  eq('E6d the second conversion is of the new text', rec.convs[1],
     { target: 'main-pp.tex', stdin: P2C_OUT, aux: { 'figs/plot.svg': SVG,
       'handout.sty': STY_OUT, 'main.tex': P2C_IN, 'my-pp.tex': MINE } });
}

// ── E7 ─────────────────────────────────────────────────────────────
sect('E7 call 81: an earlier copy edited since the tool wrote it stops the run');
{
  const { m, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  await press();
  m.updateText('handout-pp.sty', STY_OUT + '% my edit\n');   // edited, and in the model
  const before = snap(m), r = rec.reports.length, l = rec.logs.length;
  await press();
  eq('E7a edited in the model: nothing written, nothing converted again, the report names it',
     { same: same(snap(m), before), convs: rec.convs.length,
       named: names(since(rec.reports, r), 'handout-pp.sty') },
     { same: true, convs: 1, named: true });
  ok('E7b the log names handout-pp.sty', names(since(rec.logs, l), 'handout-pp.sty'));
}
{
  const { m, editor, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  await press();                                     // the editor now on main-pp.tex
  const typedPp = MAIN_STY + '% typed in main-pp.tex, not yet captured\n';
  editor.type(typedPp);
  const before = snap(m), r = rec.reports.length;
  await press();
  eq('E7c edited in the editor only: stopped, the edit still on screen, the report names it',
     { same: same(snap(m), before), convs: rec.convs.length,
       named: names(since(rec.reports, r), 'main-pp.tex'), shows: editor.getText() },
     { same: true, convs: 1, named: true, shows: typedPp });
}

// ── E8 ─────────────────────────────────────────────────────────────
sect('E8 call 82: nothing changed now, so the earlier copies go and the original is opened');
{
  const { m, editor, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY],
    ['my-pp.tex', MINE]]);
  await press();                                     // as E2
  m.updateText('handout.sty', STY_OUT);              // probe 3 P2N: nothing left to change
  await press();
  eq('E8a both earlier copies removed, nothing else; converted twice in all',
     { files: snap(m), convs: rec.convs.length },
     { files: [line('handout.sty', 'upload', STY_OUT), line('main.tex', 'upload', MAIN_STY),
               line('my-pp.tex', 'upload', MINE)].sort(), convs: 2 });
  eq('E8b the editor back on main.tex, main.tex the target, opened by the page',
     { where: [m.project.mainPath, m.project.convertTargetPath, editor.getText()], opens: rec.opens },
     { where: ['main.tex', 'main.tex', MAIN_STY], opens: ['main-pp.tex', 'main.tex'] });
  eq('E8c the second conversion is of main.tex, nothing swapped', rec.convs[1],
     { target: 'main.tex', stdin: MAIN_STY, aux: { 'handout.sty': STY_OUT, 'my-pp.tex': MINE } });
  ok('E8d the page resynced after the last change to the model',
     rec.syncs.length > 0 && same(rec.syncs[rec.syncs.length - 1], snap(m)));
}

// ── E9 ─────────────────────────────────────────────────────────────
sect('E9 the tool\'s own reading says the target is not a document: refused');
for (const [label, files, open] of [
  ['a chapter \\input by main.tex', [['main.tex', CHAP_MAIN], ['chap1.tex', CHAP]], 'chap1.tex'],
  ['a commented-out \\documentclass', [['notes.tex', COMMENTED]], 'notes.tex']]) {
  const { m, rec, press } = await world(files, { open, typed: 'Typed, not captured.\n' });
  const before = snap(m);
  await press();
  eq(`E9 ${label}: nothing written, nothing converted, report and log name ${open}`,
     { same: same(snap(m), before), convs: rec.convs.length,
       reported: names(rec.reports, open), logged: names(rec.logs, open) },
     { same: true, convs: 0, reported: true, logged: true });
}

// ── E10 ────────────────────────────────────────────────────────────
sect('E10 a failure writes nothing and converts nothing');
for (const [label, opts, msg] of [
  ['the tool throws', { tool: { ...REAL, runProject() { throw new Error('forced tool failure'); } } },
   'forced tool failure'],
  ['the table does not load', { table: () => { throw new Error('forced table failure'); } },
   'forced table failure']]) {
  const { m, editor, rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]],
    { typed: TYPED, ...opts });
  const before = snap(m);
  await press();
  eq(`E10 ${label}: nothing written or converted, the editor untouched, the reason shown and logged`,
     { same: same(snap(m), before), convs: rec.convs.length, editor: [editor.current, editor.getText()],
       reported: names(rec.reports, msg), logged: names(rec.logs, msg) },
     { same: true, convs: 0, editor: ['main.tex', TYPED], reported: true, logged: true });
}

// ── E11 ────────────────────────────────────────────────────────────
sect('E11 call 79: the tool and the table loaded once, on the first press');
{
  const { rec, press } = await world([['main.tex', CLEAN]]);
  await press(); await press();
  eq('E11 two presses: one load of each, two conversions',
     [rec.toolLoads, rec.tableLoads, rec.convs.length], [1, 1, 2]);
}

// ── E12-E17: session 51's six choices, Nicholas's yes, each given a check
// by session 52 (Nicholas: "option 1"). Written AFTER the glue, so each is
// seen to fail through a mutant in the tool's _work\, not against a stub.

// ── E12 ────────────────────────────────────────────────────────────
sect('E12 a press stopped after the tool has run shows only the reason');
for (const [label, files, open] of [
  ['a held -pp name', [['main.tex', MAIN_STY], ['handout.sty', STY],
    ['handout-pp.sty', 'The author\'s own file.\n']], 'main.tex'],
  ['not a document', [['main.tex', CHAP_MAIN], ['chap1.tex', CHAP]], 'chap1.tex']]) {
  const { rec, press } = await world(files, { open });
  await press();
  eq(`E12 ${label}: one report, the reason, and not the tool's own report`,
     rec.reports.map((t) => [t.startsWith('Preprocess stopped: '), t.includes(REPORT_HEAD)]),
     [[true, false]]);
}

// ── E13 ────────────────────────────────────────────────────────────
sect('E13 the report shows before the conversion starts');
for (const [label, files] of [
  ['something changed', [['main.tex', MAIN_STY], ['handout.sty', STY]]],
  ['nothing changed', [['main.tex', CLEAN]]]]) {
  const { rec, press } = await world(files);
  const order = [];            // the stand-ins push into these two; record which came first
  for (const [arr, what] of [[rec.reports, 'report'], [rec.convs, 'convert']])
    arr.push = function (...xs) { order.push(what); return Array.prototype.push.apply(this, xs); };
  await press();
  eq(`E13 ${label}: the report, then the conversion`, order, ['report', 'convert']);
}

// ── E14 ────────────────────────────────────────────────────────────
sect('E14 a press during a press is ignored');
{
  const { rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  const settled = await Promise.allSettled([press(), press()]);   // the second before the first ends
  eq('E14 the second press does nothing: one load, one run of the tool, one conversion',
     { results: settled.map((s) => (s.status === 'fulfilled' ? s.value : 'threw')),
       loads: rec.toolLoads, handed: rec.handed.length, convs: rec.convs.length },
     { results: [true, false], loads: 1, handed: 1, convs: 1 });
}

// ── E15 ────────────────────────────────────────────────────────────
sect('E15 with no document to convert, a press is refused');
{
  const { m, rec, press } = await world([['handout.sty', STY]], { open: 'handout.sty' });
  const before = snap(m);
  await press();
  eq('E15 no target: nothing handed, written or converted; report and log say so',
     { target: m.project.convertTargetPath, same: same(snap(m), before), handed: rec.handed.length,
       convs: rec.convs.length, reported: names(rec.reports, 'no document'),
       logged: names(rec.logs, 'no document') },
     { target: null, same: true, handed: 0, convs: 0, reported: true, logged: true });
}

// ── E16 ────────────────────────────────────────────────────────────
sect('E16 nothing changed, the editor on a style file: the target returns, the editor stays');
{
  const { m, editor, rec, press, open } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  await press();                                     // as E2: main-pp.tex the target
  await open(m.getEntry('handout.sty'));             // the page's own open keeps the target
  editor.type(STY_OUT);                              // the author fixes the style on screen
  await press();                                     // probe 3 P2N: nothing left to change
  eq('E16a the copies gone; main.tex the target; the editor still on handout.sty, its text kept',
     { files: snap(m), where: [m.project.mainPath, m.project.convertTargetPath,
       editor.current, editor.getText()] },
     { files: [line('handout.sty', 'upload', STY), line('main.tex', 'upload', MAIN_STY)],
       where: ['handout.sty', 'main.tex', 'handout.sty', STY_OUT] });
  eq('E16b converted twice, the second time main.tex',
     rec.convs.map((c) => c.target), ['main-pp.tex', 'main.tex']);
}

// ── E17 ────────────────────────────────────────────────────────────
sect('E17 a failed load is not kept: the next press loads again and runs');
{
  let failures = 1;
  const { rec, press } = await world([['main.tex', CLEAN]], { table: () => {
    if (failures-- > 0) throw new Error('forced first-load failure');
    return TABLE; } });
  const first = await press(), second = await press();
  eq('E17 the first press stopped with its reason, the second converted; the table asked for twice',
     { first, second, reported: names(rec.reports, 'forced first-load failure'),
       convs: rec.convs.map((c) => c.target), tableLoads: rec.tableLoads },
     { first: false, second: true, reported: true, convs: ['main.tex'], tableLoads: 2 });
}

// ── E18 ────────────────────────────────────────────────────────────
// Call 94 (latex-preprocess s55): the page's own status states and log
// levels, which the stand-ins in world() enforce. A press that converts
// says loading and leaves the status to the conversion; its log line is
// info. A stop says error to both.
sect('E18 the page\'s own shapes: a stop says error, a press that converts says loading and info');
{
  const { rec, press } = await world([['main.tex', CLEAN]]);
  await press();
  eq('E18a nothing changed, converted: status loading, log info',
     { states: rec.states, levels: rec.levels }, { states: ['loading'], levels: ['info'] });
}
{
  const { rec, press } = await world([['main.tex', MAIN_STY], ['handout.sty', STY]]);
  await press();
  eq('E18b a file changed, converted: status loading, log info',
     { states: rec.states, levels: rec.levels }, { states: ['loading'], levels: ['info'] });
}
{
  const { rec, press } = await world([['main.tex', CLEAN]], { table: () => {
    throw new Error('forced load failure'); } });
  await press();
  eq('E18c a stop: status error, log error',
     { states: rec.states, levels: rec.levels }, { states: ['error'], levels: ['error'] });
}

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
