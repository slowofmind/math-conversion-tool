// v2/transforms/package-options.mjs — REWRITE (DESIGN-V2 §4.5; PLAN-3 §3, §12).
//
// Plain terms: a course package like handout.sty says "if the document asks
// for `sols`, do these things" with \DeclareOption{sols}{...}, and "now run
// whichever of those were asked for" with \ProcessOptions at the very end of
// the file. Pandoc throws every \DeclareOption block away, so the package
// always behaves as if no option was given: a solutions document comes out as
// a problems document. This rule copies the bodies of the handlers the
// document ACTUALLY switched on to the \ProcessOptions line, so Pandoc sees
// their effect at the moment LaTeX would have run them.
//
// THE ONE FACT THIS RULE IS BUILT AROUND (measured, session 9; PLAN-3 §2).
// "Which handlers ran" and "which options the document finally requested" are
// NOT the same list. In 4 narrow / 72 wide documents the option arrived AFTER
// the package had already been read (reader/option-clash, forward-after-load),
// so the reader ran NO handler while the final requested set says [sols]. A
// transform reading the final set would splice the SOLUTIONS handler into a
// PROBLEMS document. So this rule reads what RAN, at the \ProcessOptions
// moment, from the reader's row for that file — and never summary.options.
// v1 read the final set (evidence.optionsFor) and is predicted to have that
// defect in exactly Math Ma main.tex, main-hw.tex, main-workshop.tex and
// Math Mb main.tex: diff class 5 at checkpoint 4, exactly four documents.
//
// WHAT IT READS, AND FROM WHERE. handlersRan is a Map from file path to the
// ORDERED handler names the reader ran there, built by the CALLER from the
// reader's \ProcessOptions rows (their `selected` field, choice A1(b)). The
// bodies come from the walk's own `skipped` rows for the file being walked:
// walkDefinitions steps over every \DeclareOption{name}{body} and records
// { kind, option, open, close, start, end } — the same engine, on the same
// tokens, that the reader's hook read them from, so the indices are the same.
// The predicate "is this file a package in this chain" is therefore the
// caller's (choice S1(a)); this file never tests an extension — the known
// trap says that test is wrong in both directions.
//
// THE MOVE. A zero-width REWRITE at the \ProcessOptions token's start (choice
// A2(a)): v1's banner, then the bodies in DECLARATION order joined by "\n",
// then "\n" — byte for byte v1's text, so the checkpoint-4 differ stays
// readable where both fire. Not PREPEND: offset 0 is before every ordinary
// definition in the file, and handout.sty puts \ProcessOptions on line 404 of
// 405 precisely so the handlers run AFTER those definitions and win. Not
// EXPAND: the text is the author's, verbatim but for the blanked at-letter
// markers (session 16, spliceText below). Only the splice is reported
// (A3(a)); requested / forwarded / defaulted / unmatched stay the reader's rows.
//
// A COMMAND HOOK, NOT onFile. \ProcessOptions sits at the top level of the
// package file — never inside a skipped body on this corpus (114 files) — and
// fires exactly once at exactly one token: the construct-level case that
// checkpoint 2a's rule reserves for hooks. The hook mirrors the reader's:
// the first \ProcessOptions in a file acts, a second one is stepped over, and
// a following `*` is consumed with the token (\ProcessOptions* is left as
// written; the insert goes BEFORE the command).
//
// NOT DONE HERE, BY DECISION. \DeclareOption* fallback bodies are never
// spliced (A5(a)) — their proper handling is expansion, stage 6. A package
// with handlers and no \ProcessOptions gets nothing (A4(a)): no row, no
// splice, one GitHub file, no document loads it.
import { readGroup } from "../structure.mjs";
import { isMarker, blankMarker } from "./at-letter.mjs";

// THE HANDLER BODY AS SPLICED (PLAN-4 §4, option A; session 16). The author's
// text between the braces, token by token, EXCEPT that every \makeatletter /
// \makeatother inside it is blanked by at-letter's own rule — the same
// predicate and the same same-length spaces at-letter applies to the markers
// at their ORIGINAL positions. The spliced copy is text this transform
// composes, so blanking here is its own replacement string, never a second
// edit on the same span. Without it the copy carried a live \makeatother that
// would switch at-letter mode OFF for everything after \ProcessOptions
// (measured at checkpoint 4: 37 narrow outputs, the Math Ma and Math Mb
// handout.sty — harmless there only because \ProcessOptions is the last line;
// v1's text-stage at-letter blanked before the copy was taken, so v1's splice
// had them blanked). definition.mjs's groupText stays "exactly as written":
// right for definitions, wrong for this copy.
const spliceText = (tokens, g) => {
  let s = "";
  for (let k = g.open + 1; k < g.close; k++) s += isMarker(tokens[k]) ? blankMarker(tokens[k]) : tokens[k].text;
  return s;
};

