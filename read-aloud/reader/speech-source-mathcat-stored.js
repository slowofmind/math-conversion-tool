// ======================================================================
// speech-source-mathcat-stored.js: the speech source of "MathCat Pregen TTS".
// No speech engine in the page: during conversion MathCAT produced each formula's speech and a
// complete map of arrow-key exploring (read-aloud/rd-workbench.js), stored in the page as JSON
// (#atc-rd-mcspeech).
//   createSpeechSource(ctx) -> { settings, start, prepareAll, findFormulas, describe, check,
//                                enterFormula, navigate, applySetting, debug }
// ctx = { state, log, setStatus, pageLang, P } from reader-core.js.
// ======================================================================
function createSpeechSource(ctx) {
  const { state, log, setStatus, P } = ctx;

  // ---------------------------------------------------------------- stored speech (from the conversion)
  // Per formula: t = whole-formula speech; m = bookmarks [position in t, part] (part null = a pause,
  // -1 = the whole formula); p = parts, each a list of drawn-part labels (data-atc-id) to box;
  // s = things MathCAT said while exploring; n = the exploring map, one string per position:
  // "part|own speech|move,move,…" (moves in DATA.commands order: target position, plus ".speech" when
  // MathCAT says something other than the target's own speech, or "r" when MathCAT couldn't move and
  // the formula starts over; numbers in base 36).
  let DATA = null;
  async function start() {
    try {
      const t = performance.now();
      DATA = JSON.parse(document.getElementById(P + '-mcspeech').textContent);
      for (const f of state.formulas) prepareFormula(f);
      log('stored speech for ' + state.formulas.length + ' formulas loaded in ' + Math.round(performance.now() - t) + ' ms (' + DATA.generator + ')');
      return true;
    } catch (e) {
      setStatus('The stored math speech could not be read: ' + e.message + ' Text will still be read; formulas will be skipped.', true);
      log('error: ' + e.message);
      return false;
    }
  }
  function partsFor(f, part) {
    if (part == null) return [];
    if (part === -1) return [f.el];                     // the whole formula
    const labels = (f.data.p[part] || '').split(' ').filter(Boolean);
    return labels.flatMap((l) => Array.from(f.el.querySelectorAll(':scope > mjx-math [data-atc-id="' + l + '"], :scope > svg [data-atc-id="' + l + '"]')));
  }
  function prepareFormula(f) {
    f.data = DATA.formulas[f.n] || { t: '', m: [], p: [], s: [], n: [] };
    f.idMap = { get: (part) => partsFor(f, part) };
    f.text = f.data.t;
    f.marks = f.data.m.map(([at, part]) => ({ at, id: part }));
    f.nav = null;                                       // decoded on first exploring
  }
  const prepareAll = () => { for (const f of state.formulas) prepareFormula(f); };
  function navMap(f) {
    if (!f.nav) {
      const num = (x) => parseInt(x, 36);
      f.nav = f.data.n.map((str) => {
        const [part, own, moves] = str.split('|');
        return { part: part === '-' ? -1 : part === '' ? null : num(part), own: num(own),
          moves: moves.split(',').map((m) => { if (m === 'r') return [0, 'restart']; const [to, sp] = m.split('.'); return [num(to), sp === undefined ? null : num(sp)]; }) };
      });
    }
    return f.nav;
  }

  // ---------------------------------------------------------------- exploring
  let pos = 0;                                          // position in the exploring map of the formula being explored
  const enterFormula = () => { pos = 0; };              // MathCAT's starting position (before any key)
  function navigate(f, command) {
    const map = navMap(f);
    const ci = DATA.commands.indexOf(command);
    if (ci < 0 || !map[pos]) return null;
    const [to, sp] = map[pos].moves[ci];
    if (sp === 'restart') {                             // MathCAT couldn't move from here: the formula starts over
      pos = 0;
      return { restart: true, log: 'nav ' + command + ' -> formula restarted (MathCAT could not move from here)' };
    }
    pos = to;
    const text = f.data.s[sp === null ? map[to].own : sp] || '';
    return { text, part: map[to].part === -1 ? null : map[to].part, log: 'nav ' + command + ' -> position ' + to + ': "' + text + '"' };
  }

  // ---------------------------------------------------------------- finding the formulas
  function findFormulas() {
    // One entry per formula. (MathJax may split a long inline formula into several pieces.)
    const found = Array.from(document.querySelectorAll('mjx-container[data-atc-formula]'))
      .filter((c) => c.querySelector(':scope > mjx-math, :scope > svg') && !c.closest('[data-atc-rd-skip]'))
      .map((c) => ({ el: c, drawRoot: c, n: parseInt(c.getAttribute('data-atc-formula'), 10) }));
    state.draw = found.length ? 'mathjax' : 'none';
    return found;
  }
  const check = () => (state.formulas.length && !document.getElementById(P + '-mcspeech'))
    ? { status: 'This page has no stored math speech. Make it again with the "MathCat Pregen TTS" output packaging.', log: 'no stored speech block; reader disabled' }
    : '';
  const describe = () => 'MathJax, in advance; speech pre-generated by MathCAT';

  return { settings: [], start, prepareAll, findFormulas, describe, check, enterFormula, navigate,
           applySetting: () => {}, debug: { navMap } };
}
