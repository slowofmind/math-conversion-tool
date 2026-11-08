// v2/findings.mjs — session 272. One shape for everything a run reports
// (sessions/INTEGRATION-REVIEW-s270.md D3 and its accepted refinements;
// DECISIONS 2026-10-26: "D3. A, build the shared format in the tool first").
// The format is written out for readers in sessions/FINDINGS-FORMAT-s272.md.
//
// Plain terms: a run hands back five lists, each in its own shape - findings
// (what the fixes did or could not do), dropped (commands Pandoc throws away),
// markers (\item[..] marks Pandoc throws away), flagged (drawing commands) and
// flagged sites (pieces inside definitions). This turns them into entries of
// ONE shape, placed in the author's ORIGINAL file by line and column. Pandoc's
// log (pandocEntry, through v2/source-map.mjs) and the checker, later, write
// the same shape, so the platform can show one report.
//
// An entry, its fields always in this order:
//   source   "preprocessor" | "pandoc" | "checker"
//   kind     one of KINDS:
//              "conversion-fix"       the tool changed the -pp copy so Pandoc
//                                     reads it; invisible to the author
//              "accessibility-fix"    the tool changed the -pp copy so the
//                                     output is more accessible; VERY visible
//              "fix-by-hand"          a problem in the author's LaTeX
//              "not-reaching-reader"  something the reader of the HTML / Word
//                                     output will not get
//              "pandoc-message"       a line of Pandoc's log
//            null only for a rule this file does not know (never guessed;
//            unplacedRules lists them)
//   visible  false for a conversion fix, true for everything else
//   level    "error" | "warning" | "note"
//   rule     the tool's rule name (lists/carrier ...), or Pandoc's message type
//   where    { file, line, column, start, end, endLine, endColumn, written }:
//            the ORIGINAL file, lines and columns from 1, start/end
//            character offsets (end exclusive); written: the call (\name)
//            when the entry was found in that call's written-out text and is
//            therefore placed at the call, else null; a Pandoc entry adds how
//            / by / preamble and the -pp place it came from (v2/source-map.mjs)
//   label    a short plain label
//   message  the tool's own sentence, unchanged
//   fixes    the LIST of fix options (one or none today; a menu later):
//              { description, mayApply: "pp" | "pp+source" | "source",
//                replayable, applied }
//            replayable: the change sits inside the author's own text - not
//            in a written-out call's text, not lines added at the top - so it
//            could one day be replayed onto the source (D2's later loop).
//            Today every preprocessor fix applies to the -pp copy only ("pp").
//   ways     for a check: [{ way, serves: ["pdf","html","word"], rank }] -
//            the accepted ways of meeting the need and the outputs each
//            serves; null for the preprocessor's entries
//   rank     for a check: the place of the way used in HIERARCHY; else null
//   from     { list, channel, level }: which list of the run it came from,
//            and the tool's own channel and level (the checker: list "pp" or
//            "original", the text it read)
//   link     session a11y-04: { id, role: "call" | "definition", name } for a
//            checker finding inside an author's command - the same problem
//            reported at each call and once at the definition, sharing the id
//            (Nicholas, 2026-10-26: "at both the call and the definition");
//            null otherwise
//   detail   s291: for "redefined before defined" sorted by step 6 (a run given
//            the names list): { origin, level: "Everything" | "Check",
//            pdflatex }, the combined report's level; null otherwise
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).
import { mapPosition } from "./source-map.mjs";

export const SOURCES = Object.freeze(["preprocessor", "pandoc", "checker"]);
export const KINDS = Object.freeze(["conversion-fix", "accessibility-fix", "fix-by-hand", "not-reaching-reader", "pandoc-message"]);
export const OUTPUTS = Object.freeze(["pdf", "html", "word"]);

// The hierarchy of preferred fixes (DECISIONS 2026-10-26, "keeping the
// hierarchy of preferred fixes clear"): a check's message leads with the way
// that serves every output.
export const HIERARCHY = Object.freeze([
  Object.freeze({ rank: 1, serves: "the PDF, the web page and Word", says: "all good" }),
  Object.freeze({ rank: 2, serves: "the web page and Word (the platform), not the PDF", says: "good, with a note that it will not work in Overleaf's PDF" }),
  Object.freeze({ rank: 3, serves: "the PDF only", says: "reported as missing for the web page and Word, with the fix that serves every output" }),
  Object.freeze({ rank: 4, serves: "none of them", says: "missing" }),
]);
export function rankOf(serves) {
  const s = new Set(serves || []);
  if (s.has("pdf") && s.has("html") && s.has("word")) return 1;
  if (s.has("html") && s.has("word")) return 2;
  if (s.has("pdf")) return 3;
  return 4;
}

