// v2/transforms/columns.mjs — session 255. Fix C of sessions/LISTS-DROPPED-s254.md
// (DECISIONS 2026-10-23, "fix C's form": "unwrap a multicols or minipage only
// where it holds items of the list around it, and also remove the stray "2"
// from every multicols").
//
// Plain terms: Pandoc 3.11 reads a two-column block (multicols) or a minipage
// as a box of its own. When list items of the list OUTSIDE the box sit inside
// it, Pandoc drops a multicols block whole, words included, and a minipage
// turns the whole list around it into plain paragraphs (_work/_s254-cols.txt
// W3, P3). Columns and the box are layout only, so in that shape the -pp copy
// loses the box's \begin (with its arguments) and its \end, the contents kept:
// the items are back in their list. A complete list wholly inside a box
// converts fine (W1, W2, P1, P2) and is left as it is.
//
// Every multicols Pandoc keeps shows its column count in the text ("2"). The
// count written {\numexpr2\relax} prints identically and Pandoc skips it
// (_work/_s255-leak.txt F5; F3, a \csname macro, also works but needs a line
// in the preamble; a bare digit or a comment before {2} still leaks).
//
// The choices:
// - "Items of the list around it" comes from the reader (list-depth.mjs): an
//   \item, or an author's command that makes one (\circleitem, \plainitem,
//   \calcitem), whose list began before the box's \begin or in another file.
//   Items the reader records as hidden (a comment environment) do not count.
// - The box's end is found by matchEnvironment (tokens, nesting-aware).
// - An unwrapped multicols takes its own \columnbreak with it: outside
//   columns pdflatex stops on it (_work/_s255_probe2.mjs, found by the sweep).
// - multicols' heading argument ([..] after the count): removing the \begin
//   would take the heading with it, so such a box is left in place and
//   reported (finding columns/not-unwrapped). Intro has none with items.
// - The count is rewritten only when it is written as digits; {#1} inside a
//   definition, or a macro, is left as it is.
// - It hooks \begin in the walk, so a span another fix has taken whole (the
//   walk does not visit inside it) is never edited twice.
import { readGroup, readBracket, matchEnvironment } from "../structure.mjs";

const BOXES = new Set(["multicols", "multicols*", "minipage"]);
const textOf = (toks) => toks.map((t) => t.text).join("");

// The \columnbreak tokens that belong to this multicols: in its body, not
// inside a multicols nested in it (that one keeps its own).
function ownColumnBreaks(tokens, env) {
  const out = [];
  for (let j = env.bodyOpen; j <= env.bodyClose; j++) {
    const t = tokens[j];
    if (t.kind !== "ControlWord") continue;
    if (t.name === "columnbreak") out.push(j);
    else if (t.name === "begin") {
      const g = readGroup(tokens, j + 1);
      const n = g ? textOf(tokens.slice(g.open + 1, g.close)).trim() : "";
      if (n !== "multicols" && n !== "multicols*") continue;
      const inner = matchEnvironment(tokens, j);
      if (inner) j = inner.close;
    }
  }
  return out;
}

// createColumns({ lists })
//   lists     the reader's lists ({ items, lists, ... })
export function createColumns({ lists }) {
  const BY = "columns";
  // per file: the items of a list, with where their list began
  let byFile = null;
  const itemsOf = (file) => {
    if (!byFile) {
      byFile = new Map();
      for (const it of (lists && lists.items) || []) {
        if (it.hidden || it.list == null) continue;
        const L = lists.lists[it.list];
        if (!byFile.has(it.file)) byFile.set(it.file, []);
        byFile.get(it.file).push({ start: it.start, listFile: L.file, listStart: L.start });
      }
    }
    return byFile.get(file) || [];
  };
  const holdsOuterItems = (file, env, begin) =>
    itemsOf(file).some((x) => x.start > env.start && x.start < env.end && (x.listFile !== file || x.listStart < begin));

  return {
    name: BY,
    rounds: [1],
    commands: {
      begin(ctx) {
        const { tokens, i, file, emit, decide } = ctx;
        const ng = readGroup(tokens, i + 1);
        if (!ng) return null;
        const name = textOf(tokens.slice(ng.open + 1, ng.close)).trim();
        if (!BOXES.has(name)) return null;
        const env = matchEnvironment(tokens, i);
        if (!env) return null;
        const said = "\\begin{" + name + "}";
        // the box's own arguments: multicols {n}[heading]; minipage [pos][height][inner]{width}
        let last = ng.close, count = null, heading = null;
        if (name === "minipage") {
          for (let k = 0; k < 3; k++) { const b = readBracket(tokens, last + 1); if (!b) break; last = b.close; }
          const w = readGroup(tokens, last + 1);
          if (!w) return null;
          last = w.close;
        } else {
          count = readGroup(tokens, last + 1);
          if (!count) return null;
          last = count.close;
          heading = readBracket(tokens, last + 1);
        }

        if (holdsOuterItems(file, env, tokens[i].start)) {
          if (!heading) {
            const message = "removed " + textOf(tokens.slice(i, last + 1)) + " and its \\end{" + name + "}: it holds items of the list " +
              "around it, and Pandoc " + (name === "minipage" ? "then stops treating that list as a list" : "drops such a block whole, words included") +
              ". The " + (name === "minipage" ? "box" : "columns") + " were layout only; the items are kept in their list. " +
              "The original prints as before; this copy prints them without the " + (name === "minipage" ? "box" : "columns") + ".";
            emit(decide.remove({ by: BY, file, rule: "columns/unwrap", message,
              span: { start: tokens[i].start, end: tokens[last].end }, detail: { environment: name } }));
            if (name !== "minipage") for (const k of ownColumnBreaks(tokens, env))
              emit(decide.remove({ by: BY, file, rule: "columns/unwrap", span: { start: tokens[k].start, end: tokens[k].end },
                message: "removed \\columnbreak with the " + said + " around it: outside columns pdflatex stops on it " +
                  "(\"\\columnbreak outside multicols\"). It was layout only.", detail: { environment: name, columnbreak: true } }));
            emit(decide.remove({ by: BY, file, rule: "columns/unwrap", message,
              span: { start: tokens[env.endWord].start, end: env.end }, detail: { environment: name } }));
            return null;
          }
          emit(decide.flag({ by: BY, file, rule: "columns/not-unwrapped", level: "unsupported",
            span: { start: tokens[i].start, end: tokens[heading.close].end },
            message: said + " holds items of the list around it, so Pandoc drops this block, words included; it has a heading [..], " +
              "which removing the columns would take with it, so the tool leaves it as it is.", detail: { environment: name } }));
        }

        if (count) {
          const digits = tokens.slice(count.open + 1, count.close);
          const n = textOf(digits);
          if (!digits.length || !digits.every((t) => t.kind === "Other" && t.text >= "0" && t.text <= "9")) return null;
          emit(decide.rewrite({ by: BY, file, rule: "columns/count",
            span: { start: tokens[count.open].start, end: tokens[count.close].end },
            replacement: "{\\numexpr" + n + "\\relax}",
            note: "wrote the column count of " + said + " as {\\numexpr" + n + "\\relax} so Pandoc does not show it as a stray \"" + n +
              "\" in the text. What a compile prints is unchanged." }));
        }
        return null;                                   // the walk tracks the group itself
      },
    },
  };
}

export default createColumns;
