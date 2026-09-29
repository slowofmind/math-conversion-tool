// v2/surface.mjs — PLAN-8 P4. Surfacing the names Pandoc discards.
//
// Plain terms: this pass changes nothing. It reads the document the tool has
// already tokenized, and for every command in it asks the capability table
// one question — does Pandoc's LaTeX reader throw this away? Where the answer
// is yes, it records the file and the position, so the author is told about
// a loss instead of discovering it in the converted document. On the Math Ma
// worksheet this is 36 uses of 7 names: \comment twelve, \hspace nine,
// \vspace six, \newpage six, and \noindent, \par and \endinput once each.
//
// Session 29 ran exactly this as §8 of its whole-pipeline probe. This is that
// pass, in a place the command line and the browser can both call.
//
// WHAT "DROPPED" MEANS HERE, AND WHAT IT DOES NOT. The table answers "all",
// "some", "none", or nothing at all for a name. This pass reports "all" and
// only "all". Three neighbours are deliberately left alone:
//   - "some": the rows disagree, and DECIDE already raises
//     capability/rows-disagree for those, reading the cautious row.
//   - names the table has never heard of: an unrecognised INLINE command is
//     dropped too, and its content destroyed with it — a worse loss than any
//     of the 36. But most unknown names in a real course document are the
//     author's own macros, and separating those from genuinely unhandled
//     constructs needs the definition store the expander is blocked on.
//     Reporting them today would bury 36 true entries under the author's own
//     commands. Session 36's open item, deferred with a reason.
//   - rows that survive only under +raw_tex: losses for us, since we do not
//     enable it, but the remedy is a flag rather than a rewrite, and the
//     table counts them on their own channel for that reason.
// v2/test/surface.mjs S4 pins all of this and fails the day it widens
// quietly. None of it is a statement that the neighbours are rare.
//
// THE RULE THAT SHAPES THIS FILE, as in v2/run.mjs: it reads and writes
// nothing, and names no module that touches a disk. The built table is
// HANDED IN. The convenience loader lives with the table and is Node-only;
// reaching for it from here would cost the browser. S8 reads this file's own
// source and fails on the attempt.

// The one sentence an author reads about a discarded name. Written per
// entry rather than per name, because the report prints it beside a line
// number and a bare rule key would send them back to ask what it meant.
const noteFor = (name) =>
  "\\" + name + " is discarded by Pandoc's LaTeX reader — neither the command " +
  "nor anything it carries reaches the converted document. Nothing was changed " +
  "here; this is a place to handle by other means.";

// files       [{ path, tokens }], the same shape the walk is given.
// capability  REQUIRED, already built. Never fetched from here.
// Returns { entries, byName, total }. Nothing is written anywhere, no edit
// is produced, and the tokens handed in are not touched.
export function surfaceDrops(options = {}) {
  const capability = options.capability;
  if (!capability || typeof capability.drops !== "function")
    throw new Error("surfaceDrops: a built capability table must be passed in as " +
      "options.capability — this module never reads it from disk, so that it " +
      "runs unchanged in a browser");
  const files = Array.isArray(options.files) ? options.files : null;
  if (!files) throw new Error("surfaceDrops: needs files as [{ path, tokens }]");

  const entries = [];
  for (const f of files) {
    for (const t of (f.tokens || [])) {
      if (t.kind !== "ControlWord") continue;
      // A name the table does not hold throws or answers null; both mean
      // "not this pass's business", and neither may be read as "kept".
      let verdict = null;
      try { verdict = capability.drops(t.name); } catch { verdict = null; }
      if (verdict !== "all") continue;
      entries.push(Object.freeze({
        rule: "pandoc-drops/name",
        name: t.name,
        file: f.path,
        span: Object.freeze({ start: t.start, end: t.end }),
        note: noteFor(t.name),
      }));
    }
  }

  // Commonest first, ties broken by name so two runs never disagree.
  const counts = new Map();
  for (const e of entries) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  const byName = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name, count]) => Object.freeze({ name, count }));

  return Object.freeze({
    entries: Object.freeze(entries),
    byName: Object.freeze(byName),
    total: entries.length,
  });
}
