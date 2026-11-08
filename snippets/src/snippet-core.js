// src/snippet-core.js — the snippet core: text + selection + concept in,
// kernel intent markup out.
// [CLAUDE 2026-11-02] Track C of the overnight plan (section 5). Headless: no
// editor, no page, no converter. Writes only the kernel notation
//   \MathMLintent{concept($a,$b)}{...\MathMLarg{a}{...}...\MathMLarg{b}{...}...}
// with the FORMAL concept name from the Reference tool. No macros, no
// shorthand, no literals (the converter swaps literals in later), no spoken
// preview.
//
//   const core = createSnippetCore(exportJson);
//   core.apply(doc, { start, end }, 'logarithm')
//   core.applyWithOperands(doc, sel, concept, [{ start, end }, ...])   // author-marked, concept order
//   core.applyWithOperandTexts(doc, sel, concept, ['x', { text: 'b', occurrence: 2 }])
//   core.search('log', { group: 'calculus-analysis' })
//
// Every call returns one of
//   { status: 'ready', edit: { start, end, text }, value, operands:[{ name, text, start, end }],
//     orderFrom, shape, warnings }
//   { status: 'needs-operands', reason: { code, message }, forms, candidates?, warnings }
//   { status: 'refused', reason: { code, message } }
// `edit` replaces document[start, end) with text; applyEdit() does that.
import { loadConceptIndex, formsOf, searchConcepts, describe, groupsIn } from './concepts.js';
import { trimRange, runChecks, locateSelection, namesInScope, regionFor } from './checks.js';
import { chooseInterpretation } from './shapes.js';
import { writeKernel } from './writer.js';

export function applyEdit(doc, edit) {
  return doc.slice(0, edit.start) + edit.text + doc.slice(edit.end);
}

const refused = reason => ({ status: 'refused', reason });

