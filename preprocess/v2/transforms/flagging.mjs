// v2/transforms/flagging.mjs — session 257. The TAG FORM per place: the third
// of the flagging build's three parts (DECISIONS 2026-10-24, option B;
// sessions/FLAGGING-PLAN-s257.md). Tenth and last in run.mjs.
//
// Plain terms: a command that draws something Pandoc cannot carry (a blank, a
// TikZ icon, a dingbat) either makes Pandoc fail the whole document, drop the
// list it sits in, or silently lose it. Nicholas: flag it, do not fix it; the
// command stays in, the file keeps converting, and a later module lets
// remediators write their own replacement. So in the -pp copy each call that
// sits in text becomes
//     \ppflag{<the call as written>}{\verb|<the call's source>|}
// and an author command that makes an \item becomes \ppflagitem{..}{..}. TeX
// runs the first part (its \ppflag is redefined through \csname, which Pandoc
// does not read) - the print is the same. Pandoc reads a plain \newcommand
// and sees only the second part, inside a Span coloured "ppflag", as a Code
// element holding the source exactly (_work/_s257-verb.txt: \verb keeps
// quotes straight where \texttt curled them; s256 measured the rest of T5).
//
// The choices, each measured or pinned in v2/test/flagging-cases.mjs:
// - Only the places "text" and "item" get a tag (v2/flag-calls.mjs). Maths,
//   options, protected calls, environments: listed, no tag. Another place
//   (maths, later) is one more case here.
// - The open is a zero-width insertion before the call and the close
//   rewrites the call's last token, so another fix's edit inside the call
//   still applies (to TeX's part). The walk places them: a span another fix
//   takes whole (an \ifthenelse) is never visited, so never tagged.
// - The source has TeX comments taken out and spaces collapsed: a line break
//   inside \verb stops Pandoc, and a % would hide the closing brace from TeX.
//   Its delimiter is the first of | ! + = / ; : ? @ not in it; with none free
//   the call is not tagged.
// - A call that ends with a command word (\check, \calculator): TeX skips the
//   blanks after a command word, so they go inside the tag with it; a line
//   end only when no blank line follows. Otherwise the print would gain a
//   space. An item command needs none of this: \item skips them itself.
// - tagText tags flagged commands in text another fix writes: list-carrier's
//   marker of \calcitem holds the TikZ \calculator.
//
// Session 301 (BLANKS-FILTER-PLAN-s300 step 1; DECISIONS 2026-11-03, "A: tag +
// filter"): a call of handout.sty's fill-in-the-blank (v2/flag-list.mjs
// fitbMeaning: \fitb, \cfitb, \mfitb, \fitbox, \cfitbox) gets a tag of its own
// holding only what this version prints, never the source:
//     \ppfitb{<the call>}{\textcolor{ppfitb <kind> <width> <align>}{<shown>}}
// and, inside a formula, where a span cannot go,
//     \ppfitbm{<the call>}{\class{ppfitb <kind> <width> <align>}{<drawing>}}
// kind "blank" (the words written on the line, if any) or "answer" (the answer,
// with the words too where both print, [showprobonly]); an empty answer prints
// an empty line, so it is a blank. " box" ends the style for a framed line. The
// drawing is the line as MathJax draws it: \underline{<words>\hspace{<width>}}
// or \underline{\boldsymbol{<answer>}}, \boxed for a frame; a width MathJax
// cannot read (0.3\linewidth: the formula would show as raw TeX,
// _work/_s301-wordprobe.txt T6) is drawn 1in and kept as written in the style.
// What prints comes from the final meanings of \probonly and \solonly, so a
// problems version's tag never holds the answer; a call this version does not
// print (shown "no") gives Pandoc nothing. TeX reads the \csname definitions
// and runs the call: the print is unchanged (_work/_s300-tagprobe2.txt,
// _s300-mathprobe.txt; the control _work/_s301_print.mjs).
import { tokenize } from "../tokenizer.mjs";
import { readArguments } from "../definition.mjs";

