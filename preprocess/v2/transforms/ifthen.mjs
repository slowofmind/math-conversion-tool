// v2/transforms/ifthen.mjs — THE FOLD (Stage 6, session 22).
//
// Plain terms: a course file asks a question — "are we printing solutions?" —
// and shows one of two blocks depending on the answer. Pandoc has no handler
// for \ifthenelse, so it drops the command together with ALL THREE of its
// arguments and both blocks are destroyed. This rule answers the question
// where it can, keeps the block that wins, and deletes the rest of the
// construct. Where it cannot answer, it keeps the ELSE branch — which is what
// LaTeX itself does when a flag was never set — and REPORTS the site.
//
// THE BAR IS WHAT A COMPILE WOULD PRINT, not what any earlier tool did:
// "the goal is for the preprocessor to emit the same result that would occur
// when compiling latex to PDF" (Nicholas, 2026-09-19).
//
// THREE-VALUED ON PURPOSE. True, false, and NOT KNOWABLE HERE are three
// different answers, and the third is a normal outcome rather than a failure.
//
// WHY onFile AND NOT COMMAND HOOKS. Command hooks fire at walk level only and
// never step inside a definition body, a \DeclareOption body or another
// \ifthenelse. MEASURED (session 19): only 195 of 4,478 sites — 4.4% — sit at
// walk level, so a command-hook build would miss 19 sites in 20.
//
// WHY THE TEST IS EVALUATED ON TEXT. ifthen uses \( and \) as ordinary
// grouping parentheses, and any math-aware parser reads those as inline math.
// lib/ifthen-eval.mjs works on raw text for exactly that reason and is kept.
//
// THE ONE THING THAT EVALUATOR CANNOT SEE, and this rule must (measured,
// session 22, _work\_s22-param-tests.txt): a test mentioning #1 is compared
// as LITERAL TEXT, so \equal{#1}{nocite} finds the characters "#1" different
// from "nocite" and \not turns that into a confident TRUE. 22 sites in 19
// files were getting such an answer. But #1 is a placeholder whose value does
// not exist until the macro is CALLED — \psreflection{...} and
// \psreflection[nocite]{...} genuinely take different branches, and both
// calls are real. So a test that mentions a parameter is UNKNOWN here, and is
// reported on its own rule line: those sites are not a defect in this rule,
// they are the work the expander finishes, where #1 finally has a value.
import { readArguments } from "../definition.mjs";
import { evalTest } from "../../lib/ifthen-eval.mjs";

// \ifthenelse{test}{then}{else}: three MANDATORY arguments, read as TeX reads
// them. readArguments already implements the rule that an unbraced mandatory
// argument is exactly ONE token — which is what stops a group that merely
// FOLLOWS the construct from being swallowed as the else branch.
const THREE = Object.freeze([{ type: "mandatory" }, { type: "mandatory" }, { type: "mandatory" }]);

// An argument's CONTENT: inside the braces when it is a group, the token
// itself when it is bare. Returned as a half-open-ish inclusive pair; an
// empty group gives from > to, which every caller reads as "nothing".
const innerRange = (a) => (a.braced ? [a.open + 1, a.close - 1] : [a.open, a.close]);

// Token texts rejoin to the source byte for byte — that is what gate T
// guarantees — so this is the author's own text, comments and all.
const textOf = (tokens, from, to) => {
  let s = "";
  for (let k = from; k <= to && k < tokens.length; k++) s += tokens[k].text;
  return s;
};

// Does this test depend on an argument that has not been supplied yet? The
// tokenizer emits a parameter reference as its own token; the text check is
// a second pair of eyes, because reading a test as literal when it is not is
// the one failure mode that produces a CONFIDENT WRONG ANSWER rather than an
// unknown, and it is cheap to be careful here.
function mentionsParameter(tokens, from, to) {
  for (let k = from; k <= to && k < tokens.length; k++)
    if (tokens[k].kind === "Parameter" || tokens[k].text === "#") return true;
  return textOf(tokens, from, to).includes("#");
}

const lineOf = (tokens, k) => {
  let n = 1;
  for (let i = 0; i < k && i < tokens.length; i++) if (tokens[i].kind === "Newline") n++;
  return n;
};
const tidy = (s) => s.replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

