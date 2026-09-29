// v2/report.mjs — PLAN-8 P3. The report an author actually reads.
//
// Plain terms: everything before this file has been the tool talking to
// itself. A transform records what it did, the engine records what it could
// not settle, and all of it has been visible only to a test suite. This turns
// that record into a page a faculty member can read: what was changed, what
// was removed, what needs a human, and for each one the file, the line and
// the column where it sits.
//
// THE RULE THAT SHAPES THIS FILE, and it is the whole of PLAN-8 §4 P3's
// warning: the report names only what a transform RECORDED doing, located by
// the span it recorded. It NEVER compares the original text with the
// rewritten text line by line. The session 29 probe did compare them that
// way, and when a conditional fold removed four lines from handout.sty every
// line below it differed from whatever had moved up into its index — about
// thirty entries reported in a file that had one real change. A report like
// that is worse than no report at all: it buries the true entry in noise and
// it tells an author their work was rewritten in places it was not.
// v2/test/report.mjs R9 and R10 pin this with a fold that moves five lines.
//
// Lines and columns are counted in the AUTHOR'S ORIGINAL file. That is the
// file they have open, and it is the only text the spans belong to
// (WORKING-RULES.md §F: never slice output text with original spans).
//
// THE PLATFORM RULE, the same one v2/run.mjs lives under: this module reads
// and writes nothing. Text arrives as arguments, text is returned, and
// whoever calls it does the saving. In a browser there is no disk. Pinned by
// v2/test/report.mjs R2, which reads this file's own source, so no module
// that reaches a disk may be named here even inside a comment.
import { CHANNELS } from "./decide.mjs";

// What each channel is called on the page. Session 40 (INDEX.md): a heading
// is a name and a count, with no gloss beside it, and the page runs what did
// NOT convert first — NEEDS ATTENTION, then the two surfacing sections — and
// what the tool did for the author after. renderReport places these three in
// that order; no heading's words may sit inside another's (report R26).
const SECTIONS = Object.freeze([
  ["attention", "NEEDS ATTENTION"],
  ["changed", "CHANGED BY THE PREPROCESSOR"],
  ["removed", "REMOVED BY THE PREPROCESSOR"],
]);

// PLAN-8 P4, second half. The surfacing pass (v2/surface.mjs) names every
// command Pandoc will silently throw away. Those names are NEVER findings —
// PLAN-8 §6.5 pins "51 findings" as the falsifiable proof that the
// duplicate-finding fix worked, and folding 36 more into it would break that
// proof and bury the findings. So they arrive on the result as `dropped`,
// are counted in their own terms (uses, and distinct commands), and get a
// section of their own. §7: ON by default; `options.surfacing === false`
// removes the section. A run that never carried the pass is told apart from
// one that carried it and found nothing — silence must never read as clean.
const DISCARD_HEAD = "COMMANDS PANDOC DISCARDS";
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const discardCount = (dropped) =>
  plural(dropped.total, "use", "uses") + " of " +
  plural((dropped.byName || []).length, "command", "commands");

// PLAN-8 P5, second half. The item markers (v2/item-markers.mjs): every
// \item[...] whose bracketed marker Pandoc throws away — and none of the
// description terms, which survive. Like the discards they are NEVER
// findings; they arrive on the result as `markers`, are counted in their own
// terms, and get a section of their own under the same switch.
// Session 39, Nicholas's direction for the whole page (INDEX.md has his
// words): a simple list of what didn't convert, akin to Pandoc's log file —
// one line per entry, location first, nothing explained beside it. The
// module's note stays in the data for the documentation and the merged
// reports that come later. This section was the first written to that
// shape; session 40 re-cut the rest of the page to match (INDEX.md).
const MARKER_HEAD = "ITEM MARKERS PANDOC DISCARDS";

// Turn an offset into a line and a column, both counted from 1, in the text
// the offset belongs to. Returns null when there is nothing to count in, so
// a caller can say "no location" rather than print a confident 1:1.
export function lineColumn(text, offset) {
  if (typeof text !== "string") return null;
  if (!Number.isInteger(offset) || offset < 0) return null;
  const at = Math.min(offset, text.length);
  let line = 1, lastBreak = -1;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) === 10) { line++; lastBreak = i; }
  }
  // A carriage return belongs to the line it ends, so a CRLF file needs no
  // special case here: the column is measured from the newline itself.
  return { line, column: at - lastBreak };
}

