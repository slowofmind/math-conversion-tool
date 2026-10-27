// v2/transforms/part-chapter.mjs — session 274. In a class without chapters,
// each heading \part is written \chapter in the -pp copy
// (accessibility-checker/PLAN-PART-CHAPTER-a11y04.md; DECISIONS 2026-10-26:
// "Sign off the \part to \chapter plan as written: an accessibility fix
// (visible), built in a preprocessor session."). Thirteenth and last in run.mjs.
//
// Plain terms: Pandoc 3.11 always places \chapter between \part and \section,
// whatever the class. In an article, where \part sits directly above \section,
// the web page therefore goes from a level-1 heading to a level-3 heading, and
// Word from Heading 1 to Heading 3 (_work/_a11y04-part-observe.txt). Written
// as \chapter, the same headings come out 1, 2, 3. An article has no \chapter,
// so one line goes in just before \begin{document} that makes \chapter mean
// \part for TeX:
//     \expandafter\let\csname chapter\endcsname\part
// With it the -pp copy compiles to the same PDF text and the same table of
// contents (_work/_a11y04-part-tex.txt); Pandoc does not read it (the flagging
// fix relies on the same). The author's file and the PDF do not change.
//
// When (the plan's rule, class first, as Nicholas asked):
// - The class has no chapters: a known chapter-less class (CHAPTERLESS), or a
//   class in neither list when the document never uses \chapter. Never a class
//   with chapters (WITH_CHAPTERS), beamer (its \part organises the slides) or
//   exam (its \part is part (a) of a question). A subfile's class is its
//   parent's.
// - Never when \chapter appears anywhere in the author's files or the reader's
//   store defines it: the line would replace the author's own \chapter. (The
//   plan's rule for unknown classes, applied to every class: 0 corpus articles
//   use \chapter, _work/_a11y04-part-count.txt.)
// - The \part is a heading: running text by placeAt (not a definition body -
//   the expander writes a call out and the copy there is changed - not maths,
//   an option, a picture), not inside a `parts` environment, not inside an
//   environment this version hides, and followed by its {title} (after an
//   optional * and [short]). Found by tokens.
// - Only the author's files (a package is never edited).
// What is written: the command word only, \part -> \chapter, so the star, the
// [short] title and another fix's edits inside the title stay. The line goes
// in once, before \begin{document} in the file that holds the class: the
// entry, or a subfile's parent (whose preamble a subfile converted on its own
// receives, v2/subfile-preamble.mjs).
// Reported once per document (part/chapter, an accessibility fix); each
// heading's edit is part/heading, kept among the decisions but out of the
// findings, like flagging's per-call tags.
import { readGroup, readBracket, matchEnvironment } from "../structure.mjs";

export const CHAPTERLESS = Object.freeze(["article", "amsart", "scrartcl", "extarticle", "ltjsarticle", "jsarticle", "ctexart",
  "tufte-handout", "IEEEtran", "revtex4", "revtex4-1", "revtex4-2", "elsarticle", "proc", "amsproc", "ltxdoc"]);
export const WITH_CHAPTERS = Object.freeze(["book", "report", "memoir", "scrbook", "scrreprt", "amsbook", "extbook", "extreport",
  "tufte-book", "jsbook", "jreport", "ltjsbook", "ltjsreport", "ctexbook", "ctexrep", "octavo"]);
export const NEVER = Object.freeze(["beamer", "exam"]);
export const PART_LINE = "% Added by the preprocessor: each \\part heading is written \\chapter so that the web page and Word get an outline " +
  "with no level missing; this line makes \\chapter mean \\part again for TeX, so the PDF is unchanged:\n" +
  "\\expandafter\\let\\csname chapter\\endcsname\\part\n";
const LESS = new Set(CHAPTERLESS), WITH = new Set(WITH_CHAPTERS), NOT = new Set(NEVER);

const textOf = (toks) => toks.map((t) => t.text).join("");
const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? textOf(ts.slice(g.open + 1, g.close)).trim() : null; };

// classKind(name) -> "chapterless" | "with-chapters" | "never" | "unknown"; a
// class named by path (tex/tufte-book) is judged by its last part
export function classKind(name) {
  const n = String(name || "").split("/").pop();
  return LESS.has(n) ? "chapterless" : WITH.has(n) ? "with-chapters" : NOT.has(n) ? "never" : "unknown";
}

