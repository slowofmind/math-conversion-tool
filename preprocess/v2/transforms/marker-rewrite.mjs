// v2/transforms/marker-rewrite.mjs — Stage 6, session 18 (PLAN-6 §4 C1, §5;
// PLAN-2b §5–§6). THE MARKER SHAPE.
//
// Plain terms: a \def can say "read everything up to \EndMark". Pandoc's
// reader cannot stop at a command — its tokenizer makes a backslash-name a
// CtrlSeq (Text/Pandoc/TeX.hs 27–28) and its delimiter reader admits Symbol
// and Word only (Readers/LaTeX/Macro.hs 152–156) — so it takes the stop sign
// itself as the body, meets the bare #1 that follows as text, and abandons
// the whole package from that line to \endinput. 136 narrow documents, 385
// wide, every one of them Intro Sequence.
//
// v1 deleted the line. This rewrites the stop sign instead, at the definition
// AND at every use, to a plain-character marker Pandoc accepts — and refuses
// the WHOLE definition, naming the site, when any use cannot be read.
//
// MEASURED BEFORE A LINE WAS WRITTEN (session 18, _work\_s18-engine-probe.txt):
//   * Pandoc 3.11 reads the rewritten package with a COMMAND argument
//     (\firstChar{\vfill}): exit 0, the definition after the line survives.
//     Unrewritten, the same document loses the package. (criterion 1)
//   * pdflatex prints the IDENTICAL text before and after the rewrite, for a
//     text argument, a command argument, and a differently-named terminator.
//     The rewrite changes nothing a compile produces. (criterion A')
//   * A marker containing @ breaks a compile wherever a call site sits
//     outside \makeatletter — runaway argument, exit 1, no PDF. A
//     letters-only marker does not. Hence EndMarkZZ (Nicholas, 2026-09-18).
//
// IT IS NOT ABOUT THE NAME \EndMark. The trigger is the SHAPE — a delimited
// slot whose terminator is a control word — which is what the reader's
// definition/cs-delimiter finding reports. The probe measured the same
// rewrite repairing a definition terminated by \StopHere.
//
// WHY onFile AND NOT COMMAND HOOKS. Measured, not assumed: \@firstchar's one
// real call site is inside \firstChar's body, and the walk never steps into
// a definition body, a \DeclareOption body or an \ifthenelse. A command-hook
// build finds the top-level definition and not one use — session 18 ran that
// version first and kept its output in _work\_s18-fixture-before.txt.
import { readDefinition, readArguments, isDefinitionForm } from "../definition.mjs";

// Letters only: no @, so no catcode hazard wherever a call site sits.
export const DEFAULT_MARKER = "EndMarkZZ";

// Which definitions are ours, and which we refuse. A delimited slot whose
// terminator is a CHARACTER (the FENCED shape, \def\@caption#1[#2]#3) is
// left alone: Pandoc reads it, measured at checkpoint 2b. A terminator that
// is exactly ONE control word is the MARKER shape and is rewritable.
// Anything longer — a terminator of SEVERAL tokens — cannot be rewritten
// exactly, so we refuse it by name and never guess (PLAN-2b §5).
//
// WHAT THIS DOES NOT SEE, measured in session 18c and corrected here. This
// looks only at DELIMITED slots — an argument (#n) whose end is marked. A
// definition whose parameter text is a bare LITERAL, with no argument at
// all, never enters the loop and so is passed over in SILENCE. The real
// case is logicpuzzle.sty:67, \gdef\LP@fontsize\Large% — a missing pair of
// braces, which the reader correctly types as "literal" and which this
// function therefore returns null for. Four files in the wide corpus.
// An earlier version of this comment claimed that line was refused by name.
// It is not. Not rewriting it is RIGHT: there is no argument to re-end, and
// touching \Large would change what a compile prints, which criterion A'
// forbids. Saying nothing is wrong, because the policy is flag, don't fail.
// Scheduled: a flag-only branch, no rewrite, so no text moves and no gate
// can shift. It belongs with the other AUTHOR-ERROR findings and its
// destination is the preflight surface, where the author fixes the source
// (Nicholas, 2026-09-19: "it is something that will ultimately be in the
// same category as other items that include author error and be dealt with
// as a preflight item for an author to address").
export function terminatorOf(def) {
  const params = (def && def.params) || [];
  for (let s = 0; s < params.length; s++) {
    const slot = params[s];
    if (slot.type !== "delimited" || !Array.isArray(slot.terminator) || !slot.terminator.length) continue;
    if (!slot.terminator.some((t) => t.kind === "ControlWord")) continue;
    if (slot.terminator.length === 1) return { ok: true, tokens: slot.terminator, slotIndex: s };
    return { ok: false, tokens: slot.terminator, slotIndex: s, reason:
      "its terminator is more than one token (" + slot.terminator.map((t) => t.text).join("") +
      "), so where the author meant the argument to end cannot be known" };
  }
  return null;
}

