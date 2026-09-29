// v2/transforms/at-letter.mjs — PREPEND (DESIGN-V2 §4.5; HANDOFF §9d).
//
// Plain terms: inside a .sty or .cls, @ counts as a letter for the whole
// file, so \@fitbans is ONE command. LaTeX guarantees this because
// \usepackage wraps package loading in \makeatletter. Pandoc does not know
// it and reads \@fitbans as \@ followed by the text "fitbans". So we put
// "\makeatletter " at the very front of the file before handing it over, and
// blank out any \makeatletter / \makeatother already inside — an interior
// \makeatother would switch at-letter mode back off mid-file and defeat the
// prepend.
//
// MEASURED (v1's FINDINGS Part 1, pinned by v2/test/at-letter.mjs): 81 of the
// 84 at-names in handout.sty are mis-tokenized without this, 0 with it.
//
// WHAT CHANGED FROM v1, AND WHAT MUST NOT. v1 did this as a raw-TEXT stage
// that returned a whole new string. v2 does it as EDITS: one PREPEND at
// offset 0 (rank 0 in decide.PREPEND_RANKS, so it stays the first thing in
// the file) plus one REWRITE per interior marker. The move is mechanical and
// the OUTPUT MUST BE BYTE-IDENTICAL to v1's — the suite proves that by
// running v1's own transform beside this one. A difference there is a bug,
// not an improvement (HANDOFF §9d, diff class 3).
//
// WHY EVERYTHING HAPPENS IN onFile, AND NOT IN A COMMAND HOOK. This was
// measured, not assumed: hooking `makeatletter` fired ZERO times on the real
// handout.sty. walkDefinitions deliberately JUMPS whole regions — a
// \DeclareOption body (stage 4 decides which options run), an \ifthenelse
// extent (stage 5 decides the branch), and every definition body (principle
// 4) — so a command hook never sees inside them. handout.sty's marker pairs
// are inside \DeclareOption bodies, which is the very shape that defeated
// unified-latex's flat region scanner. A transform needing EVERY occurrence
// of something must scan the token array in onFile, where it gets the whole
// file. Do NOT "fix" this in store.mjs; it would cost gate R.
//
// v2 IS NOT BYTE-IDENTICAL TO v1 EVERYWHERE, AND THAT IS CORRECT. v1 decided
// with a regex over raw text, so it also matched inside comments and verbatim
// blocks. v2 asks the tokenizer, which does not. Measured 2026-09-15
// (_work\_s5c2_probe_atletter.mjs) over every .sty/.cls in both corpora:
//   narrow (the 3 courses the checkpoint 4 diff covers)  26 files, 0 disagreements
//   wide   (the full corpus)                            389 files, 4 disagreements
// All four wide cases are a \makeatletter sitting in a comment or a verbatim
// region, where v2 is right and v1 was wrong. None is in the diff corpus, so
// byte-neutrality holds where it is measured. Recorded as diff class 5:
// watched, explained, not expected.

// The leading declaration carries a trailing SPACE, never a newline, so every
// reported line number still matches the file the author sees.
const LEAD = "\\makeatletter ";

// .sty and .cls ONLY. In a .tex document \makeatletter is meaningful as
// written and must not be touched.
const isStyleFile = (file) => /\.(sty|cls)$/i.test(String(file || ""));

// EXPORTED since session 16 (PLAN-4 §4, option A): package-options blanks
// these same markers inside the handler text it SPLICES, by THIS rule — one
// predicate and one replacement, defined here and imported there, never
// written a second time. at-letter's own behaviour is unchanged (its suite
// pins byte-identity with v1).
export const isMarker = (t) =>
  t.kind === "ControlWord" && (t.name === "makeatletter" || t.name === "makeatother");

// Blanked to spaces of the SAME LENGTH rather than deleted, so every offset
// and line number after it is unchanged. Invariant T1 guarantees
// t.text.length === t.end - t.start; the suite pins it.
export const blankMarker = (t) => " ".repeat(t.end - t.start);

// Does this file actually need the declaration? Only files carrying an
// at-name do. Applying it unconditionally would mark every .sty as changed
// for no reason, which buries the real changes in a review diff (v1's rule,
// kept). v1 asked a regex; v2 asks the token stream, which is the same
// question answered by the tokenizer's catcode profile: under the "style"
// profile @ is a letter, so \c@encoding is one ControlWord named "c@encoding".
export function hasAtName(tokens) {
  for (const t of tokens)
    if (t.kind === "ControlWord" && t.name.includes("@")) return true;
  return false;
}

// createAtLetter() -> the transform object runWalk expects.
// Takes nothing: the decision is a property of the file, and the file is
// handed to onFile.
export function createAtLetter() {
  return {
    name: "at-letter",
    rounds: [1],

    onFile({ tokens, file, emit, decide }) {
      if (!isStyleFile(file) || !hasAtName(tokens)) return;

      emit(decide.prepend({
        by: "at-letter",
        text: LEAD,
        rule: "at-letter/prepend",
        note: "added \\makeatletter at the start: this is a .sty/.cls, where @ is a " +
              "letter throughout, and Pandoc would otherwise split every @-name in two",
      }));

      for (const t of tokens) {
        if (!isMarker(t)) continue;
        // Same-length spaces (blankMarker above): offsets and line numbers
        // after the marker are unchanged.
        emit(decide.rewrite({
          by: "at-letter",
          span: { start: t.start, end: t.end },
          replacement: blankMarker(t),
          rule: "at-letter/marker-blanked",
          note: "blanked an interior \\" + t.name + " — the file is handed to Pandoc " +
                "in at-letter mode throughout, and this would have switched it off mid-file",
        }));
      }
    },
  };
}

export default createAtLetter;
