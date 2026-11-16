// MathCAT puts its bookmarks only on single symbols, so the words that introduce a structure
// ("the absolute value of", "the fraction with numerator", "the limit as", "3 cases", "case 1")
// come after a pause with no bookmark of their own, and nothing was highlighted while they were
// spoken. This gives each such run of words the structure it introduces: an enclosing structure
// of the next bookmarked symbol, whose first spoken symbol is that one, and which is either a
// layout that MathCAT announces before its contents (fraction, root, limit/sum, table, row,
// enclosure) or a row that starts with a fence MathCAT doesn't speak (such as the bars of an
// absolute value), or a later piece of such a layout that MathCAT names ("and denominator").
// Several runs before the same symbol get nested structures, outermost first.
// Works on marks [{ at, id }] (id null = a pause) and MathCAT's tidied MathML as a DOM document.
const ATC_INTRO = new Set(['mfrac', 'msqrt', 'mroot', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mlabeledtr', 'menclose']);
function addStructureMarks(text, marks, cdoc) {
  const root = cdoc.documentElement;
  const byId = new Map(Array.from(cdoc.querySelectorAll('[id]')).map((e) => [e.getAttribute('id'), e]));
  const order = new Map();
  marks.forEach((m, i) => { if (m.id != null && !order.has(m.id)) order.set(m.id, i); });
  const firstSpoken = (el) => {
    let best = Infinity;
    for (const d of [el, ...el.querySelectorAll('[id]')]) { const o = order.get(d.getAttribute('id')); if (o !== undefined && o < best) best = o; }
    return best;
  };
  const isWhole = (el) => el === root || (el.parentElement === root && root.children.length === 1);
  const qualifies = (el) => {
    if (isWhole(el)) return false;
    if (ATC_INTRO.has(el.localName)) return true;
    if (el.localName === 'mrow') { const c = el.firstElementChild; return !!c && c.localName === 'mo' && !order.has(c.getAttribute('id')); }
    return false;
  };
  // the stretches of text and who owns them (null = after a pause, or before the first bookmark)
  const owners = [{ at: 0, id: null }, ...marks];
  const segs = [];
  for (let k = 0; k < owners.length; k++) {
    const start = owners[k].at, end = k + 1 < owners.length ? owners[k + 1].at : text.length;
    if (end > start) segs.push({ start, end, id: owners[k].id });
  }
  const added = [];
  for (let k = 0; k < segs.length; k++) {
    if (segs[k].id !== null || !/[A-Za-z0-9]/.test(text.slice(segs[k].start, segs[k].end))) continue;
    let j = k;                                        // a run of unowned stretches...
    while (j + 1 < segs.length && segs[j + 1].id === null) j++;
    const next = segs[j + 1];                         // ...ending at the next bookmarked symbol
    if (next && byId.has(next.id)) {
      const symbolOrder = order.get(next.id);
      const chain = [];
      const sym = byId.get(next.id);
      for (let a = sym; a && a.nodeType === 1; a = a.parentElement) {
        if (firstSpoken(a) !== symbolOrder) break;      // the symbol must be the first thing spoken inside
        const p = a.parentElement;
        if (a !== sym && qualifies(a)) chain.push(a.getAttribute('id'));
        // a later piece of a structure, announced by name: "and denominator", "with index", "to"
        else if (p && ATC_INTRO.has(p.localName) && firstSpoken(p) !== symbolOrder && !isWhole(a)) chain.push(a.getAttribute('id'));
      }
      const run = segs.slice(k, j + 1).filter((s) => /[A-Za-z0-9]/.test(text.slice(s.start, s.end)));
      run.forEach((s, r) => { const c = chain[run.length - 1 - r]; if (c) added.push({ at: s.start, id: c }); });
    }
    k = j;
  }
  // keep marks in text order; an added mark comes after a pause mark at the same place, so it wins
  const all = marks.map((m, i) => ({ m, key: m.at * 4 + 1, i })).concat(added.map((m, i) => ({ m, key: m.at * 4 + 2, i: 1e6 + i })));
  all.sort((a, b) => a.key - b.key || a.i - b.i);
  return all.map((x) => x.m);
}
