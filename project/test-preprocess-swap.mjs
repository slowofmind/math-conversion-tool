// test-preprocess-swap.mjs — PLAN-9 step D: the preprocess swap in
// toAuxFiles(). No DOM, no browser. Same shape as test-project-model.mjs.
//   node test-preprocess-swap.mjs
// Written by latex-preprocess session 47 BEFORE the swap existed, and seen
// to fail on exactly the checks that need a swap. D1-D3 are PLAN-9 D's
// three cases; D4-D7 test judgement calls 73-76 (latex-preprocess
// HANDOFF-V2-REBUILD.md section 26.1). D1 also pins section 26.3: the
// editor file is never a file, so main.tex, whose -pp copy is in the
// editor, is served under its own name with its own text (call 77).
import { initProjectModel } from '../project/project-model.js';

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
// The projection as path -> text, keys sorted, so a whole projection can be
// compared in one check. Want-objects below are written in sorted order.
const view = (aux) => Object.fromEntries(
  Object.keys(aux).sort().map((k) => [k, dec(aux[k])]));
// The projection exactly as toAuxFiles() built it BEFORE step D, copied
// here from project-model.js, so "today's projection" is a thing a check
// can compare against rather than a phrase (call 76).
const today = (m) => {
  const out = {};
  for (const e of m.project.entries.values()) {
    if (e.isMain) continue;
    if (e.include === false) continue;
    out[e.path] = e.bytes;
  }
  return out;
};

// The worksheet's shape: an original main and style, and the tool's -pp
// copies of both. Each file's text says which file it is.
function fixture({ ppTag = 'preprocessed', mainTag = 'preprocessed' } = {}) {
  const m = initProjectModel();
  const b = {
    main: enc('MAIN original'), mainpp: enc('MAIN preprocessed'),
    sty: enc('STY original'), stypp: enc('STY preprocessed'),
  };
  m.addFile('main.tex', b.main);
  m.addFile('main-pp.tex', b.mainpp, { source: mainTag });
  m.addFile('handout.sty', b.sty);
  m.addFile('handout-pp.sty', b.stypp, { source: ppTag });
  return { m, b };
}

// ── PLAN-9 D, case 1 ──────────────────────────────────────────────
sect('D1 converting main-pp.tex: the -pp style goes under the original name');
{
  const { m, b } = fixture();
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  eq('D1 target is main-pp.tex', m.project.convertTargetPath, 'main-pp.tex');
  const aux = m.toAuxFiles();
  eq('D1 projection', view(aux),
     { 'handout.sty': 'STY preprocessed', 'main.tex': 'MAIN original' });
  ok('D1 handout.sty carries the -pp bytes themselves', aux['handout.sty'] === b.stypp);
  ok('D1 handout-pp.sty left out', !('handout-pp.sty' in aux));
}

// ── PLAN-9 D, case 2 ──────────────────────────────────────────────
sect('D2 converting main.tex: nothing swapped');
{
  const { m } = fixture();
  m.setMainDocument('main.tex', 'MAIN original');
  eq('D2 target is main.tex', m.project.convertTargetPath, 'main.tex');
  const aux = m.toAuxFiles();
  eq('D2 projection', view(aux), { 'handout-pp.sty': 'STY preprocessed',
     'handout.sty': 'STY original', 'main-pp.tex': 'MAIN preprocessed' });
  eq('D2 same as the projection before step D', view(aux), view(today(m)));
}

// ── PLAN-9 D, case 3 ──────────────────────────────────────────────
sect('D3 an untagged -pp file is never swapped');
{
  const { m } = fixture({ ppTag: 'upload' });
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  eq('D3 target is main-pp.tex', m.project.convertTargetPath, 'main-pp.tex');
  const aux = m.toAuxFiles();
  eq('D3 projection', view(aux), { 'handout-pp.sty': 'STY preprocessed',
     'handout.sty': 'STY original', 'main.tex': 'MAIN original' });
  eq('D3 same as the projection before step D', view(aux), view(today(m)));
}

