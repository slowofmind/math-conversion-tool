// test-project-model.mjs — Stage 0 unit tests. No DOM, no browser.
//   node test-project-model.mjs
import { initProjectModel, normalisePath, detectWrapper, classify }
  from '../project/project-model.js';

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

// ── normalisePath ─────────────────────────────────────────────────
sect('normalisePath');
eq('plain',            normalisePath('a/b.tex'),      'a/b.tex');
eq('leading ./',       normalisePath('./a/b.tex'),    'a/b.tex');
eq('backslashes',      normalisePath('a\\b\\c.tex'),  'a/b/c.tex');
eq('mixed separators', normalisePath('a\\b/c.tex'),   'a/b/c.tex');
eq('double slash',     normalisePath('a//b.tex'),     'a/b.tex');
eq('inner dot',        normalisePath('a/./b.tex'),    'a/b.tex');
eq('bare name',        normalisePath('main.tex'),     'main.tex');
eq('parent rejected',  normalisePath('../etc/x'),     null);
eq('inner parent',     normalisePath('a/../b'),       null);
eq('empty',            normalisePath(''),             null);
eq('non-string',       normalisePath(undefined),      null);
eq('only dots',        normalisePath('./'),           null);

// ── detectWrapper ─────────────────────────────────────────────────
sect('detectWrapper');
eq('single wrapper',   detectWrapper(['p/a.tex','p/f/b.png']), 'p');
eq('two tops',         detectWrapper(['p/a.tex','q/b.tex']),   null);
eq('root file present',detectWrapper(['main.tex','p/a.tex']),  null);
eq('empty',            detectWrapper([]),                      null);
eq('deep single',      detectWrapper(['p/x/y/a.tex']),         'p');

// ── classify — every row of spec §4 ───────────────────────────────
sect('classify');
const c = (e) => { const x = classify(e); return [x.role, x.viewable, x.convertible]; };
eq('tex',   c('tex'),   ['document', true,  true ]);
eq('md',    c('md'),    ['document', true,  true ]);
eq('docx',  c('docx'),  ['document', false, true ]);   // convertible, NOT viewable
eq('epub',  c('epub'),  ['document', false, true ]);
eq('sty',   c('sty'),   ['style',    true,  false]);
eq('cls',   c('cls'),   ['style',    true,  false]);
eq('bib',   c('bib'),   ['bib',      true,  false]);
eq('png',   c('png'),   ['image',    false, false]);
eq('pdf',   c('pdf'),   ['image',    false, false]);   // pandoc cannot READ pdf
eq('lua',   c('lua'),   ['support',  true,  false]);
eq('xyz',   c('xyz'),   ['unknown',  false, false]);
eq('upper', c('TEX'),   ['document', true,  true ]);

// ── addFile ───────────────────────────────────────────────────────
sect('addFile');
{
  const m = initProjectModel();
  const r1 = m.addFile('figures/plot.png', new Uint8Array([1,2,3]));
  eq('returns path',      r1.path, 'figures/plot.png');
  eq('not replaced',      r1.replaced, false);
  const r2 = m.addFile('figures/plot.png', new Uint8Array([4]));
  eq('replacement flagged', r2.replaced, true);
  eq('one entry only',    m.project.entries.size, 1);

  const e = m.getEntry('figures/plot.png');
  eq('name', e.name, 'plot.png');
  eq('dir',  e.dir,  'figures');
  eq('ext',  e.ext,  'png');
  eq('role', e.role, 'image');
  ok('reserved fields initialised',
     e.include === true && e.dirty === false && e.docState === null);

  const bad = m.addFile('../escape.tex', new Uint8Array());
  ok('parent path skipped', bad.skipped === true);
  eq('still one entry', m.project.entries.size, 1);

  ok('lookup normalises', m.getEntry('./figures/plot.png') !== undefined);
}