const asMap = (x) => (x instanceof Map ? x : new Map(Object.entries(x || {})));
const oneLine = (s, cap = 60) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > cap ? t.slice(0, cap - 1) + "…" : t;
};

// One entry. The location is printed ONLY when there is a real span and a
// real text to count it in; otherwise the entry still appears, and says
// plainly that it has no line. A finding nobody can read about is the one
// thing this tool must never produce, so nothing here is ever dropped for
// being awkward to place.
// Where something sits, for findings and discards alike. Counted in the
// original text when it is there; otherwise the entry says so rather than
// printing a confident 1:1.
function whereOf(f, sources) {
  const text = f.file == null ? null : sources.get(f.file);
  const at = f.span && typeof text === "string" ? lineColumn(text, f.span.start) : null;
  if (f.file == null) return "(not tied to a file)";
  if (at) return f.file + ":" + at.line + ":" + at.column;
  if (!f.span) return f.file + " (no line recorded)";
  return f.file + " (original text not supplied, so no line)";
}

// One discarded marker, on ONE line: where, the \item[...] as the author
// wrote it (collapsed onto the line if it spanned several), and the rule tag
// — the key a documentation page can be looked up by. The module's note is
// deliberately NOT printed (v2/test/report.mjs R21); it travels in the data.
function renderMarker(e, sources) {
  const marker = e.marker == null ? "" : oneLine(e.marker, 80);
  return "  " + whereOf(e, sources) + "  \\item[" + marker + "]  " + e.rule;
}

// One discarded use, on ONE line (session 40, INDEX.md): where, the command
// as the author wrote it, and the tag. surface.mjs's note stays in the data.
// The name is printed with its backslash because that is how the author
// wrote it; nothing here is JSON-escaped.
function renderDrop(e, sources) {
  return "  " + whereOf(e, sources) + "  \\" + e.name + "  " + e.rule;
}

// One finding, on ONE line (session 40, INDEX.md): where, what the author
// WROTE there, and the tag — the rule, with its level when it has one. What
// was written is cut from the ORIGINAL text by the finding's own span, the
// only text that span belongs to (WORKING-RULES.md §F), and collapsed onto
// the line. The reason, and for a rewrite what it became, stay in the data
// and are not printed (v2/test/report.mjs R6, R25). An entry the page cannot
// place — no span, or no original text to count in — shows its reason in
// that slot instead, because nothing else on its line would say what it
// was; a finding nobody can identify is the silence this tool must not
// produce (R7, R12).
function renderEntry(f, sources) {
  const text = f.file == null ? null : sources.get(f.file);
  const placed = !!f.span && Number.isInteger(f.span.start) && typeof text === "string";
  const what = placed
    ? oneLine(text.slice(f.span.start, f.span.end), 60)
    : oneLine(f.message || f.note || "", 120);
  const tag = f.rule + (f.level ? " [" + f.level + "]" : "");
  return ["  " + whereOf(f, sources), what, tag].filter((s) => s !== "").join("  ");
}

// Findings in the order an author would read them: file by file in the order
// the document pulled them in, and within a file by where they sit. Anything
// with no span sorts after the located entries of its own file, and anything
// with no file at all comes last of all.
function orderFindings(findings, paths) {
  const rank = new Map();
  paths.forEach((p, i) => rank.set(p, i));
  const keyed = findings.map((f, i) => ({
    f, i,
    file: rank.has(f.file) ? rank.get(f.file) : (f.file == null ? Infinity : paths.length),
    at: f.span ? f.span.start : Infinity,
  }));
  keyed.sort((a, b) => a.file - b.file || a.at - b.at || a.i - b.i);
  return keyed.map((k) => k.f);
}

