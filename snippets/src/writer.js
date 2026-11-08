// src/writer.js — the kernel writer.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 2 ("a kernel
// writer that adds braces where the single-node rule needs them, and around
// nested labels").
//
// Writes  \MathMLintent{concept($n1,$n2,..)}{ selection, each operand as \MathMLarg{n}{..} }
// The operand list follows the CONCEPT's order (the form's `operands` names),
// whatever order the operands sit in on the page, so the order flip (F1)
// cannot happen. Names come from the export; one that would clash with a
// name already used by a label around or inside the selection gets "-2"
// ("-3" ...).
//
// Brace rules, each measured with the Baseline converter
// (probes/probe-braces.mjs, test/runs/20261102-0-probe-braces.txt):
//   operand braces   {\MathMLarg{n}{..}}
//     - the operand is an unbraced script or command argument (x^2, \bar z):
//       TeX needs the group;
//     - the operand ends in a subscript and a superscript or prime follows
//       (z_k^*, f_n'): otherwise the script merges into the operand (F4);
//     - the operand is the whole selection: otherwise label and operand land
//       on one element.
//   braces inside an operand  \MathMLarg{n}{{..}}
//     - the operand is itself a label: otherwise the old label and the new
//       operand mark land on one element.
//   braces round the whole label  {\MathMLintent{..}{..}}
//     - the selection is an unbraced script or command argument (x^e, \sqrt e);
//     - the selection ends in a subscript and a superscript follows outside
//       it (e_1 in e_1^2): otherwise the script merges into the label;
//     - the selection is exactly an existing operand: otherwise the existing
//       operand mark and the new label land on one element.
import { locateSelection } from './checks.js';
import { contentTerms } from './latex-parse.js';

const VALID_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const LABEL_CMDS = new Set(['MathMLintent', 'intent']);
const ARG_CMDS = new Set(['MathMLarg', 'iarg']);

/** Operand names for this label: the form's names, made valid and free. */
export function chooseNames(form, inScope = new Set()) {
  const out = [];
  form.operands.forEach((n0, i) => {
    let n = VALID_NAME.test(n0 ?? '') ? n0 : `a${i + 1}`;
    const base = n;
    for (let k = 2; inScope.has(n) || out.includes(n); k++) n = `${base}-${k}`;
    out.push(n);
  });
  return out;
}

const isLabel = (src, r, tree) => {
  const loc = locateSelection(tree, r.start, r.end);
  return !loc.code && loc.terms.length === 1 && !loc.cut && loc.terms[0].base.kind === 'command' &&
    LABEL_CMDS.has(loc.terms[0].base.name);
};

/** Does this located range end in a subscript with a script after it? */
const endsInSubBeforeScript = loc => loc.cut === 'base+sub';

/** Is the located range exactly the content of an existing operand mark? */
function isWholeOperandMark(loc, start, end) {
  const row = loc.row, owner = row.parent;
  if (!owner || owner.kind !== 'command' || !ARG_CMDS.has(owner.name) || owner.args.at(-1) !== row) return false;
  const ct = contentTerms(row);
  return ct.length > 0 && ct[0].start === start && ct.at(-1).end === end;
}

/**
 * ctx: { src, start, end, concept, region, loc }
 * form: { operands: [names in concept order] }
 * operands: [{ start, end }] in concept order (document offsets)
 * names: Set of operand names already used around / inside the selection
 * Returns { text, value, operands: [{ name, text, start, end }] }.
 */
export function writeKernel(ctx, { form, operands, names = new Set() }) {
  const { src } = ctx;
  const tree = ctx.region.tree;
  const ns = chooseNames(form, names);
  const placed = operands.map((r, i) => ({ ...r, name: ns[i] })).sort((a, b) => a.start - b.start);
  let body = '', at = ctx.start;
  for (const op of placed) {
    const content = src.slice(op.start, op.end);
    const loc = locateSelection(tree, op.start, op.end);
    const inner = isLabel(src, op, tree) ? `{${content}}` : content;
    let arg = `\\MathMLarg{${op.name}}{${inner}}`;
    const wrap = (!loc.code && loc.row.braced === false) ||
                 (!loc.code && endsInSubBeforeScript(loc)) ||
                 (op.start === ctx.start && op.end === ctx.end);
    if (wrap) arg = `{${arg}}`;
    body += src.slice(at, op.start) + arg;
    at = op.end;
  }
  body += src.slice(at, ctx.end);
  // [CLAUDE 2026-11-08] the head carries the fixity ("implies:infix"): the snippet tool writes
  // fixity into the markup [NICHOLAS 2026-11-08]. From the kernel form when there is one, else the
  // concept's fixity (concepts.js formsOf); a form without a head falls back to the bare name.
  const head = form.head ?? ctx.concept.concept;
  const value = ns.length ? `${head}(${ns.map(n => '$' + n).join(',')})` : head;
  let text = `\\MathMLintent{${value}}{${body}}`;
  const loc = ctx.loc;
  if (loc.row.braced === false || endsInSubBeforeScript(loc) || isWholeOperandMark(loc, ctx.start, ctx.end)) text = `{${text}}`;
  return {
    text, value,
    operands: operands.map((r, i) => ({ name: ns[i], text: src.slice(r.start, r.end), start: r.start, end: r.end })),
  };
}