export const FLAG_HEAD = "% Added by the preprocessor: flagged commands reach Pandoc as tags holding their source; TeX still runs them:\n" +
  "\\newcommand{\\ppflag}[2]{\\textcolor{ppflag}{#2}}\n" +
  "\\newcommand{\\ppflagitem}[2]{\\item\\textcolor{ppflag}{#2}}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppflag\\endcsname#1#2{#1}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppflagitem\\endcsname#1#2{#1}\n";
export const FITB_HEAD = "% Added by the preprocessor: fill-in-the-blank calls reach Pandoc as tags holding only what this version prints; TeX still runs them:\n" +
  "\\newcommand{\\ppfitb}[2]{#2}\n" +
  "\\newcommand{\\ppfitbm}[2]{#2}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppfitb\\endcsname#1#2{#1}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppfitbm\\endcsname#1#2{#1}\n";

// A width MathJax's \hspace reads: a number and one of its units.
const MATHJAX_UNITS = ["pt", "pc", "in", "cm", "mm", "em", "ex", "mu"];
function mathjaxWidth(w) {
  const unit = w.slice(-2), num = w.slice(0, -2);
  return MATHJAX_UNITS.includes(unit) && num !== "" && num !== "." && [...num].every((ch, k) => (ch >= "0" && ch <= "9") || ch === "." || (k === 0 && ch === "-")) ? w : "1in";
}

// The Pandoc half of a fill-in-the-blank call's tag (s301), or null when its
// arguments cannot be read. tokens/c: the call as flag-calls found it.
function fitbHalf(tokens, c) {
  const f = c.fitb;
  const r = readArguments(tokens, c.open + 1, f.slots);
  if (!r) return null;
  const inside = (a) => (a && a.open !== undefined && a.close > a.open ? textOf(tokens.slice(a.open + 1, a.close)) : "");
  const words = f.words ? inside(r.args[f.words - 1]) : "";
  const width = inside(r.args[f.width - 1]).split("").filter((ch) => ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r").join("");
  const answer = inside(r.args[f.answer - 1]);
  if (!width || [...width].some((ch) => "{}%#".includes(ch))) return null;
  const shownWords = f.probonly && words.trim() !== "" ? words : "";
  const answerShown = f.solonly && answer.trim() !== "";
  const kind = answerShown ? "answer" : "blank";
  c.fitbKind = c.shown === "no" ? "none" : kind;
  if (c.shown === "no") return "";
  const style = "ppfitb " + kind + " " + width + " " + (answerShown ? f.answerAlign : f.blankAlign) + (f.box ? " box" : "");
  if (c.place !== "maths") return "\\textcolor{" + style + "}{" + shownWords + (answerShown ? answer : "") + "}";
  const line = shownWords + (answerShown ? "\\boldsymbol{" + answer + "}" : "\\hspace{" + mathjaxWidth(width) + "}");
  return "\\class{" + style + "}{" + (f.box ? "\\boxed{" : "\\underline{") + line + "}}";
}

const DELIMS = ["|", "!", "+", "=", "/", ";", ":", "?", "@"];
// A definition site whose source holds a parameter (#1): Pandoc fills the
// argument in INSIDE the \verb, so an argument holding the delimiter ends it
// early and the rest of the document is misread (Math Mb's \answerbox with
// \ln\!|x|: lists, items and words lost, _work/_s258-pandoc.txt). @ is in no
// such argument across Intro (_work/_s258-delims.txt), so it comes first.
const PARAM_DELIMS = ["@", ...DELIMS.filter((x) => x !== "@")];

// The source as \verb carries it: TeX comments out (an unescaped % to its
// line end, and the next line's leading blanks), whitespace runs one space.
export function carriedSource(s) {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { o += c + (s[i + 1] ?? ""); i++; continue; }
    if (c === "%") { while (i < s.length && s[i] !== "\n") i++; while (i + 1 < s.length && (s[i + 1] === " " || s[i + 1] === "\t")) i++; continue; }
    o += c;
  }
  let w = "", blank = false;
  for (const c of o) {
    const isBlank = c === " " || c === "\t" || c === "\n" || c === "\r";
    if (isBlank) { if (!blank) w += " "; blank = true; } else { w += c; blank = false; }
  }
  return w;
}