// The three-valued state that the fold and the SEAM both decide from. Lifted
// out of the factory at session 24 and exported, because the seam in
// reader.mjs must decide with exactly this: if the two ever disagreed about
// which branch won, the text Pandoc receives and the notebook the later rules
// read would describe different documents. v2/test/ifthen.mjs B6 is the
// fixture that catches it. A Map and a plain object are both accepted.
export function ifThenState(flags = {}) {
  const get = (name) => (flags instanceof Map ? flags.get(name) : flags[name]);
  const held = (name) => (flags instanceof Map ? flags.has(name) : Object.prototype.hasOwnProperty.call(flags, name));
  return {
    // A flag nobody declared, and a flag the reader marked as run-time state,
    // are both UNKNOWN. Only a SETTLED value is allowed to decide a branch.
    value: (name) => {
      if (!held(name)) return "U";
      const v = get(name);
      return v === "unknown" || v === null || v === undefined ? "U" : (v ? "T" : "F");
    },
    // Left always-unknown deliberately. Letting the store answer \isundefined
    // has a loop in it — at those sites the name is only ever defined inside
    // the very conditional that asks about it — so it is its own decision.
    defined: () => undefined,
    expand: (t) => ({ text: t, residual: /\\[a-zA-Z@]/.test(t) }),
  };
}

// The verdict for ONE site, and WHY, so the report can separate the two
// kinds of unknown. parameter-dependent unknowns are the expander's queue.
function decideTest(tokens, from, to, state) {
  const test = from > to ? "" : textOf(tokens, from, to);
  if (from <= to && mentionsParameter(tokens, from, to))
    return { value: "U", why: "parameter", test };
  let v = "U";
  try { v = evalTest(test, state); } catch { v = "U"; }
  return { value: v, why: v === "U" ? "test" : null, test };
}

// ONE \ifthenelse at index i, decided: which branch survives and where it is.
// The fold folds `keep` into the text; the seam walks `keep` into the store.
// Both go through readArguments and THREE, so E12's rule — an unbraced
// mandatory argument is exactly ONE token — is applied once, not twice.
// UNKNOWN keeps the ELSE branch: LaTeX's own behaviour for an unset flag, and
// the fold's policy (PLAN-6 §4A). `keep` is null when the winning branch is
// empty. Returns null when the site is malformed — flag, don't fail.
export function chooseBranch(tokens, i, state) {
  const r = readArguments(tokens, i + 1, THREE);
  if (!r || !r.args || r.args.length < 3 || !r.args[2]) return null;
  const [tf, tt] = innerRange(r.args[0]);
  const v = decideTest(tokens, tf, tt, state);
  const keep = innerRange(r.args[v.value === "T" ? 1 : 2]);
  return { value: v.value, why: v.why, test: v.test, close: r.args[2].close,
           keep: keep[0] > keep[1] ? null : keep };
}