// Every rule the tool can emit, its kind and a short label. The list was read
// from the code in session 272 (every emitting line); a rule added later must
// be added here, or its entries carry kind null and unplacedRules names it.
const C = "conversion-fix", A = "accessibility-fix", H = "fix-by-hand", N = "not-reaching-reader";
const RULES = new Map(Object.entries({
  // fixes so that Pandoc reads the file
  "at-letter/prepend": [C, "@ names kept whole"], "at-letter/marker-blanked": [C, "@ names kept whole"],
  "require-package/rewritten": [C, "package loaded for Pandoc"],
  "marker-rewrite/terminator": [C, "argument end made readable"],
  "package-options/spliced": [C, "package options carried"],
  "comment-alias/begin": [C, "comment environment named"], "comment-alias/end": [C, "comment environment named"],
  "ifthen/folded": [C, "version chosen"], "ifthen/folded-empty": [C, "version chosen"],
  "long-prefix/removed": [C, "\\long removed"],
  "lists/carrier": [C, "list numbers carried"], "lists/item-mark": [C, "list numbers carried"],
  "lists/item-tag": [C, "list numbers carried"], "lists/preamble": [C, "lines added for lists"],
  "columns/unwrap": [C, "columns unwrapped"], "columns/count": [C, "column count hidden"],
  "flag/tag": [C, "drawing tagged"], "flag/preamble": [C, "lines added for tags"],
  "inline/preamble": [C, "lines added for wraps"],
  "tagged/metadata": [C, "document settings kept out of the text"],
  "expand/expanded": [C, "command written out"], "expand/expanded-math": [C, "command written out"],
  "expand/expanded-pandoc-drops": [C, "command written out"], "expand/expanded-redefines-dropped": [C, "command written out"],
  "expand/removed-empty": [C, "command written out"],
  // fixes for the reader's sake
  "tagged/artifact": [A, "decorative image marked"], "tagged/actualtext": [A, "image text carried as alt text"],
  // session 274: in a class without chapters (PLAN-PART-CHAPTER-a11y04); part/heading stays out of a run's findings
  "part/chapter": [A, "parts made a heading level the web page can follow"], "part/heading": [A, "parts made a heading level the web page can follow"],
  // the author's own LaTeX
  "store/already-defined": [H, "defined twice"], "store/renew-undefined": [H, "redefined before defined"],
  "store/unbalanced-close": [H, "closed, never opened"], "store/mismatched-close": [H, "closed in the wrong order"],
  "store/flag-already-defined": [H, "switch declared twice"], "store/flag-undefined": [H, "switch never declared"],
  "walk/group-left-open": [H, "group left open"],
  "reader/option-clash": [H, "package options clash"], "reader/forward-after-load": [H, "options passed too late"],
  "comment-alias/text-after-end": [H, "text after an \\end"],
  "ifthen/malformed": [H, "\\ifthenelse unreadable"],
  "lists/too-deeply-nested": [H, "lists nested too deeply"],
  "tagged/artifact-alt": [H, "image both decoration and described"],
  "inline/visible": [H, "font command around a block"], "inline/left": [H, "font command around a block"],
  "expand/refused-unreadable": [H, "call unreadable"],
  // what will not reach the reader
  "pandoc-drops/name": [N, "dropped by Pandoc"], "pandoc-drops/item-marker": [N, "item marker dropped"],
  "flag/tagged": [N, "drawing not carried"], "flag/inside": [N, "drawing not carried"], "flag/left": [N, "drawing not carried"],
  "flag/expanded": [N, "drawing not carried"], "flag/site-tagged": [N, "drawing not carried"], "flag/site-left": [N, "drawing not carried"],
  "lists/numbers-unsure": [N, "list numbers not carried"], "lists/not-a-pandoc-list": [N, "not a list in the output"],
  "lists/left-alone": [N, "list numbers not carried"], "lists/label-not-carried": [N, "list marker style lost"],
  "lists/item-tag-not-written": [N, "list number not carried"], "lists/depth-at-least": [N, "list numbers not carried"],
  "columns/not-unwrapped": [N, "block dropped by Pandoc"],
  "store/pandoc-ignores-redefinition": [N, "redefinition not read"],
  "tagged/lang": [N, "language not carried"], "tagged/text-lang": [N, "language change not carried"],
  "tagged/table-headers": [N, "table headers not carried"], "tagged/low-level": [N, "tagged structure not carried"],
  "tagged/drawing-alt": [N, "drawing description lost"],
  "unknown/command-dropped": [N, "unknown command dropped"], "unknown/command-content-lost": [N, "unknown command dropped"],
  "unknown/environment-wrapped": [N, "unknown environment"],
  // the tool could not settle it: what reaches the reader may differ from the print
  "ifthen/unknown": [N, "version not settled"], "ifthen/unknown-parameter": [N, "version not settled"],
  "package-options/handlers-disagree": [N, "package options not carried"],
  "marker-rewrite/refused": [N, "argument end not rewritten"],
  "capability/rows-disagree": [N, "Pandoc's handling unsure"],
}));
// families placed by the level the code gives them (s272 code-reading):
// author-error -> fix by hand, unsupported -> will not reach the reader
const BY_HAND = new Set(["param-order", "param-malformed", "body-missing", "body-unclosed", "arg-count-not-digit",
  "let-target-missing", "required-delimited-missing", "blank-line-crossed", "arguments-missing", "newif-target",
  "newif-name", "flag-name-missing", "flag-value-missing", "flag-value"]);
