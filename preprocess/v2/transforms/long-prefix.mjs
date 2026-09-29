// v2/transforms/long-prefix.mjs — REWRITE (DESIGN-V2 §4.5; HANDOFF §9i, §9j).
//
// Plain terms: find the word \long where it sits in front of a definition,
// and take that one word out. Change nothing else on the line.
//
//     BEFORE   \global\long\def\reals{\mathbf{R}}
//     AFTER    \global\def\reals{\mathbf{R}}
//
//     BEFORE   \long\def\@xtablecaption[#1]#2{%
//     AFTER    \def\@xtablecaption[#1]#2{%
//
// MEASURED (Pandoc 3.11, 2026-09-16). Identical documents, one prefix changed:
//     \def   \global\def   \outer\def   \long\global\def     all convert
//     \long\def          the definition NEVER REGISTERS; it is lost silently
//                        and every call to it vanishes with its braced argument
//     \global\long\def   HARD PARSE ERROR — "unexpected \long"; the whole
//                        document converts to nothing at all
//
// THE MECHANISM IS UNEXPLAINED, and nothing here depends on explaining it.
// Why \long\global\def survives where \long\def does not is unknown. Every
// fixture in v2/test/long-prefix.mjs pins OBSERVED BEHAVIOUR, never a reason.
//
// THE CORPUS (6,144 files on disk / 3,942 distinct / 3,417 handout-eligible
// distinct; sessions 6 and 7 of checkpoint 2b):
//     \global\long\def   2,490 hits / 25 files / 17 distinct documents
//     \long\def            106 hits / 44 files / 14 distinct documents
//     \long\<prefix>\def     0 hits — the ordering that works never occurs
// Union, and the size of intended diff change #3: 2,596 edits across 69 files
// and 31 distinct documents (2,490 + 106 hits; 25 + 44 files; 17 + 14
// documents — exact in all three dimensions). RE-MEASURED in session 8 against
// this transform itself rather than against a scan resembling it, and the two
// agree to the hit.
// Seventeen documents that today convert to NOTHING would convert. That is
// the largest single effect measured in this checkpoint. THE WEAKNESS IN THE
// CASE, recorded rather than buried: neither population is Harvard-authored.
// The 2,490 are one LyX macro block pasted into 25 files of one ML course
// repository; the 106 are vendored CTAN packages. No Math Ma file is in
// either, and APMTH 121 — which carries six copies of supertabular.sty in its
// own macros folder — is not Intro Sequence.
//
// WHY onFile AND NOT A COMMAND HOOK — the lesson at-letter and
// require-package already learned. walkDefinitions deliberately jumps
// \DeclareOption bodies, \ifthenelse extents and definition bodies, so a
// command hook cannot see inside them. Session 7 MEASURED that a \long\def
// inside such a body is real (nine occurrences) and that it is FATAL the
// moment the body is expanded. A file-level scan sees everything.
//
// WHY A REWRITE AND NOT A REMOVAL, deliberately. decide.remove() reports on
// the REMOVED channel, which is where content deletions are shown to a
// faculty member, and a prefix word is not content. A non-empty replacement
// keeps this on the CHANGED channel, where it belongs. (decide.rewrite()
// refuses an empty replacement for exactly this reason.)
//
// CHOICE 1a (Nicholas, 2026-09-16): the word is removed in front of ANY
// definition form, ALWAYS, including inside a macro body. Settled on
// measurement, not tidiness: a rule that rewrites inside bodies is correct
// whether or not the body is ever expanded; a rule that skips bodies is
// correct in one state and catastrophic in the other.
//
// CHOICE 2a (Nicholas, 2026-09-16): one finding per occurrence, as
// require-package does. midterm-review.tex therefore produces 102 findings.
// Collapsing them into one line is REPORT's job (§4.9, stage 8) — findings
// already carry `rule` — and is docketed there so it is not solved twice.
//
// BRACE DEPTH IS DELIBERATELY NOT CONSULTED. The rewrite is correct at every
// depth, so nothing here needs to know. It is also worth saying plainly that
// brace depth is not the same thing as "inside a macro body", and this
// transform does not claim to be able to tell the difference.
import { PREFIXES, isDefinitionForm } from "../definition.mjs";

// .tex, .sty and .cls — all three, with NO narrowing. Nothing is deleted, so
// the "will this edit have any effect" test that narrows require-package has
// nothing to weigh here: the edit makes a definition readable rather than
// removing one. at-letter already hands .sty/.cls bodies to Pandoc behind a
// \makeatletter prefix, so a package in the chain has the same problem as a
// document. The walk only ever visits files in the document's own chain, so a
// vendored package that is never opened is never edited.
const inScope = (file) => /\.(tex|sty|cls)$/i.test(String(file || ""));

