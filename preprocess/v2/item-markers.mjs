// v2/item-markers.mjs — PLAN-8 P5. Surfacing the item markers Pandoc discards.
//
// Plain terms: this pass changes nothing. \item itself survives Pandoc; the
// optional argument written after it — \item[\Pointinghand\ 4.] — does not.
// Pandoc reads the brackets, throws the contents away, and numbers or
// bullets the item like its neighbours. The author's hand-written marker is
// gone and nothing says so. On the Math Ma worksheet that is item 4 of the
// strategy list (worksheet22_2024.tex:375) and an empty [] inside a macro
// body in handout.sty (line 226). This pass names each one, with its file,
// its position and the text that will be lost.
//
// WHY P4 CANNOT SEE THIS. surface.mjs asks the capability table one control
// word at a time, and \item is a word Pandoc handles. What is lost here is
// an ARGUMENT, not a command, so the question has to be asked of the tokens
// after \item rather than of the name. Measured, not assumed:
// _work\_s30-probe-item4.txt (enumerate, itemize), _s38-probe-item-desc.txt
// (ten cases), _s38-probe-item-desc2.txt (four more), all on Pandoc 3.11.
//
// THE ONE PLACE THE MARKER SURVIVES, and why the pass tracks environments.
// In a description list the optional argument IS the term: <dt>...</dt>.
// PLAN-8 §4 P5 as signed says "each \item that carries an optional argument";
// reported literally, that would tell an author a term will vanish when it
// will not. Nicholas narrowed it (session 38): report only when the
// INNERMOST enclosing environment is not one Pandoc reads as a definition
// list. The pass therefore keeps a \begin/\end stack and asks the capability
// table what Pandoc makes of the environment on top of it — the data stays
// the source, and three list names are never spelled here. An \end that does
// not match the top closes down to its \begin, as the tool's own structure
// engine does, because real documents (the worksheet, line 366) have them.
//
// FIVE CONTEXTS, ONE NOTE EACH. Pandoc's list (ordered or bullet): the item
// is renumbered. A block Pandoc knows (center): the marker goes, and on the
// documents measured the list around the block did not survive as a list
// either. An environment Pandoc does not know: it becomes a plain block and
// the item is not numbered at all. No environment: a macro body or a loose
// item, and the note says which loss each would be. And an EMPTY marker,
// \item[], which asks for no marker and gets one anyway.
//
// KNOWN GAP, recorded not solved: a \begin in one definition body and its
// \end in another (a .sty wrapping a list) are matched in file order, so an
// item between them is labelled with a context it may not have at the call
// site. The consequence is a wrong context word, or in the description case
// a missed entry; the position and marker are right regardless.
//
// THE RULE THAT SHAPES THIS FILE, as in surface.mjs and run.mjs: it reads
// and writes nothing, and names no module that touches a disk. The built
// table is HANDED IN; the Node-only loader lives with the table. M17 reads
// this file's own source and fails on the attempt.
import { readBracket, readGroup } from "./structure.mjs";

// The text inside a {...} group, exactly as written — an environment name.
function groupText(tokens, g) {
  let s = "";
  for (let k = g.open + 1; k < g.close; k++) s += tokens[k].text;
  return s;
}

// What Pandoc makes of the environment on top of the stack, read from the
// table's own ast_node column. A name with several rows is read cautiously:
// if ANY row keeps the marker as a term, the pass stays silent.
//   "definition"  a DefinitionList — the marker is the term and SURVIVES
//   "ordered"     an OrderedList — the item is renumbered
//   "bullet"      a BulletList — the item gets a bullet
//   "block"       recognised, but not a list (center, quote, minipage …)
//   "unknown"     no row at all — Pandoc makes a plain Div of it
//   "none"        no enclosing environment in this file
function contextOf(env, capability) {
  if (env === null) return "none";
  let rows = [];
  try { rows = capability.rowsFor(env, { kind: "environment" }) || []; } catch { rows = []; }
  if (!rows.length) return "unknown";
  const asts = rows.map((r) => String(r.ast_node ?? "").trim());
  if (asts.includes("DefinitionList")) return "definition";
  if (asts.every((a) => a === "OrderedList")) return "ordered";
  if (asts.every((a) => a === "BulletList")) return "bullet";
  return "block";
}

