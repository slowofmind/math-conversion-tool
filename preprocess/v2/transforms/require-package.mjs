// v2/transforms/require-package.mjs — REWRITE (DESIGN-V2 §4.5; HANDOFF §9d).
//
// Plain terms: Pandoc has no handler for \RequirePackage at all, so it
// silently ignores the line and never opens the package. Rewriting it to
// \usepackage — which Pandoc does follow — is what lets the chain be read.
//
// MEASURED (Pandoc 3.11, 2026-09-09; pinned by the suite). Identical setup,
// one word changed:
//     outer.sty: \usepackage{inner}      -> "A: INNERWORKS done."
//     outer.sty: \RequirePackage{inner}  -> "A: done."
// Math Ma's workbook.sty line 51 is \RequirePackage{handout}, so without this
// a workbook document never loads handout at all: \probonly, \solonly, the
// problem/solution switch — none of it exists, whatever options were asked for.
//
// SCOPE, AND WHY IT IS ABOUT THE DIFF AND NOT ABOUT CAPABILITY. Only packages
// that exist as FILES in this project are rewritten. Turning
// \RequirePackage{xstring} into \usepackage{xstring} would send Pandoc hunting
// for a distribution package that is not there — harmless, since it ignores
// what it cannot find, but it is a line that shows up in the change list a
// faculty member reads while doing nothing at all. The test is "will this edit
// have any effect", not "is this package faculty-authored". A vendored CTAN
// copy sitting in a course folder (APMTH 121 has several) is local and IS
// rewritten, correctly, because Pandoc can genuinely open it.
//
// WIDENED FROM v1: .tex TOO. v1 ran on .sty/.cls only. A \RequirePackage in a
// document is legal and v1 left it alone. MEASURED BEFORE THE CHANGE
// (_work\_s5c2_measure_require.mjs, 2026-09-15): across the 269 baseline
// chains — 275 .tex files on disk, 273 distinct — exactly ZERO carry a
// \RequirePackage naming a locally present package. So intended diff change
// #2 is predicted EMPTY, and anything appearing there at checkpoint 4 is a
// defect in this widening, not the intended change arriving. It is kept
// because it closes a real v1 gap for faculty outside this corpus.
//
// JUDGEMENT CALL S5-7 (Nicholas, 2026-09-15): \RequirePackageWithOptions is
// NOT handled, matching v1 exactly, because "load with whatever options I was
// given" is not a clean one-word rewrite and widening it would be a new
// intended change needing its own measurement. DOCKETED — see DESIGN-V2 §10.
//
// WHY onFile AND NOT A COMMAND HOOK — the same lesson at-letter learned the
// hard way. walkDefinitions deliberately jumps \DeclareOption bodies,
// \ifthenelse extents and definition bodies, so a command hook cannot see
// inside them. v1 used unified-latex's `visit`, which saw everything. A
// FILE-LEVEL rewrite must therefore scan in onFile to match. Construct-level
// decisions that SHOULD respect the walk's skipping — stage 6's expander, for
// one — belong in a command hook instead. The two are different jobs.
import { readGroup, readBracket } from "../structure.mjs";
import { groupText } from "../definition.mjs";

// .sty, .cls AND .tex — the widening described above.
const inScope = (file) => /\.(sty|cls|tex)$/i.test(String(file || ""));
const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

// createRequirePackage({ isLocalPackage })
//   isLocalPackage(name) -> boolean. PASSED IN, never looked up privately:
//   lib/evidence.mjs is retired and barred from v2 (Choice C), and the caller
//   is the one that knows the project. classifyFiles() in v2/reader.mjs gives
//   the equivalent from project.support plus each file's packageName.
export function createRequirePackage({ isLocalPackage } = {}) {
  if (typeof isLocalPackage !== "function")
    throw new Error("require-package: needs isLocalPackage(name) — the caller owns the project, " +
                    "and lib/evidence.mjs is retired");

  return {
    name: "require-package",
    rounds: [1],

    onFile({ tokens, file, emit, decide }) {
      if (!inScope(file)) return;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== "ControlWord" || t.name !== "RequirePackage") continue;

        // Read it the way v2/reader.mjs reads a load statement: the optional
        // [..], then the {..}, then the comma list.
        const o = readBracket(tokens, i + 1);
        const g = readGroup(tokens, o ? o.close + 1 : i + 1);
        if (!g) continue;                       // unreadable; leave it alone
        i = g.close;                            // never re-enter this statement

        const named = splitList(groupText(tokens, g));
        const local = named.filter((n) => isLocalPackage(n));
        if (!local.length) continue;            // nothing here for Pandoc to open

        // Only the command WORD is replaced. Options and braces are left
        // exactly as the author wrote them (v1's behaviour, kept), which is
        // what keeps the change list short and readable.
        emit(decide.rewrite({
          by: "require-package",
          span: { start: t.start, end: t.end },
          replacement: "\\usepackage",
          rule: "require-package/rewritten",
          note: "\\RequirePackage -> \\usepackage for " + local.join(", ") +
                " — Pandoc has no \\RequirePackage handler and would silently drop the " +
                "whole package, losing every definition in it",
        }));
      }
    },
  };
}

export default createRequirePackage;