// Space and Comment only, NEVER a line break — the same step
// definition.readDefinition() takes between a prefix and its form, so this
// transform and the store agree on what a prefix chain is. A \long separated
// from its definition by a newline is therefore left alone: the store does not
// call that a prefixed definition, and what Pandoc makes of that shape has not
// been measured. A COMMENT ALWAYS ENDS A LINE, so although Comment tokens are
// stepped over here, the Newline that follows one stops the match as well: in
// practice the two are one case, not two.
// MEASURED, session 8 (_work\_s8-linebreak.txt): across all 6,144 files the
// narrowing costs NOTHING. Every \long standing in front of a definition
// reaches it without crossing a line — 2,596 matches with the line break
// allowed, 2,596 without, zero missed. The narrowing is therefore a decision
// with a measured price of zero, not an accident, and it is fixtured below.
const skipBlanks = (tokens, i) => {
  while (i < tokens.length && (tokens[i].kind === "Space" || tokens[i].kind === "Comment")) i++;
  return i;
};
const backBlanks = (tokens, i) => {
  while (i >= 0 && (tokens[i].kind === "Space" || tokens[i].kind === "Comment")) i--;
  return i;
};
const isWord = (t, name) => !!t && t.kind === "ControlWord" && t.name === name;
const isPrefix = (t) => !!t && t.kind === "ControlWord" && PREFIXES.has(t.name);

// The note is the sentence a faculty member reads in the change list, so it
// says what would have happened, not what the rule is called. Three branches,
// because only two of the shapes have been put to Pandoc: claiming the
// measured damage for an ordering nobody has tested would be exactly the
// theory the standing trap forbids.
const NOTE_GLOBAL_LONG =
  "\\global\\long in front of \\def is a hard parse error in Pandoc 3.11 — the file converts to " +
  "nothing at all, and the error names a line that looks perfectly ordinary. With the word " +
  "\\long gone the line reads \\global\\def, which Pandoc honours. Nothing else on the line changes.";
const NOTE_BARE_LONG =
  "Pandoc 3.11 never registers a definition written \\long\\def: the definition is lost silently, " +
  "and every call to it disappears along with whatever was inside its braces. With the word " +
  "\\long gone it is a plain \\def, which Pandoc reads. Nothing else on the line changes.";
const NOTE_UNIFORM =
  "\\long is the word Pandoc mishandles in front of a definition, so it is removed wherever it " +
  "stands in front of one. What Pandoc does with this exact ordering has not been measured " +
  "separately; the rule is uniform so that no definition depends on an ordering nobody has tested.";

function noteFor(before, after, formName) {
  if (formName !== "def" || after.length) return NOTE_UNIFORM;
  if (before.length === 1 && before[0] === "global") return NOTE_GLOBAL_LONG;
  if (before.length === 0) return NOTE_BARE_LONG;
  return NOTE_UNIFORM;
}

export function createLongPrefix() {
  return {
    name: "long-prefix",
    rounds: [1],

    onFile({ tokens, file, emit, decide }) {
      if (!inScope(file)) return;

      for (let i = 0; i < tokens.length; i++) {
        if (!isWord(tokens[i], "long")) continue;

        // Forward to the definition form, over any further prefixes. A second
        // \long is possible in principle and goes out with the first, so the
        // rewrite can never leave one behind.
        const drop = new Set([i]);
        const after = [];
        let j = skipBlanks(tokens, i + 1);
        while (isPrefix(tokens[j])) {
          if (tokens[j].name === "long") drop.add(j);
          else after.push(tokens[j].name);
          j = skipBlanks(tokens, j + 1);
        }

        // THE MATCH REQUIRES A DEFINITION-FORM TOKEN, not merely the word
        // \long. \long in front of anything else is left exactly as written.
        const form = tokens[j];
        if (!form || form.kind !== "ControlWord" || !isDefinitionForm(form.name)) continue;

        // What stands immediately before the \long, for the note only.
        const before = [];
        let b = backBlanks(tokens, i - 1);
        while (isPrefix(tokens[b])) { before.unshift(tokens[b].name); b = backBlanks(tokens, b - 1); }

        // The span runs from the \long token through the definition-form
        // token; the replacement is the same text minus \long. The blanks a
        // removed word absorbed go out with it (rule 47), so \long \def
        // becomes \def and not " \def". Everything else in the span — the
        // other prefix words and the blanks between them — is reprinted
        // exactly as the author wrote it.
        let replacement = "";
        for (let k = i; k <= j; k++) {
          if (drop.has(k)) {
            while (k + 1 <= j && tokens[k + 1].kind === "Space") k++;
            continue;
          }
          replacement += tokens[k].text;
        }

        emit(decide.rewrite({
          by: "long-prefix",
          span: { start: tokens[i].start, end: form.end },
          replacement,
          rule: "long-prefix/removed",
          note: noteFor(before, after, form.name),
        }));

        // Never re-enter this prefix chain. The form's ARGUMENTS are still
        // scanned, which is what finds the nested \long\gdef sitting inside
        // the body of a \long\def on the line above it.
        i = j;
      }
    },
  };
}

export default createLongPrefix;