const TOKENIZER_UNSUPPORTED = new Set(["hat-notation", "bare-carriage-return"]);
const EXPAND_REFUSED = new Set(["budget", "environment", "ifthen", "joint", "let-copy", "math-handler", "name", "option",
  "parameter", "redefined", "switch", "threw", "unmodelled"]);
const DEFINITION_UNSUPPORTED = new Set(["name-missing", "csname-name", "name-unclosed", "name-not-single", "name-not-a-command",
  "hash-brace", "whitespace-delimiter", "cs-delimiter", "xparse-delimiter", "xparse-default-missing", "xparse-unknown-letter",
  "global-prefix-rejected"]);

// s278: a flagged call whose definition holds only a box, or a box piece
// inside a definition, is labelled as a box, not a drawing
export const BOX_LABEL = "box not carried";

// kindOf(rule) -> { kind, label } or null for a rule nobody placed
export function kindOf(rule) {
  if (RULES.has(rule)) { const [kind, label] = RULES.get(rule); return { kind, label }; }
  const [fam, name] = String(rule).split("/");
  if (fam === "definition" && BY_HAND.has(name)) return { kind: H, label: "definition unreadable" };
  if (fam === "definition" && DEFINITION_UNSUPPORTED.has(name)) return { kind: N, label: "definition not read by Pandoc" };
  if (fam === "tokenizer" && TOKENIZER_UNSUPPORTED.has(name)) return { kind: N, label: "characters not read by Pandoc" };
  if (fam === "tokenizer" && ["backslash-at-end", "unterminated-verb", "unclosed-verbatim", "unclosed-expl3", "unclosed-url"].includes(name))
    return { kind: H, label: "text left unclosed" };
  if (fam === "expand" && name && name.startsWith("refused-") && EXPAND_REFUSED.has(name.slice(8)))
    return { kind: N, label: "command not written out" };
  return null;
}

const LEVEL = { "author-error": "error", unsupported: "warning", undecidable: "warning" };

function lineStarts(text) {
  const s = [0];
  for (let j = 0; j < text.length; j++) if (text.charCodeAt(j) === 10) s.push(j + 1);
  return s;
}
function lineColumn(starts, off) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
  return { line: lo + 1, column: off - starts[lo] + 1 };
}

