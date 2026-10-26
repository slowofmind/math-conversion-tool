// v2/subfile-preamble.mjs — session 244. A subfile converted on its own gets
// its parent's preamble.
//
// Plain terms: a worksheet that begins \documentclass[main]{subfiles} is
// compiled by LaTeX as main.tex's preamble — its own \documentclass and every
// line up to \begin{document} — followed by the worksheet's own lines. That is
// what the subfiles class does with that one line. Pandoc 3.11 does not: it
// never opens main.tex, so every command the course's packages define is
// unknown to it and each call is dropped with its words (s242: the three
// "Key Idea" boxes of Math Mb ws/1/ws1-1.tex). So the -pp copy of a subfile
// that is being converted ON ITS OWN carries main.tex's preamble — the -pp
// text of it, with this run's fixes already in — in place of that line.
// Nothing else in the subfile moves: a \PassOptionsToPackage above the line
// stays above it, the subfile's own \usepackage lines stay below it.
//
// Nicholas, 2026-10-23: "Approve A: when a subfile is the conversion target,
// its -pp copy gets main.tex's preamble in place of the
// \documentclass[main]{subfiles} line. Build it, fixture first."
//
// Every place is found by tokens: a "\begin{document}" inside a comment is a
// comment, not the end of the preamble.
import { tokenize, profileFor } from "./tokenizer.mjs";
import { readGroup, readBracket } from "./structure.mjs";
import { groupText } from "./definition.mjs";

// The first \documentclass: its class name and the character span of the
// whole statement, options and class group included.
function classStatement(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "documentclass") continue;
    const o = readBracket(tokens, i + 1);
    const g = readGroup(tokens, o ? o.close + 1 : i + 1);
    if (!g) continue;
    return { name: groupText(tokens, g).trim(), start: t.start, end: g.end };
  }
  return null;
}

// Where \begin{document} starts, or -1.
function beginDocumentAt(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "begin") continue;
    const g = readGroup(tokens, i + 1);
    if (g && groupText(tokens, g).trim() === "document") return t.start;
  }
  return -1;
}

// spliceParentPreamble(sub, parent) -> { text, spliced, reason }
//   sub, parent   { path, text } — the -pp text of each.
// text is the subfile with its \documentclass[...]{subfiles} statement
// replaced by everything in the parent before \begin{document}. When that
// cannot be done safely the subfile comes back unchanged with the reason.
export function spliceParentPreamble(sub, parent) {
  const st = tokenize(sub.text, { profile: profileFor(sub.path), file: sub.path }).tokens;
  const cls = classStatement(st);
  if (!cls || cls.name !== "subfiles")
    return { text: sub.text, spliced: false, reason: "no \\documentclass[...]{subfiles} in the subfile" };
  const pt = tokenize(parent.text, { profile: profileFor(parent.path), file: parent.path }).tokens;
  const at = beginDocumentAt(pt);
  if (at < 0)
    return { text: sub.text, spliced: false, reason: "the parent has no \\begin{document}" };
  // A parent that is itself a subfile would need ITS parent's preamble too.
  // Not seen in the corpus at s244; refused rather than half done.
  const pcls = classStatement(pt);
  if (pcls && pcls.name === "subfiles" && pcls.start < at)
    return { text: sub.text, spliced: false, reason: "the parent is itself a subfile" };
  return { text: sub.text.slice(0, cls.start) + parent.text.slice(0, at) + sub.text.slice(cls.end),
           spliced: true, reason: null };
}