// ── addFiles + wrapper stripping ──────────────────────────────────
sect('addFiles / wrapper stripping');
{
  const m = initProjectModel();
  const r = m.addFiles([
    { path: 'myproject/main.tex',            bytes: new Uint8Array() },
    { path: 'myproject/chapters/ch1.tex',    bytes: new Uint8Array() },
    { path: 'myproject/handout.sty',         bytes: new Uint8Array() },
    { path: 'myproject/figures/plot.png',    bytes: new Uint8Array() },
  ], { source: 'directory' });

  eq('wrapper detected', r.strippedWrapper, 'myproject');
  eq('all added', r.added, 4);
  ok('include path now root-relative', m.getEntry('chapters/ch1.tex') !== undefined);
  ok('sty now at ROOT (so \\usepackage finds it)', m.getEntry('handout.sty') !== undefined);
  ok('wrapped path gone', m.getEntry('myproject/main.tex') === undefined);
}
{
  // An Overleaf zip has no wrapper — must be left completely alone.
  const m = initProjectModel();
  const r = m.addFiles([
    { path: 'main.tex',         bytes: new Uint8Array() },
    { path: 'chapters/ch1.tex', bytes: new Uint8Array() },
  ], { source: 'zip' });
  eq('no wrapper detected', r.strippedWrapper, null);
  ok('paths untouched', m.getEntry('main.tex') !== undefined);
}
{
  // Two top-level folders is NOT a wrapper.
  const m = initProjectModel();
  const r = m.addFiles([
    { path: 'a/x.tex', bytes: new Uint8Array() },
    { path: 'b/y.tex', bytes: new Uint8Array() },
  ]);
  eq('two tops left alone', r.strippedWrapper, null);
  ok('a/x.tex intact', m.getEntry('a/x.tex') !== undefined);
}
{
  const m = initProjectModel();
  const r = m.addFiles([{ path: 'p/a.tex', bytes: new Uint8Array() }],
                       { stripWrapper: false });
  eq('opt-out honoured', r.strippedWrapper, null);
}

// ── the projection: main document must NEVER appear in auxFiles ───
sect('toAuxFiles / main document');
{
  const m = initProjectModel();
  m.addFile('figures/plot.png', new Uint8Array([1]));
  m.addFile('handout.sty',      new Uint8Array([2]));
  m.setMainDocument('main.tex', '\\documentclass{article}');

  const aux = m.toAuxFiles();
  eq('aux key count', Object.keys(aux).length, 2);
  ok('main excluded from aux',  !('main.tex' in aux));
  ok('sty present',              'handout.sty' in aux);
  ok('image present',            'figures/plot.png' in aux);
  eq('mainPath set',            m.project.mainPath, 'main.tex');
  eq('target follows main',     m.project.convertTargetPath, 'main.tex');

  // Switching main documents must clear the previous isMain flag,
  // or the old main would vanish from auxFiles forever.
  m.setMainDocument('chapters/ch1.tex', 'text');
  const aux2 = m.toAuxFiles();
  ok('previous main returns to aux', 'main.tex' in aux2);
  ok('new main excluded',           !('chapters/ch1.tex' in aux2));
  eq('aux count after switch', Object.keys(aux2).length, 3);

  const e = m.getEntry('main.tex');
  eq('old main no longer isMain', e.isMain, false);
}
{
  // Byte identity: values must pass through untouched.
  const m = initProjectModel();
  const src = new Uint8Array([9, 8, 7]);
  m.addFile('a.png', src);
  ok('same reference, not a copy or re-encode', m.toAuxFiles()['a.png'] === src);
}
{
  const m = initProjectModel();
  m.addFile('a.tex', new Uint8Array());
  eq('removeFile', m.removeFile('./a.tex'), true);
  eq('gone', m.project.entries.size, 0);
}

// ── PDF -> SVG replacement path (processPdfAuxFiles equivalent) ────
sect('derived file replacement');
{
  const m = initProjectModel();
  m.addFile('figures/diagram.pdf', new Uint8Array([1]));
  m.removeFile('figures/diagram.pdf');
  m.addFile('figures/diagram.svg', new Uint8Array([2]), { source: 'derived' });
  const aux = m.toAuxFiles();
  ok('pdf gone',  !('figures/diagram.pdf' in aux));
  ok('svg present', 'figures/diagram.svg' in aux);
  eq('source recorded', m.getEntry('figures/diagram.svg').source, 'derived');
}

// ── sorting ───────────────────────────────────────────────────────
sect('listEntries — numeric collation');
{
  const m = initProjectModel();
  for (const p of ['ch10.tex', 'ch2.tex', 'ch1.tex']) m.addFile(p, new Uint8Array());
  eq('file2 before file10',
     m.listEntries().map(e => e.name), ['ch1.tex', 'ch2.tex', 'ch10.tex']);
}

