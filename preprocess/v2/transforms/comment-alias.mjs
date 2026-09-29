// v2/transforms/comment-alias.mjs — REWRITE (DESIGN-V2 §4.5; PLAN-3 §4, §12 B1–B5, S1).
//
// Plain terms: handout.sty hides an environment by making it a second name
// for `comment`: \let\solution=\comment and \let\endsolution=\endcomment.
// Real LaTeX then drops everything between \begin{solution} and
// \end{solution}. Pandoc does not honour the alias — its comment handler is
// locked to the literal word `comment` (Readers/LaTeX.hs, pinned at
// checkpoint 2b) — so THE ANSWERS APPEAR IN THE STUDENT HANDOUT and nothing
// looks broken. This is the content-ADDING failure, the worst class in the
// project. The rule rewrites each \begin{X} of a hidden name to
// \begin{comment} and each \end{X} to \end{comment} in document files, so
// Pandoc's own handler drops the body exactly as LaTeX would. Nothing is
// deleted by us: the content stays in the file, on the changed channel.
//
// WHAT IT READS, AND FROM WHERE (choice S1(a)). `hidden` is the reader's
// FINISHED answer for this chain — summary.hiddenEnvironments — every name
// whose definition resolves through \let chains to a hiding environment,
// with the option handlers already applied (last definition wins: under
// [sols] the handler has taken `solution` OUT and put `problemonly` IN, and
// the reader already applied that). `isPackageFile` says which files the
// reader opened as packages; the rule never edits those (the 71 / 276 .sty
// sites are all inside definition bodies, not usages) and never tests an
// extension — the known trap says that test is wrong in both directions.
// Both are PASSED IN by the caller, who owns the document. One round, not
// two: v1 collected the aliases in round one and deleted in round two; here
// the reader has already collected, so `decisions` is not used at all.
//
// THE MOVE — REWRITE, each marker on its own (B1(a)). Two actions per site:
// the \begin{X} span → the literal "\begin{comment}", the \end{X} span → the
// literal "\end{comment}" — no spacing, no star, because Pandoc matches the
// literal token. No matching of begin to end: an unmatched \begin (0 in the
// corpus) becomes Pandoc's problem as it would be LaTeX's, and a hidden env
// nested in a hidden env (0 in the corpus) ends early at the inner
// \end{comment}; the reader already reports unbalanced groups on pass one.
// Not REMOVE (v1's move): deleting content is the one move a faculty member
// cannot audit from the output. Not FLAG alone: the answers would stay in.
//
// HOOKS ON `begin` AND `end`, RETURNING NULL (B2(a)). walkDefinitions fires
// a command hook BEFORE its own handling of \begin / \end; when the hook
// returns nothing the walk carries on and tracks the environment group in
// its scratch store as usual. So the rule sees every document-side site
// (measured: a `begin` hook is blind only inside .sty definition bodies,
// exactly the region it must not touch) at no cost to group tracking.
//
// THE NAME is read exactly as the engine's own group tracker reads it —
// groupText of the brace group, untrimmed. \begin{ solution} is a LaTeX
// error (the space is part of the \csname), not a hidden block; trimming
// would hide what LaTeX refuses. The reader's `define environment` rows
// trim for display only.
//
// D2 (B3(a)). Text left on the same line after \end{X} — one site in the
// corpus, a \vfill at Math Mb workshop\Workshop 6.tex:428 — is what LaTeX's
// verbatim.sty DROPS with the warning "Characters dropped after \end{X}"
// (tools/verbatim.sty 166–180; every handout.sty loads verbatim, not
// comment.sty). Pandoc keeps it. The rule FLAGs it at author-error, quoting
// the text, and removes nothing. Blanks and a % comment after \end{X} are
// not text and are not flagged.
//
// NOT DONE HERE, BY DECISION. The wrapper hazard (B4(a)): handout.sty:402
// defines `objectives` as \begin{problemonly}…\end{problemonly}; the reader
// follows \let chains only, so `objectives` is not in the hidden set and
// \begin{objectives} is NOT rewritten (pinned). Defined in 71 / 108 chains,
// used in zero document files; its handling is expansion at the use site,
// Stage 6. Mid-document re-definition of a hidden name (B5): measured at
// zero on both corpora in session 11, so the end-state set is read as is.
import { readGroup } from "../structure.mjs";
import { groupText } from "../definition.mjs";