export function createIfThen({ flags = {} } = {}) {
  // The reader's finished answers arrive as a factory option, because the
  // shared caller passes state:null to runWalk and the reader's store does
  // not reach a transform.
  const state = ifThenState(flags);

  const verdict = (tokens, r) => {
    const [tf, tt] = innerRange(r.args[0]);
    return decideTest(tokens, tf, tt, state);
  };

  // Fold every conditional inside a token range into TEXT. The branch we keep
  // can itself hold conditionals, and the outer edit span already covers
  // them, so they must be folded INTO the replacement — two overlapping edits
  // would be refused by the edit list, and rightly.
  const foldRange = (tokens, from, to, report) => {
    let out = "", k = from;
    while (k <= to && k < tokens.length) {
      const t = tokens[k];
      if (t.kind === "ControlWord" && t.name === "ifthenelse") {
        const r = readArguments(tokens, k + 1, THREE);
        if (r && r.args[2] && r.args[2].close <= to) {
          const v = verdict(tokens, r);
          report(v, k, r);
          const [bf, bt] = innerRange(v.value === "T" ? r.args[1] : r.args[2]);
          out += bf > bt ? "" : foldRange(tokens, bf, bt, report);
          k = r.args[2].close + 1;
          continue;
        }
        report({ value: "X", why: "malformed", test: "" }, k, null);
      }
      out += t.text;
      k++;
    }
    return out;
  };

  return {
    name: "ifthen",
    rounds: [1],

    onFile({ tokens, file, decide, emit }) {
      // THE WHOLE TOKEN ARRAY — inside definition bodies, \DeclareOption
      // bodies and other conditionals, which is where 95.6% of sites live.
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== "ControlWord" || t.name !== "ifthenelse") continue;

        const r = readArguments(tokens, i + 1, THREE);
        if (!r || !r.args[2]) {
          // Flag, don't fail. The text is left exactly as written.
          emit(decide.flag({
            by: "ifthen", rule: "ifthen/malformed", level: "author-error",
            span: { start: t.start, end: t.end }, file,
            message: "\\ifthenelse at " + file + ":" + lineOf(tokens, i) + " does not have " +
              "three arguments that can be read, so the tool left it alone rather than guess " +
              "where the branches end. Pandoc will drop it with whatever it does have.",
            detail: { line: lineOf(tokens, i) },
          }));
          continue;
        }

        // Unknowns are reported for the SITE and for every nested site folded
        // into the same replacement, so nothing is silently guessed at.
        const unknowns = [];
        const report = (v, at, rr) => {
          if (v.value === "T" || v.value === "F") return;
          unknowns.push({ v, at, rr });
        };

        const v = verdict(tokens, r);
        report(v, i, r);
        const [bf, bt] = innerRange(v.value === "T" ? r.args[1] : r.args[2]);
        const replacement = bf > bt ? "" : foldRange(tokens, bf, bt, report);
        const span = { start: t.start, end: r.args[2].end };
        const kept = v.value === "T" ? "then" : "else";
        const why = v.value === "T" ? "the condition is true"
          : v.value === "F" ? "the condition is false"
          : "the condition cannot be settled here";

        if (replacement === "") {
          // An empty winning branch is a DELETION, and a deletion is always
          // reported on its own channel — decide.rewrite refuses "" for
          // exactly this reason.
          emit(decide.remove({
            by: "ifthen", rule: "ifthen/folded-empty", span, file,
            message: "removed a conditional at " + file + ":" + lineOf(tokens, i) +
              " because " + why + " and the " + kept + " branch it selects is empty. " +
              "Pandoc has no handler for \\ifthenelse and would have dropped this " +
              "command together with both branches.",
            detail: { line: lineOf(tokens, i), kept, test: clip(tidy(v.test), 120) },
          }));
        } else {
          emit(decide.rewrite({
            by: "ifthen", rule: "ifthen/folded", span, replacement, file,
            note: "kept the " + kept + " branch of the conditional at " + file + ":" +
              lineOf(tokens, i) + " because " + why + ". Pandoc has no handler for " +
              "\\ifthenelse and drops the command WITH all three arguments, so both " +
              "branches would otherwise have been destroyed.",
          }));
        }

        for (const u of unknowns) {
          const line = lineOf(tokens, u.at);
          if (u.v.why === "malformed") {
            emit(decide.flag({
              by: "ifthen", rule: "ifthen/malformed", level: "author-error",
              span: { start: tokens[u.at].start, end: tokens[u.at].end }, file,
              message: "a nested \\ifthenelse at " + file + ":" + line + " could not be " +
                "read, so it was carried through unchanged inside the branch that was kept.",
              detail: { line },
            }));
            continue;
          }
          const param = u.v.why === "parameter";
          emit(decide.flag({
            by: "ifthen",
            // TWO RULES, DELIBERATELY. A flag-derived unknown may become
            // knowable once the reader settles more of the chain. A
            // parameter-derived one never will — it needs the value supplied
            // at the CALL, which is the expander's job. Counting them apart
            // is what makes that queue visible.
            rule: param ? "ifthen/unknown-parameter" : "ifthen/unknown",
            level: "undecidable",
            span: { start: tokens[u.at].start, end: tokens[u.at].end }, file,
            message: param
              ? "the condition at " + file + ":" + line + " depends on an argument (" +
                clip(tidy(u.v.test), 90) + "), whose value does not exist until the " +
                "surrounding command is called, so it cannot be settled here. The ELSE " +
                "branch was kept, as LaTeX does when a flag is not set — check whether " +
                "that is right for this document."
              : "the condition at " + file + ":" + line + " (" + clip(tidy(u.v.test), 90) +
                ") could not be settled, so the ELSE branch was kept, as LaTeX does when " +
                "a flag is not set — check whether that is right for this document.",
            detail: { line, test: clip(tidy(u.v.test), 200), kind: param ? "parameter" : "test" },
          }));
        }

        i = r.args[2].close;   // never read inside a span twice
      }
    },
  };
}

export default createIfThen;