// ── Call 73: a tagged target AND a -pp name ───────────────────────
sect('D4 call 73: the swap needs a tagged target AND a -pp name');
{
  const { m } = fixture();
  m.addFile('notes.tex', enc('NOTES'), { source: 'preprocessed' });
  m.setMainDocument('notes.tex', 'NOTES');
  eq('D4a target is notes.tex', m.project.convertTargetPath, 'notes.tex');
  eq('D4a tagged, not a -pp name: nothing swapped', view(m.toAuxFiles()), view(today(m)));
}
{
  const { m } = fixture({ mainTag: 'upload' });
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  eq('D4b target is main-pp.tex', m.project.convertTargetPath, 'main-pp.tex');
  eq('D4b a -pp name, not tagged: nothing swapped', view(m.toAuxFiles()), view(today(m)));
}

// ── Call 74: same folder, -pp removed before the extension, untagged ─
sect('D5 call 74: which original a -pp file stands in for');
{
  const m = initProjectModel();
  m.addFile('main.tex', enc('MAIN original'));
  m.addFile('main-pp.tex', enc('MAIN preprocessed'), { source: 'preprocessed' });
  m.addFile('chapters/ch1.tex', enc('CH1 original'));
  m.addFile('chapters/ch1-pp.tex', enc('CH1 preprocessed'), { source: 'preprocessed' });
  m.addFile('handout.sty', enc('STY original'));
  m.addFile('sub/handout-pp.sty', enc('SUB STY preprocessed'), { source: 'preprocessed' });
  m.addFile('extra.sty', enc('EXTRA tagged'), { source: 'preprocessed' });
  m.addFile('extra-pp.sty', enc('EXTRA preprocessed'), { source: 'preprocessed' });
  m.addFile('macros.tex', enc('MACROS tex'));
  m.addFile('macros-pp.sty', enc('MACROS preprocessed'), { source: 'preprocessed' });
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  const aux = m.toAuxFiles();
  const v = view(aux);
  eq('D5 same folder: chapters/ch1.tex carries the -pp text', v['chapters/ch1.tex'], 'CH1 preprocessed');
  ok('D5 same folder: chapters/ch1-pp.tex left out', !('chapters/ch1-pp.tex' in aux));
  eq('D5 other folder: handout.sty keeps its own text', v['handout.sty'], 'STY original');
  eq('D5 other folder: sub/handout-pp.sty under its own name', v['sub/handout-pp.sty'], 'SUB STY preprocessed');
  eq('D5 tagged original: extra.sty keeps its own text', v['extra.sty'], 'EXTRA tagged');
  eq('D5 tagged original: extra-pp.sty under its own name', v['extra-pp.sty'], 'EXTRA preprocessed');
  eq('D5 extension kept: macros.tex keeps its own text', v['macros.tex'], 'MACROS tex');
  eq('D5 extension kept: macros-pp.sty under its own name', v['macros-pp.sty'], 'MACROS preprocessed');
  eq('D5 key count', Object.keys(aux).length, 8);
}

// ── Call 75: an excluded original, an excluded -pp file ──────────
sect('D6 call 75: exclusion');
{
  const { m } = fixture();
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  m.setInclude('handout.sty', false);
  const aux = m.toAuxFiles();
  ok('D6a excluded original: nothing under handout.sty', !('handout.sty' in aux));
  ok('D6a excluded original: handout-pp.sty left out too', !('handout-pp.sty' in aux));
}
{
  const { m } = fixture();
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed');
  m.setInclude('handout-pp.sty', false);
  const aux = m.toAuxFiles();
  eq('D6b excluded -pp file: handout.sty as it is', view(aux)['handout.sty'], 'STY original');
  ok('D6b excluded -pp file: handout-pp.sty absent', !('handout-pp.sty' in aux));
}

// ── Call 76: converting anything else is today's projection exactly ─
sect('D7 call 76: the editor on main-pp.tex, converting main.tex');
{
  const { m } = fixture();
  m.setMainDocument('main.tex', 'MAIN original');
  m.setMainDocument('main-pp.tex', 'MAIN preprocessed', { keepTarget: true });
  eq('D7 editor on main-pp.tex', m.project.mainPath, 'main-pp.tex');
  eq('D7 target kept on main.tex', m.project.convertTargetPath, 'main.tex');
  const aux = m.toAuxFiles();
  eq('D7 projection', view(aux), { 'handout-pp.sty': 'STY preprocessed',
     'handout.sty': 'STY original', 'main.tex': 'MAIN original' });
  eq('D7 same as the projection before step D', view(aux), view(today(m)));
}

console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
process.exit(fail ? 1 : 0);
