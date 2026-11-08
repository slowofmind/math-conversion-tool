// src/checks.js — is this selection something the tool may label?
// [CLAUDE 2026-11-02] Track C, overnight plan section 5, step 2 ("Selection
// checks"). Each check returns null (fine) or { code, message } (refuse).
//
// locateSelection() finds WHERE in the TeX tree the selection sits: it must
// be a run of whole terms in one row (TeX's own grouping). That one rule
// covers braces, \left..\right, \begin..\end, command arguments and scripts.
// The other checks give the author a clear reason in plain words.
import { findMathRegions, parseMath, allRows, allCommands, contentTerms, FONT_COMMANDS } from './latex-parse.js';

const problem = (code, message) => ({ code, message });

/** Shrink [start, end) past surrounding whitespace. */
export function trimRange(src, start, end) {
  while (start < end && /\s/.test(src[start])) start++;
  while (end > start && /\s/.test(src[end - 1])) end--;
  return { start, end };
}

/** The math region holding the whole selection, parsed. */
export function regionFor(doc, start, end, cache = {}) {
  const regions = (cache.regions ??= findMathRegions(doc));
  const reg = regions.find(r => r.contentStart <= start && end <= r.contentEnd);
  if (!reg) return null;
  if (!reg.tree) reg.tree = parseMath(doc, reg.contentStart, reg.contentEnd);
  return reg;
}

/**
 * Where the selection sits: { row, first, last, terms, cut } or a problem.
 *   row:   the deepest row that holds the selection
 *   terms: the row's terms covered, all whole
 *   cut:   null, or 'base' when the selection is exactly the base of a term
 *          whose scripts stay outside ('base+sub' when the subscript is in).
 */
export function locateSelection(tree, start, end) {
  let best = null;
  for (const r of allRows(tree)) {
    if (r.start <= start && end <= r.end && (!best || r.end - r.start <= best.end - best.start)) best = r;
  }
  if (!best) return problem('cuts-structure', 'The selection cuts through a piece of the math.');
  if (best.mode === 'raw') return problem('in-label', 'The selection is inside the name of an existing label or operand.');
  if (best.mode === 'text') return problem('in-text', 'The selection is inside text (\\text{...}), not math.');
  if (best.mode === 'name') return problem('in-name', 'The selection is inside an operator name (\\operatorname{...}). Select the whole command.');
  const terms = best.terms.filter(t => t.start < end && t.end > start);
  if (!terms.length) return problem('cuts-structure', 'The selection holds no complete piece of the math.');
  const first = terms[0], last = terms.at(-1);
  const owner = best.parent;
  if (owner?.kind === 'command' && FONT_COMMANDS.has(owner.name)) {
    const ct = contentTerms(best);
    if (ct.length > 1 && !(ct[0].start === start && ct.at(-1).end === end))
      return problem('cuts-name', `The selection is part of a word in one font command (\\${owner.name}{...}). Select the whole command.`);
  }
  if (first.start === start && last.end === end) return { row: best, terms, cut: null };
  // Exactly the base of one term (A in A^T, A_i in A_i^T): allowed.
  if (terms.length === 1 && first.start === start) {
    if (first.base.end === end && first.base.kind !== 'empty') return { row: best, terms, cut: 'base' };
    // base and subscript, with a superscript or prime after (A_i in A_i^T, f_n in f_n')
    if (first.sub && first.sub.marker >= first.base.end && end === (first.sub.groupEnd ?? first.sub.end) &&
        first.end > end && (!first.sup || first.sup.marker >= end)) return { row: best, terms, cut: 'base+sub' };
  }
  const t = terms.find(x => (x.start < start && start < x.end) || (x.start < end && end < x.end));
  if (t && t.base.kind === 'command' && start <= t.base.start && end < t.base.end)
    return problem('cuts-command', 'The selection cuts a command from its arguments. Select the whole command.');
  if (t && ((start >= t.base.end && start < t.end) || (end > t.base.end && end < t.end)))
    return problem('cuts-script', 'The selection separates a superscript or subscript from what it belongs to. Select the whole piece, scripts included.');
  return problem('cuts-structure', 'The selection cuts through a brace group, a \\left...\\right pair or a command. Select whole pieces.');
}

export function checkNotEmpty(ctx) {
  return ctx.start < ctx.end ? null : problem('empty-selection', 'Nothing is selected (or only spaces).');
}

export function checkConcept(ctx) {
  if (!ctx.concept) return problem('unknown-concept', `"${ctx.conceptName}" is not in the concept list.`);
  const nu = ctx.concept.notUsed;
  if (nu) return problem('not-used', `"${ctx.concept.concept}" is marked "not used" in the Reference tool` +
    (nu.useInstead ? `; use "${nu.useInstead}" instead.` : '.') + (nu.reason ? ` Reason: ${nu.reason}` : ''));
  return null;
}