// Render the report.
//   result    what runProject (or runWalk) returned. `findings` is the only
//             field required; `paths`, `entry` and `decisions` are used when
//             they are there and quietly done without when they are not, so
//             a caller can render a partial run.
//   sources   the ORIGINAL text of each file, as a Map of name -> text, or a
//             plain object. Without it the entries still print; they simply
//             carry no line, and say so.
// Returns the report as a string. Nothing is written anywhere.
export function renderReport(result, sources, options = {}) {
  if (!result || !Array.isArray(result.findings))
    throw new Error("report: renderReport needs a run result carrying a findings array");
  const src = asMap(sources);
  const findings = result.findings;
  const paths = Array.isArray(result.paths) ? result.paths
    : [...new Set(findings.map((f) => f.file).filter((f) => f != null))];
  const decisions = result.decisions || result.records || [];

  const counts = {};
  for (const c of CHANNELS) counts[c] = 0;
  let unchannelled = 0;
  for (const f of findings) {
    if (Object.prototype.hasOwnProperty.call(counts, f.channel)) counts[f.channel]++;
    else unchannelled++;
  }

  // Session 40 (INDEX.md): the page is a log. A title, what was read, one
  // count line per section in the order the sections run, and the one
  // sentence that stops a location being misread. No ruled line under the
  // title (report R25); the tool's internal count of decisions stays in the
  // data. A pass that did not run reads NOT CHECKED, one that ran and found
  // nothing reads "none found": "nothing listed" must never be mistaken for
  // "nothing there" (R17, R24). Both passes answer to the one switch;
  // `options.surfacing === false` removes their lines and their sections.
  const surfacing = options.surfacing !== false;
  const dropped = surfacing && result.dropped && Number.isInteger(result.dropped.total)
    ? result.dropped : null;
  const markers = surfacing && result.markers && Number.isInteger(result.markers.total)
    ? result.markers : null;
  const dropState = !dropped ? "NOT CHECKED" : dropped.total ? discardCount(dropped) : "none found";
  const markState = !markers ? "NOT CHECKED" : markers.total ? String(markers.total) : "none found";

  const out = [];
  const title = options.title || "LaTeX preprocessing report";
  out.push(title);
  out.push("");
  if (result.entry) out.push("document:  " + result.entry);
  out.push("files:     " + (paths.length ? paths.join(", ") : "none"));
  const countRows = [["needs attention", counts.attention]];
  if (surfacing) countRows.push(["commands Pandoc discards", dropState],
                                ["item markers Pandoc discards", markState]);
  countRows.push(["changed", counts.changed], ["removed", counts.removed]);
  for (const [label, n] of countRows) out.push((label + ":").padEnd(31) + n);
  if (unchannelled)
    out.push("NOTE: " + unchannelled + " finding(s) carry a channel this report does " +
             "not know, and are listed at the end rather than dropped.");
  out.push("Locations are file:line:column in your ORIGINAL files.");

  const ordered = orderFindings(findings, paths);
  const known = (f) => Object.prototype.hasOwnProperty.call(counts, f.channel);

  // One section: a blank line, the heading with its count in brackets, and
  // one line per entry beneath it (report R25, R26).
  const section = (head, count, lines) => {
    out.push("");
    out.push(head + "  (" + count + ")");
    for (const l of lines) out.push(l);
  };
  const channel = (key) => {
    const head = SECTIONS.find((s) => s[0] === key)[1];
    const rows = ordered.filter((f) => f.channel === key);
    section(head, rows.length, rows.length ? rows.map((f) => renderEntry(f, src)) : ["  none."]);
  };

  // What did NOT convert, first: what the tool could not settle, then what
  // Pandoc will throw away — commands, then \item markers.
  channel("attention");
  if (surfacing) {
    section(DISCARD_HEAD, dropState,
      !dropped ? ["  not checked."]
        : !dropped.total ? ["  none."]
        : ["  by command: " + dropped.byName.map((b) => "\\" + b.name + " \u00d7" + b.count).join(", "),
           ...orderFindings([...dropped.entries], paths).map((e) => renderDrop(e, src))]);
    section(MARKER_HEAD, markState,
      !markers ? ["  not checked."]
        : !markers.total ? ["  none."]
        : orderFindings([...markers.entries], paths).map((e) => renderMarker(e, src)));
  }
  // Then what the tool did for the author.
  channel("changed");
  channel("removed");

  // A channel this file does not know about is printed rather than dropped.
  // decide.mjs owns the list and this module follows it; if the two ever
  // disagree, the author still sees everything and the summary says so.
  const others = ordered.filter((f) => !known(f));
  if (others.length) section("NOT RECOGNISED", others.length, others.map((f) => renderEntry(f, src)));

  out.push("");
  return out.join("\n") + "\n";
}