// The reader's `star` helper, mirrored: consume one `*` directly after i.
const star = (tokens, i) =>
  (tokens[i] && tokens[i].kind === "Other" && tokens[i].text === "*" ? i + 1 : i);

// v1's banner, byte for byte (transforms/package-options.mjs, frozen).
export const banner = (names) =>
  "% latex-preprocess: options [" + names.join(", ") +
  "] requested by the document, spliced here from \\DeclareOption\n";

// createPackageOptions({ handlersRan })
//   handlersRan  Map: file path -> [handler names that RAN there, in declaration
//                order], from the reader's \ProcessOptions rows (`selected`).
//                PASSED IN, never derived here: the caller owns the document.
export function createPackageOptions({ handlersRan } = {}) {
  if (!(handlersRan instanceof Map))
    throw new Error("package-options: needs handlersRan, a Map from file path to the ORDERED " +
                    "handler names the reader ran there (the `selected` field of its " +
                    "\\ProcessOptions rows) — never summary.options, never the extension");

  // Files whose first \ProcessOptions has fired, per instance. The reader
  // keeps the same flag (f.processed); a second \ProcessOptions in one file
  // is stepped over by both. No file in the corpus has two.
  const processed = new Set();

  return {
    name: "package-options",
    rounds: [1],

    commands: {
      ProcessOptions(ctx) {
        const { tokens, i, file, skipped, emit, decide } = ctx;
        const t = tokens[i];
        const next = star(tokens, i + 1);
        if (processed.has(file)) return next;
        processed.add(file);

        const ran = handlersRan.get(file);
        if (!Array.isArray(ran) || !ran.length) return next;   // nothing ran here: no splice, no row

        // The bodies, in declaration order, from the walk's own skipped rows
        // for THIS file — exactly as the reader's hook reads them: the name
        // group, then the body group; the body is the text strictly inside.
        const want = new Set(ran);
        const found = [];
        for (const s of skipped) {
          if (s.kind !== "DeclareOption" || s.option === "*" || s.open >= i) continue;
          const name = String(s.option).trim();
          if (!want.has(name)) continue;
          const g1 = readGroup(tokens, s.open + 1);
          const g2 = g1 && readGroup(tokens, g1.close + 1);
          if (!g2) continue;
          found.push({ name, body: spliceText(tokens, g2) });
        }

        // Refuse rather than guess (rule 110): the reader's list and the walk's
        // rows come from one engine on one token array and must agree name for
        // name. If they do not, nothing is spliced and the disagreement is
        // reported — a partial splice would be worse than none.
        if (found.map((f) => f.name).join("\u0000") !== ran.join("\u0000")) {
          emit(decide.flag({
            by: "package-options",
            rule: "package-options/handlers-disagree",
            level: "undecidable",
            span: { start: t.start, end: t.end },
            message: "The reader says handler(s) [" + ran.join(", ") + "] ran for this package, but " +
                     "the walk found [" + found.map((f) => f.name).join(", ") + "] declared before " +
                     "\\ProcessOptions; nothing was spliced.",
            detail: { ran, found: found.map((f) => f.name) },
          }));
          return next;
        }

        // Zero-width insert at the token's start: the banner, the bodies in
        // declaration order, one per line, v1's layout byte for byte. The
        // command itself is left exactly as the author wrote it.
        emit(decide.rewrite({
          by: "package-options",
          span: { start: t.start, end: t.start },
          replacement: banner(ran) + found.map((f) => f.body).join("\n") + "\n",
          rule: "package-options/spliced",
          kind: "literal",
          note: "spliced " + found.length + " option handler(s) at \\ProcessOptions — " + ran.join(", ") +
                " — Pandoc drops every \\DeclareOption block, so without this the package behaves as " +
                "if no option had been given",
        }));
        return next;
      },
    },
  };
}

export default createPackageOptions;