// TeX absorbs a space after a control word, so a space costs nothing — and
// without one, \vfill followed by a letters-only marker would fuse into the
// single control word \vfillEndMarkZZ. Session 18, from the engine probe.
export const needsSpaceBefore = (prev) => !!prev && prev.kind === "ControlWord";

const lineOf = (tokens, k) => {
  let n = 1;
  for (let i = 0; i < k && i < tokens.length; i++) if (tokens[i].kind === "Newline") n++;
  return n;
};
const at = (file, tokens, k) => file + ":" + lineOf(tokens, k);

// ROUND 1 records; ROUND 2 acts. The chain is only complete once every file
// has been seen, and a rewrite must never land in file 1 for a definition
// whose use in file 3 turns out to be unreadable — refuse whole, never half.
export function createMarkerRewrite({ marker = DEFAULT_MARKER } = {}) {
  const BAG = "marker-rewrite";
  const bagOf = (decisions) => {
    let b = decisions.get(BAG);
    if (!b) { b = { files: [], defs: new Map(), collisions: [], planned: false,
                    edits: new Map(), refusals: [] }; decisions.set(BAG, b); }
    return b;
  };

  // ---- round 1: this file's collisions and its definitions ---------------
  const scan = (b, file, tokens) => {
    b.files.push({ file, tokens });
    // THE COLLISION SCAN LOOKS AT THE FILE, NOT AT SINGLE TOKENS. The
    // tokenizer emits letters one at a time — measured by this rule's own
    // suite, where blah reads as b + lah — so no token's text ever holds a
    // multi-letter marker. Gate T guarantees the token texts rejoin to the
    // file byte for byte, so this is the file as the author wrote it,
    // comments and verbatim included. Session 18: the first version asked
    // each token and found nothing, and the E6b fixture caught it.
    if (tokens.map((t) => t.text).join("").includes(marker)) b.collisions.push({ file });
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind !== "ControlWord" || !isDefinitionForm(t.name)) continue;
      const d = readDefinition(tokens, i);
      if (!d || !d.def) continue;
      const term = terminatorOf(d.def);
      if (!term) continue;                                   // not the marker shape
      const nameTok = tokens[i + 1];
      const name = d.def.name || (nameTok && nameTok.name) || null;
      if (!name) continue;
      let termIndex = -1;
      for (let k = i; k <= d.close && k < tokens.length; k++)
        if (tokens[k] === term.tokens[0]) { termIndex = k; break; }
      const recs = b.defs.get(name) || [];
      recs.push({ name, file, tokens, nameIndex: i + 1, termIndex, term,
                  params: d.def.params, site: at(file, tokens, i) });
      b.defs.set(name, recs);
    }
  };

  // ---- the plan, built once when round 2 opens ---------------------------
  const plan = (b) => {
    b.planned = true;
    for (const [name, recs] of b.defs) {
      const home = recs[0], cs = "\\" + name;
      const span = { start: home.term.tokens[0].start,
                     end: home.term.tokens[home.term.tokens.length - 1].end };
      const refuse = (level, message) => b.refusals.push({ file: home.file, span, level, message });

      if (recs.length > 1) {                                  // the store's ceiling, G2
        refuse("undecidable", "left " + cs + " alone: the chain defines it more than once (" +
          recs.map((r) => r.site).join(", ") + "), so which meaning a use carries cannot be " +
          "known here — the tool declines rather than rewrite the wrong one");
        continue;
      }
      if (!home.term.ok) {
        refuse("author-error", "left " + cs + " alone at " + home.site + ": " + home.term.reason +
          " — Pandoc will still abandon this file from here, and a guess would be worse");
        continue;
      }
      if (b.collisions.length) {
        refuse("undecidable", "left " + cs + " alone: the marker " + marker + " already occurs in " +
          b.collisions.map((c) => c.file).join(", ") + ", so rewriting the stop sign to it could " +
          "end an argument in the wrong place");
        continue;
      }

      const len = home.term.tokens.length;
      const mk = (file, tokens, ti) => ({ file, start: tokens[ti].start, end: tokens[ti + len - 1].end,
        was: tokens[ti].text, site: at(file, tokens, ti),
        replacement: (needsSpaceBefore(tokens[ti - 1]) ? " " : "") + marker });
      const list = [mk(home.file, home.tokens, home.termIndex)];
      let bad = null;

      // Every use, in every file of the chain, wherever it sits — the whole
      // token array, so a use inside a body or a \DeclareOption is found.
      // readArguments reads it by the definition's own Slot list; a site it
      // refuses refuses the definition.
      for (const f of b.files) {
        for (let k = 0; k < f.tokens.length && !bad; k++) {
          const t = f.tokens[k];
          if (t.kind !== "ControlWord" || t.name !== name) continue;
          if (f.file === home.file && k === home.nameIndex) continue;   // the definition's own name
          const r = readArguments(f.tokens, k + 1, home.params);
          if (!r) { bad = at(f.file, f.tokens, k); break; }
          const a = r.args[home.term.slotIndex];
          if (!a) { bad = at(f.file, f.tokens, k); break; }
          list.push(mk(f.file, f.tokens, Math.max(a.open, a.close + 1)));
          k = r.next - 1;                                     // never read inside a span twice
        }
        if (bad) break;
      }
      if (bad) {
        refuse("author-error", "left " + cs + " alone: the use at " + bad + " cannot be read — " +
          "no " + home.term.tokens[0].text + " closes it. Rewriting the definition without that " +
          "use would leave the two disagreeing, so neither is touched");
        continue;
      }
      for (const e of list) {
        const seen = b.edits.get(e.file) || [];
        if (seen.some((x) => x.start === e.start)) continue;
        seen.push(e); b.edits.set(e.file, seen);
      }
    }
  };

  return {
    name: "marker-rewrite",
    rounds: [1, 2],

    onFile({ tokens, file, decide, decisions, round, emit }) {
      const b = bagOf(decisions);
      if (round === 1) { scan(b, file, tokens); return; }
      if (!b.planned) plan(b);

      for (const e of b.edits.get(file) || [])
        emit(decide.rewrite({
          by: "marker-rewrite",
          span: { start: e.start, end: e.end },
          replacement: e.replacement,
          rule: "marker-rewrite/terminator",
          note: "rewrote the stop sign " + e.was + " to the plain marker " + marker + " at " +
                e.site + ": Pandoc's reader cannot end an argument at a command, and would " +
                "otherwise abandon the rest of this file from here. What a compile produces " +
                "is unchanged (measured, session 18).",
        }));

      for (const r of b.refusals)
        if (r.file === file)
          emit(decide.flag({ by: "marker-rewrite", rule: "marker-rewrite/refused",
                             level: r.level, message: r.message, span: r.span, file }));
    },
  };
}

export default createMarkerRewrite;