// ── summary line (verified NVDA wording) ──────────────────────────
sect('summaryText');
{
  const m = initProjectModel();
  m.addFiles([
    { path: 'chapters/ch1.tex', bytes: new Uint8Array() },
    { path: 'chapters/ch2.tex', bytes: new Uint8Array() },
    { path: 'figures/plot.png', bytes: new Uint8Array() },
  ], { stripWrapper: false });
  m.setMainDocument('main.tex', 'x');
  const s = m.summarise();
  eq('file count', s.fileCount, 4);
  eq('folder count', s.folderCount, 2);
  eq('target name', s.targetName, 'main.tex');
  eq('text', m.summaryText(), '4 files in 2 folders. Converting main.tex.');
  m.getEntry('figures/plot.png').include = false;
  eq('excluded surfaces', m.summarise().excludedCount, 1);
}

// ── Stage 2: include / exclude ────────────────────────────────────
sect('include / exclude');
{
  const m = initProjectModel();
  m.addFiles([
    { path: 'handout.sty',      bytes: new Uint8Array([1]) },
    { path: 'figures/a.png',    bytes: new Uint8Array([2]) },
    { path: 'figures/b.png',    bytes: new Uint8Array([3]) },
  ], { stripWrapper: false });
  m.setMainDocument('main.tex', 'x');

  eq('all included by default', Object.keys(m.toAuxFiles()).length, 3);

  // The .sty A/B case: exclude, and it vanishes from the files handed
  // to pandoc — while remaining in the project.
  eq('exclude returns changed', m.setInclude('handout.sty', false), true);
  eq('no-op returns false',     m.setInclude('handout.sty', false), false);
  ok('excluded from projection', !('handout.sty' in m.toAuxFiles()));
  ok('still in the project',     m.getEntry('handout.sty') !== undefined);
  eq('two files remain',         Object.keys(m.toAuxFiles()).length, 2);

  eq('re-include', m.setInclude('handout.sty', true), true);
  ok('back in projection', 'handout.sty' in m.toAuxFiles());
}
{
  const m = initProjectModel();
  m.addFiles([
    { path: 'figures/a.png', bytes: new Uint8Array() },
    { path: 'figures/b.png', bytes: new Uint8Array() },
    { path: 'ch1.tex',       bytes: new Uint8Array() },
  ], { stripWrapper: false });

  eq('folder all',   m.folderIncludeState('figures'), 'all');
  m.setInclude('figures/a.png', false);
  eq('folder mixed', m.folderIncludeState('figures'), 'mixed');
  m.setInclude('figures/b.png', false);
  eq('folder none',  m.folderIncludeState('figures'), 'none');

  eq('cascade includes both', m.setFolderInclude('figures', true), 2);
  eq('folder all again',      m.folderIncludeState('figures'), 'all');
  eq('cascade excludes both', m.setFolderInclude('figures', false), 2);
  ok('siblings untouched',    m.getEntry('ch1.tex').include === true);
  eq('unknown folder empty',  m.folderIncludeState('nope'), 'empty');
}
{
  // The main document is stdin, so a cascade must never touch it —
  // excluding it would be meaningless and it has no toggle in the UI.
  const m = initProjectModel();
  m.addFile('a.tex', new Uint8Array());
  m.setMainDocument('main.tex', 'x');
  m.setFolderInclude('', false);
  eq('main untouched by cascade', m.getEntry('main.tex').include, true);
  eq('other file excluded',       m.getEntry('a.tex').include, false);
  eq('summary counts exclusions', m.summarise().excludedCount, 1);
}