export const BEGIN_COMMENT = "\\begin{comment}";
export const END_COMMENT = "\\end{comment}";

// createCommentAlias({ hidden, isPackageFile })
//   hidden         the reader's summary.hiddenEnvironments for THIS chain —
//                  an array or Set of environment names. PASSED IN.
//   isPackageFile  (file) -> boolean: did the reader open this file as a
//                  package? Those files are never edited. PASSED IN.
export function createCommentAlias({ hidden, isPackageFile } = {}) {
  if (!Array.isArray(hidden) && !(hidden instanceof Set))
    throw new Error("comment-alias: needs `hidden`, the reader's summary.hiddenEnvironments for this " +
                    "chain (an array or Set of environment names) — the caller owns the document");
  if (typeof isPackageFile !== "function")
    throw new Error("comment-alias: needs `isPackageFile`, a function (file) -> boolean saying which " +
                    "files the reader opened as packages — never an extension test");
  const names = new Set(hidden);
  const skipFile = (file) => !!isPackageFile(file);

  // The hidden name at a \begin / \end token, or null: the brace group read
  // exactly as walkDefinitions reads it before opening or closing the frame.
  const hiddenAt = (tokens, i) => {
    const g = readGroup(tokens, i + 1);
    if (!g) return null;
    const name = groupText(tokens, g);
    return names.has(name) ? { name, g } : null;
  };

  const rewrite = (ctx, which, hit) => {
    const { tokens, i, emit, decide } = ctx;
    emit(decide.rewrite({
      by: "comment-alias",
      span: { start: tokens[i].start, end: hit.g.end },
      replacement: which === "begin" ? BEGIN_COMMENT : END_COMMENT,
      rule: "comment-alias/" + which,
      kind: "literal",
      note: "\\" + which + "{" + hit.name + "} -> \\" + which + "{comment}: `" + hit.name +
            "` is a second name for `comment` in this chain, which Pandoc does not follow — " +
            "its comment handler only recognises the literal name",
    }));
  };

  // D2: the first non-blank token after \end{X} on the same line, if any,
  // and the text from there to the end of the line.
  const trailing = (tokens, from) => {
    let j = from;
    while (j < tokens.length && tokens[j].kind === "Space") j++;
    const first = tokens[j];
    if (!first || first.kind === "Newline" || first.kind === "Comment") return null;
    let k = j;
    while (k < tokens.length && tokens[k].kind !== "Newline" && tokens[k].kind !== "Comment") k++;
    const last = tokens[k - 1];
    return { start: first.start, end: last.end, text: tokens.slice(j, k).map((t) => t.text).join("") };
  };

  return {
    name: "comment-alias",
    rounds: [1],

    commands: {
      begin(ctx) {
        const { tokens, i, file } = ctx;
        if (skipFile(file)) return null;
        const hit = hiddenAt(tokens, i);
        if (hit) rewrite(ctx, "begin", hit);
        return null;                                   // B2(a): the walk tracks the group itself
      },
      end(ctx) {
        const { tokens, i, file, emit, decide } = ctx;
        if (skipFile(file)) return null;
        const hit = hiddenAt(tokens, i);
        if (!hit) return null;
        rewrite(ctx, "end", hit);
        const tail = trailing(tokens, hit.g.close + 1);
        if (tail) {
          emit(decide.flag({
            by: "comment-alias",
            rule: "comment-alias/text-after-end",
            level: "author-error",
            span: { start: tail.start, end: tail.end },
            message: "Text follows \\end{" + hit.name + "} on the same line: " + JSON.stringify(tail.text.trim()) +
                     ". LaTeX's verbatim.sty drops it with the warning \"Characters dropped after " +
                     "\\end{" + hit.name + "}\"; Pandoc keeps it. Nothing was removed — move it to its own line.",
            detail: { environment: hit.name, text: tail.text },
          }));
        }
        return null;                                   // B2(a)
      },
    },
  };
}

export default createCommentAlias;
