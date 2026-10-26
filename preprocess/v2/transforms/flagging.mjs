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
import { tokenize } from "../tokenizer.mjs";
import { readArguments } from "../definition.mjs";

export const FLAG_HEAD = "% Added by the preprocessor: flagged commands reach Pandoc as tags holding their source; TeX still runs them:\n" +
  "\\newcommand{\\ppflag}[2]{\\textcolor{ppflag}{#2}}\n" +
  "\\newcommand{\\ppflagitem}[2]{\\item\\textcolor{ppflag}{#2}}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppflag\\endcsname#1#2{#1}\n" +
  "\\expandafter\\long\\expandafter\\def\\csname ppflagitem\\endcsname#1#2{#1}\n";

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
  const taggable = (c) => (c.place === "text" || c.place === "item") && !c.inRegion && !c.inDepends && atCall(c) && !c.left;

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
      if (!usedInText && !calls.some(taggable) && !anySite && !written.length) return;
      emit(decide.prepend({ by: BY, rule: "flag/preamble", text: FLAG_HEAD,
        note: "added at the top the definitions of the flag tags (\\ppflag, \\ppflagitem): Pandoc reads the plain ones, TeX the ones after them. They print nothing." }));
    },
  };
  return { transform, tagText, calls, sites, wrapToken, written };
}

export default createFlagging;