// The one or two sentences an author reads beside the line number. The
// marker itself is printed by the report, so the note does not repeat it.
const TAIL = " Nothing was changed here; if the marker matters to the reader, it needs handling by other means.";
function noteFor(marker, context, env) {
  const head = marker === ""
    ? "\\item[] asks for NO marker on this item; Pandoc ignores the empty brackets and"
    : "Pandoc discards the marker written on this \\item and";
  let body;
  switch (context) {
    case "ordered":
    case "bullet":
      body = " numbers or bullets the item like its neighbours — the text between the brackets never reaches the converted document.";
      break;
    case "block":
      body = " keeps only the item's text. It sits inside \\begin{" + env + "}, which Pandoc reads as a block rather than a list; " +
        "on the documents measured, a list containing such a block did not survive as a list either.";
      break;
    case "unknown":
      body = " keeps only the item's text. It sits inside \\begin{" + env + "}, an environment Pandoc does not know and turns " +
        "into a plain block, so the item is not numbered at all.";
      break;
    default:
      body = " keeps only the item's text. This \\item sits inside no list environment in this file: if it is in a macro " +
        "body, the marker is lost wherever the macro is used inside a list; if it is loose in the text, Pandoc drops the " +
        "item and its marker together.";
  }
  return head + body + TAIL;
}

// files       [{ path, tokens }], the same shape the walk and surfaceDrops
//             are given.
// capability  REQUIRED, already built. Never fetched from here.
// Returns { entries, byEnvironment, total, kept }. `kept` counts the markers
// Pandoc KEEPS (description terms), so a run that saw them and chose silence
// can say so. Nothing is written anywhere, no edit is produced, and the
// tokens handed in are not touched.
export function surfaceItemMarkers(options = {}) {
  const capability = options.capability;
  if (!capability || typeof capability.rowsFor !== "function")
    throw new Error("surfaceItemMarkers: a built capability table must be passed in as " +
      "options.capability — this module never reads it from disk, so that it " +
      "runs unchanged in a browser");
  const files = Array.isArray(options.files) ? options.files : null;
  if (!files) throw new Error("surfaceItemMarkers: needs files as [{ path, tokens }]");

  const entries = [];
  let kept = 0;
  for (const f of files) {
    const tokens = f.tokens || [];
    const stack = [];                       // environment names, innermost last
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind !== "ControlWord") continue;
      if (t.name === "begin" || t.name === "end") {
        const g = readGroup(tokens, i + 1);
        if (!g) continue;
        const env = groupText(tokens, g);
        if (t.name === "begin") stack.push(env);
        else { const at = stack.lastIndexOf(env); if (at >= 0) stack.length = at; }
        i = g.close;
        continue;
      }
      if (t.name !== "item") continue;
      // The [...] as Pandoc reads it: a space, a comment, or ONE line break
      // may sit before it; a blank line may not (case J). A ] inside braces
      // does not close it (case G). Regions are single tokens and never reach here.
      const b = readBracket(tokens, i + 1);
      if (!b) continue;
      const env = stack.length ? stack[stack.length - 1] : null;
      const context = contextOf(env, capability);
      if (context === "definition") { kept++; continue; }
      let marker = "";
      for (let k = b.open + 1; k < b.close; k++) marker += tokens[k].text;
      entries.push(Object.freeze({
        rule: "pandoc-drops/item-marker",
        name: "item",
        file: f.path,
        span: Object.freeze({ start: t.start, end: b.end }),
        marker,
        shape: marker === "" ? "empty" : "marker",
        environment: env,
        context,
        note: noteFor(marker, context, env),
      }));
    }
  }

  // Commonest environment first, ties broken by name so two runs never
  // disagree; "no environment" (null) sorts after every named one.
  const counts = new Map();
  for (const e of entries) counts.set(e.environment, (counts.get(e.environment) || 0) + 1);
  const byEnvironment = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] === null ? 1 : b[0] === null ? -1 : a[0] < b[0] ? -1 : 1))
    .map(([environment, count]) => Object.freeze({ environment, count }));

  return Object.freeze({
    entries: Object.freeze(entries),
    byEnvironment: Object.freeze(byEnvironment),
    total: entries.length,
    kept,
  });
}
