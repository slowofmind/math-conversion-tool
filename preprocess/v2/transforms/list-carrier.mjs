// v2/transforms/list-carrier.mjs — session 252. List numbers and markers,
// written into the -pp copy in the forms Pandoc keeps (LISTS-PLAN-s249.md
// building step 3; DECISIONS 2026-10-23, Option 1 "numbers plus tags").
//
// Plain terms: Pandoc 3.11 numbers every list from 1 in its own style and
// throws away an item's own marker, so "(c)", a list that carries on from an
// earlier one, or an author's "(x)" come out wrong. The reader already knows
// what LaTeX prints at every \item (list-depth.mjs, list-numbers.mjs). This
// writes it where Pandoc reads it, so a platform filter can show it later:
// - a list: its short form ("(a)", "A.", "1.") as the FIRST option key, and,
//   when it does not start at 1, \setcounter{enumN}{first - 1} straight after
//   its \begin (s249 Part 1.1: Pandoc takes the start only from that line).
//   The author's own keys stay after it, untouched; a label= among them still
//   wins in pdflatex (s249 J1, J2), so the print does not change.
// - every item (session 269; s252 tagged only items with a marker of their
//   own): a tag after it holding the marker the PDF prints, its name saying
//   the kind - \ppmark, \ppmarkown (\item[x]), \ppmarkcalc (\calcitem),
//   \ppmarkcircled (handout.sty's circled answer). See MARK_COLOURS below.
// - the entry, at the top: \PassOptionsToPackage{shortlabels}{enumitem} when
//   a short form was written (pdflatex stops on "(a)" without it, s249 F1),
//   and the tags' definitions: Pandoc's reading, then TeX's through \csname,
//   which Pandoc does not read (s249 F3, B11; s269 Part 3).
//
// The choices, each measured (session 252, _work/_s252-wrap.txt):
// - Only lists Pandoc reads as a list are written: enumerate. Pandoc makes no
//   list at all of enumerate*, of a \newlist list, or of Math Mb's
//   enumeratecols (an enumerate* inside): it keeps the items as paragraphs in
//   a block. No carrier helps there; they are left as they are and reported.
// - A list a list-making environment of the author's opens (\begin{parts} whose
//   definition holds \begin{enumerate}[..]): its options are in the definition,
//   which serves every use, so the definition is not edited and the label is
//   not carried. The counter line goes straight after the author's \begin and
//   its arguments, which is straight after the list's \begin once Pandoc has
//   put the definition in (W5) — only when the definition's begin code ends
//   with that \begin; otherwise the list is left alone. Intro has none
//   (_work/_s252-census.txt): its wrappers are all enumerate*.
// - A list needs nothing when Pandoc's default already says it: a top-level
//   list of 1. 2. 3. that starts at 1. Every other sure list gets its short
//   form, so the AST says the style and punctuation instead of leaving them to
//   a filter's guess by depth.
// - No short form is written without enumitem (the list would take no
//   options), for a label with no short form (W1.), or when the author's first
//   key is already a short form: the same one needs nothing, another one stays
//   (a second short form stops pdflatex, s249 K2). Each is reported.
// - A tag is not written for an \item inside a braced argument (an
//   \ifthenelse branch): what LaTeX runs there is the command's choice, and
//   another fix may rewrite that whole argument. Since session 276 that
//   includes a whole list inside an \ifthenelse (its \begin too): neither its
//   items nor its options are written, and each is reported.
// - The circle: only where the list's own label holds \maybecircle and the
//   document's \solonly prints its argument (its definition at the end of
//   the reading), since only then does LaTeX draw it. These three names are
//   handout.sty's (Math Ma, Mb); nothing about them is general.
// - Lists the reader is not sure of are left as they are and reported, with
//   its reason (finding lists/numbers-unsure).
import { readGroup, readBracket } from "../structure.mjs";
import { splitKeys, SHORT_FORMS } from "../list-numbers.mjs";
import { readArguments } from "../definition.mjs";
const THREE = Object.freeze([{ type: "mandatory" }, { type: "mandatory" }, { type: "mandatory" }]);