// runEntries(run, originals) -> entries, in the run's own order: findings,
// dropped, markers, flagged, flagged sites
//   run        runProject's result
//   originals  Map (or object) name -> the author's text, as given to runProject
export function runEntries(run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const starts = new Map();
  // the calls written out, in the original files' places: a change there is
  // in text the expander wrote, not the author
  const calls = run.expansion && run.expansion.changed ? run.expansion.edits : new Map();
  // where.written: the call whose written-out text the entry was found in
  // (the run places such an entry at the call), or null
  const writtenIn = (file, span) => {
    const e = (calls.get(file) || []).find((x) => x.start <= span.start && span.end <= x.end);
    return e ? "\\" + e.name : null;
  };
  const where = (file, span) => {
    if (!span || !Number.isInteger(span.start) || !orig.has(file))
      return { file: file ?? null, line: null, column: null, start: null, end: null, endLine: null, endColumn: null, written: null };
    if (!starts.has(file)) starts.set(file, lineStarts(orig.get(file)));
    const ls = starts.get(file), a = lineColumn(ls, span.start), b = lineColumn(ls, span.end);
    return { file, line: a.line, column: a.column, start: span.start, end: span.end, endLine: b.line, endColumn: b.column,
             written: writtenIn(file, span) };
  };
  const inWritten = (file, span) => (calls.get(file) || []).some((e) => span.start < e.end && e.start < span.end
    || (span.start === span.end && e.start <= span.start && span.start < e.end));
  const replayable = (rule, file, span, detail) => !!span && Number.isInteger(span.start) && orig.has(file)
    && !String(rule).startsWith("expand/") && !(detail && Object.prototype.hasOwnProperty.call(detail, "rank"))
    && !inWritten(file, span);
  const entry = (rule, w, message, fixes, from, level, detail = null) => {
    const k = kindOf(rule);
    return { source: "preprocessor", kind: k ? k.kind : null, visible: !k || k.kind !== C, level, rule, where: w,
             label: k ? k.label : rule, message: String(message ?? ""), fixes, ways: null, rank: null, from, link: null, detail };
  };
  // s291: a finding sorted by step 6 (v2/unknown-calls.mjs nameRedefinitions) carries its sorting, for the report's levels
  const sorting = (d) => d && d.level ? { origin: d.origin ?? null, level: d.level, pdflatex: d.pdflatex ?? null } : null;
  const out = [];
  for (const f of run.findings || []) {
    const applied = f.channel === "changed" || f.channel === "removed";
    const fixes = applied ? [{ description: String(f.message ?? f.rule), mayApply: "pp", replayable: replayable(f.rule, f.file, f.span, f.detail), applied: true }] : [];
    out.push(entry(f.rule, where(f.file, f.span), f.message, fixes, { list: "findings", channel: f.channel ?? null, level: f.level ?? null },
                   applied ? "note" : (LEVEL[f.level] || "warning"), sorting(f.detail)));
  }
  for (const d of (run.dropped && run.dropped.entries) || [])
    out.push(entry(d.rule, where(d.file, d.span), d.note, [], { list: "dropped", channel: null, level: null }, "warning"));
  for (const m of (run.markers && run.markers.entries) || [])
    out.push(entry(m.rule, where(m.file, m.span), m.note, [], { list: "markers", channel: null, level: null }, "warning"));
  for (const g of (run.flagged && run.flagged.entries) || []) {
    const fixes = g.tagged ? [{ description: "tagged in the -pp copy: the converted page shows the command's source", mayApply: "pp", replayable: replayable(g.rule, g.file, g.span), applied: true }]
      : g.rule === "flag/expanded" ? [{ description: "written out in the -pp copy, its arguments in its definition", mayApply: "pp", replayable: false, applied: true }] : [];
    const e = entry(g.rule, where(g.file, g.span), g.note, fixes, { list: "flagged", channel: null, level: null }, "warning");
    if (g.holds === "box") e.label = BOX_LABEL;
    out.push(e);
  }
  for (const s of (run.flagged && run.flagged.sites) || []) {
    const tagged = s.status === "tag" || s.tagged === true;
    const fixes = tagged ? [{ description: "tagged inside its definition in the -pp copy", mayApply: "pp", replayable: replayable(s.rule, s.file, s.span), applied: true }] : [];
    const e = entry(s.rule, where(s.file, s.span), s.why, fixes, { list: "sites", channel: null, level: null }, tagged ? "note" : "warning");
    if (s.kind === "box") e.label = BOX_LABEL;
    out.push(e);
  }
  return out;
}

// pandocEntry({ level, file, line, column, message, type }, sourceMap) -> an
// entry for one line of Pandoc's log; file, line and column are the -pp
// place Pandoc gives, mapped back to the original (v2/source-map.mjs)
export function pandocEntry(row, sourceMap) {
  const m = sourceMap && row.file ? mapPosition(sourceMap, row.file, { line: row.line, column: row.column || 1 }) : null;
  const w = m ? { file: m.file, line: m.line, column: m.column, start: m.range.start, end: m.range.end,
                  endLine: m.range.to ? m.range.to.line : null, endColumn: m.range.to ? m.range.to.column : null,
                  how: m.how, by: m.by, preamble: m.preamble, ppFile: row.file, ppLine: row.line, ppColumn: row.column || 1 }
              : { file: row.file ?? null, line: row.line ?? null, column: row.column ?? null, start: null, end: null, endLine: null, endColumn: null,
                  how: null, by: null, preamble: false, ppFile: row.file ?? null, ppLine: row.line ?? null, ppColumn: row.column ?? null };
  const lv = String(row.level || "").toLowerCase();
  return { source: "pandoc", kind: "pandoc-message", visible: true, level: lv === "error" ? "error" : lv === "warning" ? "warning" : "note",
           rule: row.type || "pandoc/" + (lv || "message"), where: w, label: "Pandoc's log", message: String(row.message ?? ""),
           fixes: [], ways: null, rank: null, from: { list: "pandoc-log", channel: null, level: row.level ?? null }, link: null };
}

// the rules among some entries that no kind was found for
export function unplacedRules(entries) {
  return [...new Set(entries.filter((e) => e.kind === null).map((e) => e.rule))].sort();
}