// ── Stage 5: baseline, dirty, checkpoints ─────────────────────────
sect('baseline / checkpoints');
{
  const m = initProjectModel();
  m.addFile('ch1.tex', new TextEncoder().encode('ORIGINAL\n'));

  // REGRESSION: the baseline must exist BEFORE anything reads the file,
  // and must not be affected by later edits. It was previously captured
  // lazily inside getText(), which meant it either never existed (so
  // "Original (as uploaded)" was missing from the restore list) or was
  // captured AFTER an edit (so restoring it returned the edited text).
  eq('baseline available immediately', m.baselineOf('ch1.tex'), 'ORIGINAL\n');
  eq('listed before any read',
     m.listCheckpoints('ch1.tex')[0].id, 'baseline');
  eq('reading does not change it', m.getText('ch1.tex'), 'ORIGINAL\n');
  eq('baseline still original', m.baselineOf('ch1.tex'), 'ORIGINAL\n');
  eq('clean at first', m.isDirty('ch1.tex'), false);

  m.updateText('ch1.tex', 'EDITED\n');
  eq('dirty after edit', m.isDirty('ch1.tex'), true);
  eq('baseline unchanged by edits', m.baselineOf('ch1.tex'), 'ORIGINAL\n');
  eq('restoring the baseline yields the ORIGINAL, not the edit',
     m.checkpointText('ch1.tex', 'baseline'), 'ORIGINAL\n');

  // Baseline is always offered as a restore point.
  const list0 = m.listCheckpoints('ch1.tex');
  eq('baseline listed', list0[0].id, 'baseline');
  eq('baseline is permanent', list0[0].permanent, true);
  eq('restoring the baseline yields the original',
     m.checkpointText('ch1.tex', 'baseline'), 'ORIGINAL\n');

  const cp = m.addCheckpoint('ch1.tex', 'before intent pass');
  ok('checkpoint created', cp && cp.id);
  eq('checkpoint captured current text', cp.text, 'EDITED\n');

  m.updateText('ch1.tex', 'ANNOTATED\n');
  eq('checkpoint text is frozen', m.checkpointText('ch1.tex', cp.id), 'EDITED\n');

  const list1 = m.listCheckpoints('ch1.tex');
  eq('baseline first, newest next', list1.map(c => c.id).join(','), `baseline,${cp.id}`);

  eq('remove works', m.removeCheckpoint('ch1.tex', cp.id), true);
  eq('remove of unknown id', m.removeCheckpoint('ch1.tex', 'nope'), false);
  eq('baseline survives removal', m.listCheckpoints('ch1.tex').length, 1);
}
{
  // REGRESSION: a document uploaded STRAIGHT into the editor never goes
  // through addFile, so setMainDocument is its only chance to record a
  // baseline. Without this, "Original (as uploaded)" never appeared for
  // the main document — the case Nicholas hit.
  const m = initProjectModel();
  m.setMainDocument('main.tex', 'FIRST VERSION\n');
  eq('main doc has a baseline', m.baselineOf('main.tex'), 'FIRST VERSION\n');
  eq('and it is offered', m.listCheckpoints('main.tex')[0].id, 'baseline');

  m.updateText('main.tex', 'HEAVILY EDITED\n');
  eq('main doc dirty', m.isDirty('main.tex'), true);
  eq('restore returns the first version',
     m.checkpointText('main.tex', 'baseline'), 'FIRST VERSION\n');

  // Re-opening the same file (tree switch) must NOT reset the baseline.
  m.setMainDocument('main.tex', 'HEAVILY EDITED\n', { keepTarget: true });
  eq('baseline survives re-opening', m.baselineOf('main.tex'), 'FIRST VERSION\n');
}
{
  // Binary files have nothing to snapshot.
  const m = initProjectModel();
  m.addFile('a.png', new Uint8Array([0, 159, 146, 150]));   // invalid UTF-8
  eq('no text', m.getText('a.png'), null);
  eq('no baseline', m.baselineOf('a.png'), null);
  eq('no restore points', m.listCheckpoints('a.png').length, 0);
  eq('no checkpoint', m.addCheckpoint('a.png'), null);
  eq('not dirty', m.isDirty('a.png'), false);
}

{
  // Project-wide stamp: the workbook case — annotate several chapters,
  // checkpoint them under one label, revert them together.
  const m = initProjectModel();
  const enc = new TextEncoder();
  m.addFiles([
    { path: 'ch1.tex', bytes: enc.encode('ONE\n') },
    { path: 'ch2.tex', bytes: enc.encode('TWO\n') },
    { path: 'ch3.tex', bytes: enc.encode('THREE\n') },
  ], { stripWrapper: false });
  for (const p of ['ch1.tex', 'ch2.tex', 'ch3.tex']) m.getText(p);   // capture baselines

  m.updateText('ch1.tex', 'ONE annotated\n');
  m.updateText('ch2.tex', 'TWO annotated\n');
  // ch3 deliberately left alone.

  const stamped = m.checkpointProject('before intent pass');
  eq('only CHANGED files stamped', stamped.sort().join(','), 'ch1.tex,ch2.tex');
  eq('ch3 has baseline only', m.listCheckpoints('ch3.tex').length, 1);

  const cp1 = m.listCheckpoints('ch1.tex').find(c => c.label === 'before intent pass');
  ok('shared label present on ch1', !!cp1);
  eq('and captures ch1 text', cp1.text, 'ONE annotated\n');

  // Reverting the whole project to baseline.
  for (const p of ['ch1.tex', 'ch2.tex']) {
    m.updateText(p, m.checkpointText(p, 'baseline'));
  }
  eq('ch1 back to original', m.getText('ch1.tex'), 'ONE\n');
  eq('ch1 clean again', m.isDirty('ch1.tex'), false);
  eq('checkpoint still available after revert',
     m.checkpointText('ch1.tex', cp1.id), 'ONE annotated\n');
}

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