export function createSnippetCore(exportJson) {
  const index = loadConceptIndex(exportJson);

  function context(doc, sel, conceptKey) {
    const { start, end } = trimRange(doc, sel.start, sel.end);
    return { src: doc, start, end, text: doc.slice(start, end), conceptName: conceptKey,
             concept: index.get(conceptKey), cache: {}, warnings: [], index };
  }

  function needs(ctx, reason, extra = {}) {
    return { status: 'needs-operands', reason, forms: formsOf(ctx.concept),
             concept: describe(ctx.concept), warnings: ctx.warnings, ...extra };
  }

  function ready(ctx, written, extra) {
    return { status: 'ready', edit: { start: ctx.start, end: ctx.end, text: written.text },
             value: written.value, operands: written.operands, warnings: ctx.warnings, ...extra };
  }

  function apply(doc, sel, conceptKey) {
    const ctx = context(doc, sel, conceptKey);
    const p = runChecks(ctx);
    if (p) return refused(p);
    const forms = formsOf(ctx.concept);
    if (!forms.length) {
      const va = ctx.concept.variableArity ? ` (the Reference tool says "${ctx.concept.variableArity}")` : '';
      return needs(ctx, { code: 'arity-unknown', message:
        `The Reference tool does not record a fixed number of operands for "${ctx.concept.concept}"${va}. Mark the operands.` });
    }
    const choice = chooseInterpretation(ctx, forms);
    if (choice.problem) return needs(ctx, choice.problem, choice.candidates ? { candidates: choice.candidates } : {});
    if (choice.orderFrom === 'reading' && choice.operands.length > 1)
      ctx.warnings.push({ code: 'order-unconfirmed', message:
        `The Reference tool gives no wording or example that fixes the operand order of "${ctx.concept.concept}"; ` +
        'the reading order was used. Check that the operands are in the right order.' });
    const written = writeKernel(ctx, { form: choice.form, operands: choice.operands, names: namesInScope(ctx) });
    return ready(ctx, written, { orderFrom: choice.orderFrom, shape: choice.shape });
  }

  function applyWithOperands(doc, sel, conceptKey, ranges) {
    const ctx = context(doc, sel, conceptKey);
    const p = runChecks(ctx);
    if (p) return refused(p);
    const n = ranges.length;
    const forms = formsOf(ctx.concept);
    let form = forms.find(f => f.arity === n);
    if (!form) {
      if (forms.length) return refused({ code: 'arity-mismatch', message:
        `"${ctx.concept.concept}" takes ${forms.map(f => f.arity).join(' or ')} operand(s); ${n} were marked.` });
      form = { arity: n, operands: Array.from({ length: n }, (_, i) => `a${i + 1}`), wording: null };
      ctx.warnings.push({ code: 'arity-unknown', message: `The Reference tool records no fixed number of operands for "${ctx.concept.concept}"; the operands are named a1..a${n}.` });
    }
    const ops = [];
    for (const [i, r0] of ranges.entries()) {
      const r = trimRange(doc, r0.start, r0.end);
      if (r.start >= r.end) return refused({ code: 'operand-empty', message: `Operand ${i + 1} is empty.` });
      if (r.start < ctx.start || r.end > ctx.end) return refused({ code: 'operand-outside', message: `Operand ${i + 1} is not inside the selection.` });
      if (ops.some(o => r.start < o.end && o.start < r.end)) return refused({ code: 'operand-overlap', message: `Operand ${i + 1} overlaps another operand.` });
      const loc = locateSelection(ctx.region.tree, r.start, r.end);
      if (loc.code) return refused({ code: 'operand-' + loc.code, message: `Operand ${i + 1}: ${loc.message}` });
      ops.push({ ...r, loc });
    }
    const written = writeKernel(ctx, { form, operands: ops, names: namesInScope(ctx) });
    return ready(ctx, written, { orderFrom: 'author', shape: 'marked' });
  }

  /** Operands given as texts (typed by the author), in concept order. Each is
   *  found inside the selection, counting only places where it is a whole
   *  piece of the math (the t of \operatorname is not): `occurrence`
   *  (1-based) picks a repeat; otherwise the first one no earlier operand
   *  has used. */
  function applyWithOperandTexts(doc, sel, conceptKey, texts) {
    const { start, end } = trimRange(doc, sel.start, sel.end);
    const forms = formsOf(index.get(conceptKey));
    if (forms.length && !forms.some(f => f.arity === texts.length)) return refused({ code: 'arity-mismatch', message:
      `"${conceptKey}" takes ${forms.map(f => f.arity).join(' or ')} operand(s); ${texts.length} were given.` });
    const region = regionFor(doc, start, end);
    const whole = (k, len) => region?.tree && !locateSelection(region.tree, k, k + len).code;
    const used = [], ranges = [];
    for (const [i, t0] of texts.entries()) {
      const t = typeof t0 === 'string' ? { text: t0 } : t0;
      const needle = String(t.text ?? '').trim();
      if (!needle) return refused({ code: 'operand-empty', message: `No text was given for operand ${i + 1}.` });
      const hits = [];
      for (let k = doc.indexOf(needle, start); k >= 0 && k + needle.length <= end; k = doc.indexOf(needle, k + 1))
        if (whole(k, needle.length)) hits.push(k);
      if (!hits.length) return refused({ code: 'operand-not-found', message: `"${needle}" is not in the selection.` });
      const at = t.occurrence ? hits[t.occurrence - 1]
        : hits.find(k => !used.some(u => k < u.end && k + needle.length > u.start));
      if (at === undefined) return refused({ code: 'operand-not-found', message: `"${needle}" does not occur that often in the selection.` });
      used.push({ start: at, end: at + needle.length });
      ranges.push({ start: at, end: at + needle.length });
    }
    return applyWithOperands(doc, sel, conceptKey, ranges);
  }

  return {
    index,
    apply,
    applyWithOperands,
    applyWithOperandTexts,
    search: (query, opts) => searchConcepts(index, query, opts),
    concept: key => { const r = index.get(key); return r ? describe(r) : null; },
    groups: () => groupsIn(index),
  };
}