export const HEAD = "% Added by the preprocessor so that Pandoc keeps list numbers and markers:\n";
export const PASS = "\\PassOptionsToPackage{shortlabels}{enumitem}\n";
// Session 269 (DECISIONS 2026-10-25, carrier A; LISTS-STEP5-PLAN-s269.md
// Part 3): every item of a carried list gets the marker the PDF prints, in a
// tag whose name says its kind. Pandoc reads the plain \newcommand and keeps
// an inline span coloured with the kind's name, the first thing on the item's
// line; TeX runs the \csname definition, which prints nothing (the flagging
// transform's trick; _work/_s269-carry.txt: no log line, maths kept, print
// unchanged). They replace s252's ppmarker / ppcircled environments.
//   ppmark         a numbered item: "1.", "(c)"
//   ppmarkown      the author's own marker, no number: \item[(x)]; \item[] ""
//   ppmarkcalc     an item that counts but whose marker an author's command
//                  writes (the reader gives it a number AND its own marker;
//                  Intro: \calcitem, "\calculator 3.")
//   ppmarkcircled  the circled correct answer (handout.sty's \circleitem)
export const MARK_COLOURS = { ppmark: "ppmark", ppmarkown: "ppmark-own", ppmarkcalc: "ppmark-calc", ppmarkcircled: "ppmark-circled" };
// TeX's line is written as flagging's is (\expandafter\long\expandafter\def):
// at the top of the entry, before \documentclass, Pandoc stops on the plain
// \expandafter\def form's #1 and skips this one (_work/_s269_defprobe.mjs).
// INTERIM (DECISIONS 2026-10-25, "an alternative definition ... that tells
// Pandoc to drop them"): until the platform has a filter that shows these
// spans, every list would show its marker twice ("c. (c) ..."). So Pandoc's
// line is an empty definition - Pandoc drops each tag and logs nothing
// (_work/_s269-drop.txt V2) - and the span definition stays above it as a
// comment in the -pp copy. To undo: set PANDOC_SEES_MARKS to true here and in
// v2/test/list-carrier-cases.mjs. TeX's line is the same either way.
export const PANDOC_SEES_MARKS = false;
export const markDefinition = (n) => {
  const span = "\\newcommand{\\" + n + "}[1]{\\textcolor{" + MARK_COLOURS[n] + "}{#1}}\n";
  return (PANDOC_SEES_MARKS ? span : "% " + span + "\\newcommand{\\" + n + "}[1]{}\n") +
    "\\expandafter\\long\\expandafter\\def\\csname " + n + "\\endcsname#1{}\n";
};
const mark = (n, x) => "\\" + n + "{" + x + "}";

const blank = (t) => t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment";
const textOf = (toks) => toks.map((t) => t.text).join("");
const groupName = (tokens, g) => textOf(tokens.slice(g.open + 1, g.close)).trim();

