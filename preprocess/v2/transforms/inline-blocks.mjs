// v2/transforms/inline-blocks.mjs — session 270. An inline command wrapped
// around a block reaches Pandoc as visible source text around the block
// (sessions/INLINE-BLOCKS-PLAN-s270.md, option A; DECISIONS 2026-10-25, "Yes:
// build the carrier (option A, coloured span form) in the tool only, test
// first."). Eleventh and last in run.mjs.
//
// Plain terms: \emph{..}, \textbf{..} and their kin work only inside a line.
// When an author wraps one around a block - a list, a centred line, a table -
// pdflatex prints it, but Pandoc 3.11 stops on the whole document
// (_work/_s270-pairs.txt): Math Mb ws3-4's hints list, Math 1b's
// \textbf{\centerline{..}} titles. Nicholas: keep the content, and let the
// command's opening and closing come through as plain visible text, so the
// conversion is not blocked and the problem stays visible. So in the -pp copy
// the command word becomes \ppwrap{W<n>}{<name>}, its {argument} untouched:
//     \textbf{\centerline{Error Bounds}}  ->  \ppwrap{W1}{textbf}{\centerline{Error Bounds}}
// Two lines at the top of the entry define \ppwrap (INLINE_HEAD). Pandoc reads
// the plain \newcommand: the argument lands outside any inline command, so the
// block converts plainly, between "W1: \textbf{" and "W1: }" as code text in a
// Span coloured "ppwrap" (like flagging's tags). TeX reads the hidden \csname
// definition after it, which gives back \textbf{..} exactly: the print is the
// same (_work/_s270-carrier.txt: 120 cases, page images identical;
// _work/_s270-real.txt: the five documents that failed only on this).
//
// The choices, each pinned in v2/test/inline-blocks-cases.mjs:
// - Which commands and blocks: the measured table (_work/_s270-pairs.txt).
//   The eleven font commands and \underline, \mbox, \hbox, when their {..}
//   holds \begin of enumerate, itemize, center, tabular, minipage, framed or
//   quote, a \centerline, or a paragraph break (a blank line, \par). Not
//   \textcolor or \colorbox (Pandoc converts them), not display maths (it
//   converts), not \fbox, \makebox, \text (they convert, dropping their
//   contents: a separate question). Another block kind is one more measured
//   entry here.
// - Where: running text only, by placeAt (v2/flag-calls.mjs): not in maths, a
//   definition body (the expander writes a call out in the body, and the copy
//   there is carried), a picture, an option. Not inside an environment this
//   version hides: Pandoc never reads it. Inside an \ifthenelse, which the
//   ifthen fix rewrites whole, it is listed (inline/left), not carried.
// - Only the author's files: a package is never edited.
// - IDs W1, W2 .. in reading order across the document's files: the entry
//   first, then each file in the order it is read; within a file by position.
//   A nested pair gets two, the outer first.
// - Only the command word is rewritten (a zero-length change to everything
//   else), so another fix's edit inside the argument still applies.
import { readGroup, matchEnvironment } from "../structure.mjs";

export const INLINE_HEAD = "% Added by the preprocessor: an inline command around a block reaches Pandoc as visible source text; TeX still runs it:\n" +
  "\\newcommand{\\ppwrap}[3]{\\textcolor{ppwrap}{\\texttt{#1: \\textbackslash{}#2\\{}}#3\\textcolor{ppwrap}{\\texttt{#1: \\}}}}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppwrap\\endcsname#1#2#3{\\csname #2\\endcsname{#3}}\n";

export const WRAPPERS = Object.freeze(["emph", "textbf", "textit", "textsl", "textsc", "texttt", "textrm", "textsf",
  "textup", "textmd", "textnormal", "underline", "mbox", "hbox"]);
export const BLOCK_ENVS = Object.freeze(["enumerate", "itemize", "center", "tabular", "minipage", "framed", "quote"]);
const WRAP = new Set(WRAPPERS), BLOCKS = new Set(BLOCK_ENVS);
const textOf = (toks) => toks.map((t) => t.text).join("");
const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? textOf(ts.slice(g.open + 1, g.close)).trim() : null; };