// partFixApplies({ cls, usesChapter }) -> true when the class allows the fix:
// usesChapter, \chapter appears in the author's files or the store defines it
export function partFixApplies({ cls, usesChapter }) {
  const k = classKind(cls);
  return (k === "chapterless" || k === "unknown") && !usesChapter;
}

// The heading \part commands of one file: [{ start, end }] of the command word.
function headingsOf(tokens, file, hid, placeAt) {
  const spans = [], parts = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].kind !== "ControlWord" || tokens[k].name !== "begin") continue;
    const n = envName(tokens, k);
    if (n === null || (!hid.has(n) && n !== "parts")) continue;
    const env = matchEnvironment(tokens, k);
    if (env) (n === "parts" ? parts : spans).push([k, env.close]);
  }
  const inside = (list, i) => list.some(([a, b]) => a <= i && i <= b);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "part") continue;
    if (inside(spans, i) || inside(parts, i) || placeAt(file, tokens, i).place !== "text") continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].kind === "Space") j++;
    if (tokens[j] && tokens[j].kind === "Other" && tokens[j].text === "*") j++; else j = i + 1;
    const br = readBracket(tokens, j);
    if (br) j = br.close + 1;
    if (!readGroup(tokens, j)) continue;                 // no {title}: not a sectioning use
    out.push({ file, start: t.start, end: t.end });
  }
  return out;
}

// Where \begin{document} starts in a file's tokens, or -1.
function beginDocumentAt(tokens) {
  for (let i = 0; i < tokens.length; i++)
    if (tokens[i].kind === "ControlWord" && tokens[i].name === "begin" && envName(tokens, i) === "document") return tokens[i].start;
  return -1;
}

// createPartChapter({ files, cls, classFile, storeHasChapter, hidden, placeAt })
//   files            the author's files of the chain: [{ path, tokens }]
//   cls              the document's class (a subfile's: its parent's)
//   classFile        the file whose \documentclass names it; the line goes there
//   storeHasChapter  the reader's store defines \chapter
//   hidden           the environments this version hides (the reader's)
//   placeAt          (file, tokens, k) -> { place, depends }: v2/flag-calls.mjs placeAt
export function createPartChapter({ files = [], cls = null, classFile = null, storeHasChapter = false, hidden = [], placeAt } = {}) {
  const BY = "part-chapter";
  const usesChapter = storeHasChapter || files.some((f) => f.tokens.some((t) => t.kind === "ControlWord" && t.name === "chapter"));
  const sites = [];
  if (partFixApplies({ cls, usesChapter }))
    for (const f of files) sites.push(...headingsOf(f.tokens, f.path, new Set(hidden), placeAt));
  const classTokens = (files.find((f) => f.path === classFile) || {}).tokens;
  const lineAt = sites.length && classTokens ? beginDocumentAt(classTokens) : -1;
  const at = new Map();
  for (const s of sites) { if (!at.has(s.file)) at.set(s.file, new Set()); at.get(s.file).add(s.start); }

  const commands = {
    part(ctx) {
      const { tokens, i, file, emit, decide } = ctx;
      if (!at.has(file) || !at.get(file).has(tokens[i].start)) return null;
      emit(decide.rewrite({ by: BY, file, rule: "part/heading", span: { start: tokens[i].start, end: tokens[i].end }, replacement: "\\chapter",
        note: "wrote this \\part as \\chapter: the web page and Word then put no empty level between it and the \\section below. What a compile prints is unchanged." }));
      return null;
    },
    begin(ctx) {
      const { tokens, i, file, emit, decide } = ctx;
      if (lineAt < 0 || file !== classFile || tokens[i].start !== lineAt) return null;
      emit(decide.rewrite({ by: BY, file, rule: "part/chapter", span: { start: lineAt, end: lineAt }, replacement: PART_LINE,
        detail: { headings: sites.length, cls },
        note: "wrote the document's " + sites.length + " \\part heading" + (sites.length === 1 ? "" : "s") + " as \\chapter, and added one line " +
          "before \\begin{document} that makes \\chapter mean \\part for TeX. Pandoc always places \\chapter between \\part and \\section, " +
          "so in this class (" + cls + ", no chapters) the web page and Word went from a level-1 heading straight to a level-3 heading; " +
          "now the outline has no level missing. What a compile prints is unchanged." }));
      return null;
    },
  };
  return { transform: { name: BY, rounds: [1], commands }, sites };
}

export default createPartChapter;