// createListCarrier({ lists, store, entry, tokensOf, tagText })
//   lists     the reader's lists ({ items, lists, findings, enumitem })
//   store     the reader's finished store (definitions as they stand at the end)
//   entry     the document; the preamble lines go at its top
//   tokensOf  file -> its tokens (the same arrays the walk is handed)
//   tagText   text -> text with flagged commands tagged (v2/transforms/
//             flagging.mjs, session 257); default leaves the text as it is
export function createListCarrier({ lists, store, entry, tokensOf, tagText = (x) => x }) {
  const BY = "list-carrier";
  const enumitem = (lists && lists.enumitem) || {};
  const canShort = !!enumitem.loaded && !enumitem.loadonly;
  let plan = null;

  const indexes = new Map();
  const indexOf = (file, start) => {
    if (!indexes.has(file)) {
      const m = new Map(), toks = tokensOf(file) || [];
      toks.forEach((t, k) => m.set(t.start, k));
      indexes.set(file, m);
    }
    return indexes.get(file).get(start);
  };
  const solonlyPrints = () => {
    const rec = store && store.resolve("solonly").record;
    return !!(rec && rec.kind === "macro" && Array.isArray(rec.body) && textOf(rec.body).trim() === "#1");
  };

  function build() {
    const p = { byFile: new Map(), pass: false, names: new Set() };
    const add = (file, a) => { if (!p.byFile.has(file)) p.byFile.set(file, []); p.byFile.get(file).push(a); };
    const flag = (file, span, rule, level, message, detail) => add(file, { flag: { rule, level, message, span, detail: detail || {} } });
    // an edit from token a to token b: the author's text there, then `after`
    const rewrite = (file, tokens, a, b, after, rule, note) =>
      add(file, { rewrite: { span: { start: tokens[a].start, end: tokens[b].end }, replacement: textOf(tokens.slice(a, b + 1)) + after, rule, note } });
    const options = new Map();          // list id -> its own option tokens (direct lists)

    for (const L of lists.lists) {
      if (!L.numbered) continue;
      const tokens = tokensOf(L.file), i = tokens ? indexOf(L.file, L.start) : undefined;
      const ng = i === undefined ? null : readGroup(tokens, i + 1);
      const where = ng ? { start: tokens[i].start, end: tokens[ng.close].end } : { start: L.start, end: L.start };
      const said = "\\begin{" + (ng ? groupName(tokens, ng) : L.env) + "}";
      if (!L.sure) {
        flag(L.file, where, "lists/numbers-unsure", "unsupported",
          said + ": the tool cannot be sure of its numbers (" + L.why + "), so it leaves this list as it is.", { why: L.why });
        continue;
      }
      if (L.kind !== "enumerate") {
        flag(L.file, where, "lists/not-a-pandoc-list", "unsupported",
          said + " (" + L.kind + "): Pandoc does not make a numbered list of it — its items arrive as plain paragraphs — so the tool leaves it as it is.", { kind: L.kind });
        continue;
      }
      if (!ng || tokens[i].kind !== "ControlWord" || tokens[i].name !== "begin") {
        flag(L.file, where, "lists/left-alone", "unsupported", said + ": the tool cannot find where this list's options are written, so it leaves it as it is.");
        continue;
      }
      const needs = !(L.level === 1 && L.short === "1." && L.exact && L.first === 1);
      if (!needs) continue;
      if (inConditional(L.file, tokens[i].start)) {
        flag(L.file, where, "lists/left-alone", "unsupported",
          said + ": this list sits inside an \\ifthenelse, which another fix rewrites whole, so its marker style and start number are not written for Pandoc. Pandoc shows its own default there.", { why: "ifthenelse" });
        continue;
      }
      const counter = L.first !== 1 ? "\\setcounter{" + L.counter + "}{" + (L.first - 1) + "}" : "";
      const notCarried = (why) => flag(L.file, where, "lists/label-not-carried", "unsupported",
        said + ": its marker (" + (L.short || L.before + "#" + L.after) + ") is not written for Pandoc, because " + why +
        ". Pandoc shows its own default there" + (counter ? "; the start number is carried." : "."), { why });

      if (!L.direct) {
        // an author's environment: the counter line after its \begin and arguments
        const name = groupName(tokens, ng), rec = store && store.resolve(name).record;
        const body = rec && rec.body && rec.body.beginBody;
        if (!body || !endsWithList(body)) {
          flag(L.file, where, "lists/left-alone", "unsupported",
            said + ": its definition goes on after the list's own \\begin, so a start number written here would not reach the list; the tool leaves it as it is.");
          continue;
        }
        notCarried("its options are in the definition of " + name + ", which every use shares");
        if (!counter) continue;
        const last = argumentsEnd(tokens, ng.close, rec);
        if (last === null) { flag(L.file, where, "lists/left-alone", "unsupported", said + ": its arguments cannot be read, so the tool leaves it as it is."); continue; }
        rewrite(L.file, tokens, i, last, counter, "lists/carrier",
          "wrote the start number (" + L.first + ") after " + said + " so Pandoc keeps it. What a compile prints is unchanged.");
        continue;
      }

      const b = readBracket(tokens, ng.close + 1);
      const own = b ? tokens.slice(b.open + 1, b.close) : [];
      options.set(L.id, own);
      let short = null;
      if (!L.short) notCarried("it has no short form Pandoc reads");
      else if (!canShort) notCarried("enumitem is not loaded" + (enumitem.loadonly ? " for enumerate (loadonly)" : "") + ", so this list takes no options");
      else {
        const k = splitKeys(own)[0];
        if (k && k.value === null && SHORT_FORMS.has(k.name)) { if (k.name !== L.short) notCarried("its first option is already the short form " + k.name + " and a second one would stop pdflatex"); }
        else short = L.short;
      }
      if (!short && !counter) continue;
      if (short) p.pass = true;
      if (b) {
        // one edit from \begin to the options' ], the author's keys copied whole between the two inserts
        const head = textOf(tokens.slice(i, b.open + 1)) + (short ? short + (own.some((t) => !blank(t)) ? ", " : "") : "");
        add(L.file, { rewrite: { span: { start: tokens[i].start, end: tokens[b.close].end },
          replacement: head + textOf(tokens.slice(b.open + 1, b.close + 1)) + counter,
          rule: "lists/carrier", note: noteFor(said, short, L, counter) } });
      } else {
        rewrite(L.file, tokens, i, ng.close, (short ? "[" + short + "]" : "") + counter, "lists/carrier", noteFor(said, short, L, counter));
      }
    }

    // ---- every item: the marker the PDF prints (session 269) ---------------
    // The kind comes from the reader's own record of the item (s251): an own
    // marker (custom) with no number, an own marker with a number, the
    // circled answer, or a plain numbered item.
    for (const it of lists.items) {
      if (it.hidden || it.list == null || it.label == null) continue;
      const L = lists.lists[it.list];
      if (!L.numbered || !L.sure || L.kind !== "enumerate") continue;
      let name = "ppmark";
      if (it.custom !== null) name = it.number == null ? "ppmarkown" : "ppmarkcalc";
      else if (it.via === "circleitem") {
        const own = options.get(L.id) || [];
        if (own.some((t) => t.kind === "ControlWord" && t.name === "maybecircle") && solonlyPrints()) name = "ppmarkcircled";
      }
      const tokens = tokensOf(it.file), k = tokens ? indexOf(it.file, it.start) : undefined;
      if (k === undefined) continue;
      const at = { start: tokens[k].start, end: tokens[k].end };
      if (insideArgument(tokens, L, k)) {
        flag(it.file, at, "lists/item-tag-not-written", "unsupported",
          "\\" + tokens[k].name + ": this item sits inside a command's argument, so its marker is not tagged for Pandoc.");
        continue;
      }
      if (inConditional(it.file, tokens[k].start)) {
        flag(it.file, at, "lists/item-tag-not-written", "unsupported",
          "\\" + tokens[k].name + ": this item sits inside an \\ifthenelse, which another fix rewrites whole, so its marker is not tagged for Pandoc.", { why: "ifthenelse" });
        continue;
      }
      // Where the tag goes: straight after an author's item command (\calcitem,
      // \circleitem - s257: an insertion, so the flagging transform can wrap
      // the command itself), after \item[..]'s ] (an insertion too, so another
      // fix's edit inside the brackets still applies), or after \item.
      let after = tokens[k].end;
      if (!it.via && it.custom !== null) {
        const b = readBracket(tokens, k + 1);
        if (!b) continue;
        after = tokens[b.close].end;
      }
      p.names.add(name);
      const plain = name === "ppmark";
      const note = (plain ? "wrote the marker " + JSON.stringify(it.label) + " that this item prints" : "tagged the marker " +
        JSON.stringify(it.label) + " of this item" + (name === "ppmarkcircled" ? " (the circled answer)" : "")) +
        " for Pandoc, which otherwise drops it. What a compile prints is unchanged.";
      // session 257: a flagged command inside the marker (\calcitem's TikZ
      // \calculator) is tagged as the flagging transform tags it in text
      add(it.file, { rewrite: { span: { start: after, end: after }, replacement: mark(name, tagText(it.label)),
        rule: plain ? "lists/item-mark" : "lists/item-tag", note } });
    }
    if (p.pass && enumitem.shortlabels) p.pass = false;     // the document asks for it already
    return p;
  }

  function noteFor(said, short, L, counter) {
    return "wrote " + [short ? "the marker style " + short : null, counter ? "the start number " + L.first : null].filter(Boolean).join(" and ") +
      " into " + said + " so Pandoc keeps " + (short && counter ? "them" : "it") + ". What a compile prints is unchanged.";
  }
  // The definition's begin code ends with a list's \begin{..}[..]: nothing but
  // spaces and comments after it.
  function endsWithList(body) {
    let k = body.length - 1;
    while (k >= 0 && blank(body[k])) k--;
    for (let j = k; j >= 0; j--) {
      if (body[j].kind !== "ControlWord" || body[j].name !== "begin") continue;
      const g = readGroup(body, j + 1);
      if (!g) return false;
      const b = readBracket(body, g.close + 1);
      return (b ? b.close : g.close) === k;
    }
    return false;
  }
  // The last token of the author's arguments to \begin{name}, read by the
  // definition's own slots; null when one cannot be read.
  function argumentsEnd(tokens, from, rec) {
    let last = from;
    for (const slot of rec.params || []) {
      if (slot.type === "optional" && slot.open === "[") { const b = readBracket(tokens, last + 1); if (b) last = b.close; }
      else if (slot.type === "mandatory") { const g = readGroup(tokens, last + 1); if (!g) return null; last = g.close; }
      else return null;
    }
    return last;
  }
  // Session 276 (DECISIONS 2026-10-26, option A; IFTHEN-LIST-CLASH-s276.md):
  // is this position inside an \ifthenelse call? The ifthen fix replaces
  // every call it can read - from \ifthenelse to the else branch's closing
  // brace, read the same way (readArguments, three arguments) - so an edit of
  // ours in there would clash with it. insideArgument above cannot see a list
  // whose \begin is itself inside the branch (lecture18_MOSFET_Amps).
  const conditionals = new Map();
  function inConditional(file, pos) {
    if (!conditionals.has(file)) {
      const spans = [], toks = tokensOf(file) || [];
      for (let j = 0; j < toks.length; j++) {
        if (toks[j].kind !== "ControlWord" || toks[j].name !== "ifthenelse") continue;
        const r = readArguments(toks, j + 1, THREE);
        if (r && r.args[2]) spans.push([toks[j].start, r.args[2].end]);
      }
      conditionals.set(file, spans);
    }
    return conditionals.get(file).some(([a, b]) => a <= pos && pos < b);
  }
  // Is token k inside a braced group opened after the list's \begin?
  function insideArgument(tokens, L, k) {
    const i = indexOf(L.file, L.start);
    if (i === undefined || tokensOf(L.file) !== tokens || i > k) return true;
    let depth = 0;
    for (let j = i; j < k; j++) { if (tokens[j].kind === "BeginGroup") depth++; else if (tokens[j].kind === "EndGroup") depth--; }
    return depth > 0;
  }

  return {
    name: BY,
    rounds: [1],
    onFile({ file, decide, emit }) {
      if (!plan) plan = build();
      const names = Object.keys(MARK_COLOURS).filter((n) => plan.names.has(n));
      if (file === entry && (plan.pass || names.length))
        emit(decide.prepend({ by: BY, rule: "lists/preamble",
          text: HEAD + (plan.pass ? PASS : "") + names.map(markDefinition).join(""),
          note: "added at the top the lines the list markers need: " + [plan.pass ? "enumitem's shortlabels option" : null,
            ...names.map((n) => "the " + n + " tag")].filter(Boolean).join(", ") +
            ". They print nothing." }));
      for (const a of plan.byFile.get(file) || []) {
        if (a.flag) emit(decide.flag({ by: BY, file, ...a.flag }));
        else emit(decide.rewrite({ by: BY, file, span: a.rewrite.span, replacement: a.rewrite.replacement, rule: a.rewrite.rule, note: a.rewrite.note }));
      }
    },
  };
}

export default createListCarrier;