// The block kinds inside the argument tokens (open, close exclusive), in order
// of first appearance, maths skipped (placeAt).
function blocksIn(tokens, open, close, inMaths) {
  const out = [];
  const add = (b) => { if (!out.includes(b)) out.push(b); };
  for (let k = open + 1; k < close; k++) {
    const u = tokens[k];
    if (u.kind === "Newline" && u.parbreak) { if (!inMaths(k)) add("paragraph break"); continue; }
    if (u.kind !== "ControlWord") continue;
    if (u.name === "centerline" || u.name === "par") { if (!inMaths(k)) add(u.name === "par" ? "paragraph break" : "centerline"); continue; }
    if (u.name === "begin") { const n = envName(tokens, k); if (n !== null && BLOCKS.has(n) && !inMaths(k)) add(n); }
  }
  return out;
}

// The sites of one file: { file, start, open, close, name, blocks, left }.
function sitesOf(file, tokens, hidden, placeAt) {
  const hiddenSpans = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "begin") continue;
    const n = envName(tokens, i);
    if (n === null || !hidden.has(n)) continue;
    const env = matchEnvironment(tokens, i);
    if (env) { hiddenSpans.push([i, env.close]); i = env.close; }
  }
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || !WRAP.has(t.name)) continue;
    if (hiddenSpans.some(([a, b]) => a <= i && i <= b)) continue;
    const at = placeAt(file, tokens, i);
    if (at.place !== "text") continue;
    const g = readGroup(tokens, i + 1);
    if (!g) continue;
    const blocks = blocksIn(tokens, g.open, g.close, (k) => placeAt(file, tokens, k).place === "maths");
    if (!blocks.length) continue;
    out.push({ file, start: t.start, end: t.end, open: g.open, close: g.close, name: t.name, blocks, left: !!at.depends, id: null });
  }
  return out;
}

// createInlineBlocks({ files, entry, hidden, placeAt })
//   files    the author's files of the chain, entry first: [{ path, tokens }]
//   entry    the document; the head goes at its top
//   hidden   the environments this version hides (the reader's)
//   placeAt  (file, tokens, k) -> { place, depends }: v2/flag-calls.mjs placeAt
export function createInlineBlocks({ files = [], entry, hidden = [], placeAt } = {}) {
  const BY = "inline-blocks";
  const hid = new Set(hidden);
  const sites = [];
  for (const f of files) sites.push(...sitesOf(f.path, f.tokens, hid, placeAt));
  let n = 0;
  for (const s of sites) if (!s.left) s.id = "W" + (++n);
  const byStart = new Map();
  for (const s of sites) { if (!byStart.has(s.file)) byStart.set(s.file, new Map()); byStart.get(s.file).set(s.start, s); }
  const said = (s) => "\\" + s.name + " around " + s.blocks.map((b) => (b === "centerline" ? "\\centerline" : b === "paragraph break" ? "a paragraph break" : b)).join(", ");

  const hook = (ctx) => {
    const { tokens, i, file, emit, decide } = ctx;
    const s = byStart.has(file) ? byStart.get(file).get(tokens[i].start) : undefined;
    if (!s || s.left) return null;
    emit(decide.rewrite({ by: BY, file, rule: "inline/visible", span: { start: s.start, end: s.end },
      replacement: "\\ppwrap{" + s.id + "}{" + s.name + "}",
      detail: { id: s.id, command: s.name, blocks: s.blocks },
      note: "wrote " + said(s) + " as \\ppwrap{" + s.id + "}{" + s.name + "}: Pandoc stops on the whole document at an inline " +
        "command around a block. Now it shows \"" + s.id + ": \\" + s.name + "{\" and \"" + s.id + ": }\" as code text around the " +
        "content, which converts plainly. What a compile prints is unchanged." }));
    s.carried = true;
    return null;                                   // the walk goes on inside: a nested site, other fixes' edits
  };
  const hooks = {};
  for (const s of sites) hooks[s.name] = hook;
  const anyCarried = sites.some((s) => !s.left);

  const transform = {
    name: BY,
    rounds: [1],
    commands: hooks,
    onFile({ file, tokens, decide, emit }) {
      for (const s of sites) {
        if (s.file !== file || !s.left) continue;
        emit(decide.flag({ by: BY, file, rule: "inline/left", level: "unsupported", span: { start: s.start, end: tokens[s.close].end },
          detail: { command: s.name, blocks: s.blocks },
          message: said(s) + " sits inside \\ifthenelse, which another fix settles, so it is not carried: Pandoc may stop on " +
            "this document here." }));
      }
      if (file !== entry || !anyCarried) return;
      emit(decide.prepend({ by: BY, rule: "inline/preamble", text: INLINE_HEAD,
        note: "added at the top the definitions of \\ppwrap: Pandoc reads the plain one, TeX the one after it. They print nothing." }));
    },
  };
  return { transform, sites };
}

export default createInlineBlocks;