export function checkInMath(ctx) {
  const reg = regionFor(ctx.src, ctx.start, ctx.end, ctx.cache);
  if (!reg) return problem('not-in-math', 'The selection must sit inside one piece of math ($...$, \\(...\\), \\[...\\] or a math environment).');
  if (!reg.tree) return problem('math-does-not-parse', 'The math around the selection does not parse (an unbalanced brace or \\left/\\right?). Fix it first.');
  ctx.region = reg;
  return null;
}

/** A selection across table cells (& or \\) cannot be one label. */
export function checkCells(ctx) {
  const t = ctx.src.slice(ctx.start, ctx.end);
  // find the environment that holds both ends in different cells
  for (const row of allRows(ctx.region.tree)) {
    for (const term of row.terms) {
      const it = term.base;
      if (it.kind !== 'env' || it.start > ctx.start || it.end < ctx.end) continue;
      const cells = it.cells.flat();
      const a = cells.find(c => c.start <= ctx.start && ctx.start <= c.end);
      const b = cells.find(c => c.start <= ctx.end && ctx.end <= c.end);
      if (a && b && a !== b && !(it.start === ctx.start && it.end === ctx.end))
        return problem('table-cells', 'The selection spans more than one table cell or row (& or \\\\). Select inside one cell, or the whole table.');
    }
  }
  if (/(^|[^\\])&/.test(t) && !/\\begin\{/.test(t))
    return problem('table-cells', 'The selection spans more than one table cell (&).');
  return null;
}

export function checkStructure(ctx) {
  const loc = locateSelection(ctx.region.tree, ctx.start, ctx.end);
  if (loc.code) return loc;
  ctx.loc = loc;
  return null;
}

const LABEL_CMDS = new Set(['MathMLintent', 'intent']);
const ARG_CMDS = new Set(['MathMLarg', 'iarg']);

/** F3: the tool must see kernel markup (and the old shorthand) already there.
 *  Refused: the selection IS a label or operand command, or is exactly what an
 *  existing label wraps. Allowed: a selection that CONTAINS labels, and a
 *  selection that is exactly an existing operand (labelling inside a label). */
export function checkNotLabelled(ctx) {
  const { terms, row } = ctx.loc;
  if (terms.length === 1 && !ctx.loc.cut && terms[0].base.kind === 'command') {
    const c = terms[0].base;
    if (LABEL_CMDS.has(c.name)) {
      const v = ctx.src.slice(c.args[0].start, c.args[0].end);
      return problem('already-labelled', `This is an existing label ("${v}"). Change or remove it instead of labelling it again.`);
    }
    if (ARG_CMDS.has(c.name)) return problem('already-labelled', 'This is an existing operand mark (\\MathMLarg). Select what is inside it to label that.');
  }
  // exactly the body of an existing label
  const owner = row.parent;
  if (owner && owner.kind === 'command' && LABEL_CMDS.has(owner.name) && owner.args[1] === row && covers(ctx, row)) {
    const v = ctx.src.slice(owner.args[0].start, owner.args[0].end);
    return problem('already-labelled', `This notation is already labelled "${v}".`);
  }
  return null;
}
const covers = (ctx, row) => {
  const ct = contentTerms(row);
  return ct.length && ct[0].start === ctx.start && ct.at(-1).end === ctx.end;
};

export const DEFAULT_CHECKS = Object.freeze([
  checkNotEmpty, checkConcept, checkInMath, checkCells, checkStructure, checkNotLabelled,
]);

/** Run the checks in order; the first problem refuses. */
export function runChecks(ctx, checks = DEFAULT_CHECKS) {
  for (const check of checks) {
    const p = check(ctx);
    if (p) return p;
  }
  return null;
}

/** Arg names used where a new label could clash: inside the selection, and
 *  inside every existing label that holds the selection. */
export function namesInScope(ctx) {
  const names = new Set();
  for (const c of allCommands(ctx.region.tree)) {
    if (!ARG_CMDS.has(c.name) || !c.args[0]) continue;
    const inSel = c.start >= ctx.start && c.end <= ctx.end;
    if (inSel) { names.add(ctx.src.slice(c.args[0].start, c.args[0].end).trim()); continue; }
  }
  for (const c of allCommands(ctx.region.tree)) {
    if (!LABEL_CMDS.has(c.name) || !(c.start <= ctx.start && ctx.end <= c.end)) continue;
    for (const d of allCommands(c.args[1] ?? { terms: [] })) {
      if (ARG_CMDS.has(d.name) && d.args[0]) names.add(ctx.src.slice(d.args[0].start, d.args[0].end).trim());
    }
  }
  return names;
}