// The tag's two pieces for one call, or null when no delimiter is free. A
// definition site's source starts with its ID, "D<n>: " (session 258, M5).
function pieces(source, item, id) {
  const v = (id ? id + ": " : "") + carriedSource(source);
  const d = (id && source.includes("#") ? PARAM_DELIMS : DELIMS).find((x) => !v.includes(x));
  if (d === undefined) return null;
  return { open: item ? "\\ppflagitem{" : "\\ppflag{", close: "}{\\verb" + d + v + d + "}" };
}

// The last token index a text call's tag closes after: a call ending with a
// command word takes the blanks TeX skips after it, and a line end not
// followed by a blank line.
function tailOf(tokens, last) {
  if (tokens[last].kind !== "ControlWord") return last;
  let j = last + 1;
  while (j < tokens.length && tokens[j].kind === "Space") j++;
  if (j < tokens.length && tokens[j].kind === "Newline") {
    let k = j + 1;
    while (k < tokens.length && tokens[k].kind === "Space") k++;
    if (!(k < tokens.length && tokens[k].kind === "Newline")) j++;
  }
  return j - 1;
}

const textOf = (toks) => toks.map((t) => t.text).join("");

// createFlagging({ calls, commands, entry, sites })
//   calls     from findFlagCalls (each gets `tagged` and, if not, `why`)
//   commands  from flaggedCommands or decideDefinitions (for tagText)
//   entry     the document; the definitions go at its top
//   sites     (session 258) from findDefinitionSites: each piece with status
//             "tag" is wrapped where it sits inside its definition, in the -pp
//             copy of the .sty or preamble - a first for this transform (the
//             comment fix's "never edit a package" rule is its own and stays).
//             Measured before the build (FLAGGING-PLAN2-s257.md, M1-M5): the
//             print is identical and Pandoc returns the source with the
//             definition's arguments filled in.
//   written   (session 262) from v2/expand-body.mjs: each piece of a definition
//             site written out at a call, { file, start, end, id, kind, piece,
//             definition }, positions in the written-out text. A call piece
//             (\fitb) is found as a call and its tag carries the site's ID; a
//             box piece (\fbox) is wrapped where it sits, when placeAt says
//             running text outside any \ifthenelse and it is not inside
//             another tag. Each gets `tagged`, and if not, `why`.
//   placeAt   (session 262) (file, tokens, k) -> { place, depends }: v2/flag-calls.mjs placeAt
// Only a call whose definition's decision is "call" is tagged at the call.
//   quiet     (session 262) [{ file, start, end, id }]: the written-out text of
//             a call left by choice (its U-ID); nothing in it is tagged
export function createFlagging({ calls = [], commands = new Map(), entry, sites = [], written = [], placeAt = null, quiet = [] } = {}) {
  const BY = "flagging";
  const writtenAt = new Map(), writtenBoxes = new Map(), boxDone = new Map();
  for (const w of written) {
    w.tagged = false;
    if (w.kind === "call") writtenAt.set(w.file + "\u0001" + w.start, w);
    else { if (!writtenBoxes.has(w.file)) writtenBoxes.set(w.file, []); writtenBoxes.get(w.file).push(w); }
  }
  const byStart = new Map();
  for (const c of calls) {
    c.tagged = false;
    if (c.inRegion) continue;
    if (!byStart.has(c.file)) byStart.set(c.file, new Map());
    byStart.get(c.file).set(c.start, c);
  }
  let usedInText = false;
  const atCall = (def) => !def.decision || def.decision === "call";
  // s301: a fill-in-the-blank call is tagged inside a formula too
  const taggable = (c) => (c.place === "text" || c.place === "item" || (c.place === "maths" && !!c.fitb)) && !c.inRegion && !c.inDepends && atCall(c) && !c.left;

  // Definition sites: written in onFile, or - for a piece inside an
  // \ifthenelse, which the ifthen fix rewrites whole - through wrapToken, which
  // that fix calls for every token of the branch it keeps.
  const siteFiles = new Map();
  for (const s of sites) {
    s.tagged = false;
    if (s.status !== "tag") continue;
    const tag = pieces(s.source, false, s.id);
    if (!tag) { s.status = "listed"; s.why = "its source holds every delimiter \\verb could use (" + DELIMS.join(" ") + "), so it is not tagged"; continue; }
    s.tag = tag;
    if (!siteFiles.has(s.file)) siteFiles.set(s.file, { direct: [], open: new Map(), tail: new Map() });
    const slot = siteFiles.get(s.file);
    if (s.viaIfthen) { slot.open.set(s.open, s); slot.tail.set(s.tail, s); } else slot.direct.push(s);
  }
  // wrapToken(file, k, text): the text the ifthen fix writes for token k
  function wrapToken(file, k, text) {
    const slot = siteFiles.get(file);
    if (!slot) return text;
    const o = slot.open.get(k), t = slot.tail.get(k);
    if (o) { o.tagged = true; text = o.tag.open + text; }
    if (t) text += t.tag.close;
    return text;
  }
  const anySite = sites.some((s) => s.status === "tag");

  // Tag the flagged commands in a piece of text a fix writes (list-carrier's
  // markers). Only commands with no arguments or braced ones, in text place.
  function tagText(text) {
    if (!commands.size) return text;
    const ts = tokenize(text, { profile: "standard" }).tokens;
    let out = "", at = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], def = t.kind === "ControlWord" ? commands.get(t.name) : null;
      if (!def || def.kind !== "command" || def.item || !atCall(def)) continue;
      let last = i;
      if (def.slots.length) {
        const r = readArguments(ts, i + 1, def.slots);
        if (!r || r.args.some((a, k) => def.slots[k].type === "mandatory" && (!a || !a.braced))) continue;
        for (const a of r.args) if (a && a.open !== undefined && a.close > last) last = a.close;
      }
      const p = pieces(textOf(ts.slice(i, last + 1)), false);
      if (!p) continue;
      const tail = tailOf(ts, last);
      out += text.slice(at, t.start) + p.open + textOf(ts.slice(i, tail + 1)) + p.close;
      at = ts[tail].end;
      i = tail;
      usedInText = true;
    }
    return out + text.slice(at);
  }

  const hook = (ctx) => {
    const { tokens, i, file, emit, decide } = ctx;
    const c = byStart.has(file) ? byStart.get(file).get(tokens[i].start) : undefined;
    if (!c || !taggable(c) || c.open !== i) return null;
    // s262: inside a box written out at a call and tagged there, a call is
    // carried in that tag, as a piece inside a piece is in a definition (s258)
    const box = (boxDone.get(file) || []).find((s) => s[0] <= c.start && c.end <= s[1]);
    if (box) { c.why = "carried inside the tag of " + box[2] + " (\\" + box[3] + " written out at a call)"; return null; }
    const q = quiet.find((s) => s.file === file && s.start <= c.start && c.end <= s.end);
    if (q) { c.why = "left by choice (the call it is written out from, " + q.id + ")"; return null; }
    const w = writtenAt.get(file + "\u0001" + c.start);   // s262: a written-out copy of a definition site
    if (c.fitb) {                                  // s301: the fill-in-the-blank tag
      const half = fitbHalf(tokens, c);
      if (half === null) { c.why = "its width cannot be carried in the tag's style, so it is not tagged"; return null; }
      const open = c.place === "maths" ? "\\ppfitbm{" : "\\ppfitb{";
      emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[i].start, end: tokens[i].start }, replacement: open,
        note: "wrapped \\" + c.name + " in a fill-in-the-blank tag: TeX still runs it, Pandoc sees only what this version prints. What a compile prints is unchanged." }));
      emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[c.close].start, end: tokens[c.close].end },
        replacement: tokens[c.close].text + "}{" + half + "}", note: "the end of \\" + c.name + "'s fill-in-the-blank tag." }));
      if (w) w.tagged = true;
      c.tagged = true;
      return null;
    }
    const p = pieces(c.source, c.place === "item", w ? w.id : undefined);
    if (w && p) w.tagged = true;
    if (!p) { c.why = "its source holds every delimiter \\verb could use (" + DELIMS.join(" ") + "), so it is not tagged"; return null; }
    const tail = c.place === "item" ? c.close : tailOf(tokens, c.close);
    const said = "\\" + c.name;
    emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[i].start, end: tokens[i].start }, replacement: p.open,
      note: "wrapped " + said + " in a tag: TeX still runs it, Pandoc sees its source (" + c.reach + "). What a compile prints is unchanged." }));
    emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[c.close].start, end: tokens[tail].end },
      replacement: textOf(tokens.slice(c.close, tail + 1)) + p.close, note: "the end of " + said + "'s tag, holding its source." }));
    c.tagged = true;
    return null;                                   // the walk goes on inside: other fixes still see the call's arguments
  };
  const names = new Set();
  for (const c of calls) if (taggable(c)) names.add(c.name);
  const hooks = {};
  for (const n of names) hooks[n] = hook;

  const transform = {
    name: BY,
    rounds: [1],
    commands: hooks,
    onFile({ file, tokens, decide, emit }) {
      const slot = siteFiles.get(file);
      if (slot) for (const s of slot.direct) {
        const said = "\\" + s.piece + (s.definition === null ? "" : " inside " + (s.env ? "{" + s.definition + "}" : "\\" + s.definition));
        emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: s.start, end: s.start }, replacement: s.tag.open,
          note: "wrapped " + said + " in a tag (" + s.id + "): TeX still runs it, Pandoc sees its source. What a compile prints is unchanged." }));
        emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[s.close].start, end: tokens[s.tail].end },
          replacement: textOf(tokens.slice(s.close, s.tail + 1)) + s.tag.close, note: "the end of " + said + "'s tag (" + s.id + "), holding its source." }));
        s.tagged = true;
      }
      // s262: box pieces written out at a call, wrapped where they sit in text
      const boxes = writtenBoxes.get(file) || [];
      const spans = calls.filter((c) => c.file === file && taggable(c)).map((c) => [c.start, c.end]);
      const done = [];
      for (const w of boxes.slice().sort((a, b) => a.start - b.start)) {
        const k = tokens.findIndex((t) => t.start === w.start), kc = tokens.findIndex((t) => t.end === w.end);
        const at = k >= 0 && placeAt ? placeAt(file, tokens, k) : null;
        const tag = k >= 0 && kc >= k ? pieces(textOf(tokens.slice(k, kc + 1)), false, w.id) : null;
        const inside = (s) => s[0] <= w.start && w.end <= s[1];
        if (!at || !tag) w.why = "the tool did not reach it to write the tag";
        else if (at.place !== "text") w.why = "it is written out at a call inside " + (at.place === "option" ? "a [..] option" : at.place) + ", where a tag cannot go";
        else if (at.depends) w.why = "it is written out inside \\ifthenelse, which another fix settles; no tag is written inside it";
        else if (spans.some(inside) || done.some(inside)) w.why = "it is carried inside another tag";
        else {
          const tail = tailOf(tokens, kc);
          emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: w.start, end: w.start }, replacement: tag.open,
            note: "wrapped \\" + w.piece + " written out from \\" + w.definition + " in a tag (" + w.id + "): TeX still runs it, Pandoc sees its source. What a compile prints is unchanged." }));
          emit(decide.rewrite({ by: BY, file, rule: "flag/tag", span: { start: tokens[kc].start, end: tokens[tail].end },
            replacement: textOf(tokens.slice(kc, tail + 1)) + tag.close, note: "the end of the tag of \\" + w.piece + " (" + w.id + "), holding its source." }));
          w.tagged = true;
          done.push([w.start, w.end, w.id, w.piece]);
        }
      }
      boxDone.set(file, done);
      if (file !== entry) return;
      // s301: each set of definitions only where its tags can be written
      const flags = usedInText || calls.some((c) => taggable(c) && !c.fitb) || anySite || written.length > 0;
      const fitbs = calls.some((c) => taggable(c) && c.fitb);
      if (!flags && !fitbs) return;
      emit(decide.prepend({ by: BY, rule: "flag/preamble", text: (flags ? FLAG_HEAD : "") + (fitbs ? FITB_HEAD : ""),
        note: "added at the top the definitions of the " + (flags ? "flag tags (\\ppflag, \\ppflagitem)" : "") + (flags && fitbs ? " and the " : "") +
          (fitbs ? "fill-in-the-blank tags (\\ppfitb, \\ppfitbm)" : "") + ": Pandoc reads the plain ones, TeX the ones after them. They print nothing." }));
    },
  };
  return { transform, tagText, calls, sites, wrapToken, written };
}

export default createFlagging;
