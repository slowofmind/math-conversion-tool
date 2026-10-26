// v2/run.mjs — PLAN-8 P2. One shared way to run a folder.
//
// Plain terms: everything this module does was already being done, in a
// scratch probe that nothing can import and in a partial four-transform form
// inside a test. This is that sequence written once, in a place the command
// line and the browser can both call. It is the only piece of the tool that
// knows the ORDER things happen in.
//
// The sequence: sort the files into document, package and fragment; read the
// document, which follows \usepackage from file to file; ask the reader two
// questions its answers are the only source of — which files it opened as
// packages, and which package options actually ran; build the seven
// transforms with those answers; look, in the author's own text and before
// anything is walked, for every command Pandoc will silently discard
// (PLAN-8 P4 — it lives here so the platform gets it from the same call, and
// nothing has to remember to ask), and for every \item whose hand-written
// marker Pandoc will discard (PLAN-8 P5, same place for the same reason);
// walk; apply the edits; hand everything back.
//
// THE RULE THAT SHAPES THIS FILE: it does not read or write anything, and it
// imports no filesystem module. In a browser there is no disk. Text comes in
// as a map of name -> text and goes out the same way; opening and saving
// files belongs to whoever calls this. The capability table is HANDED IN for
// the same reason — capability.mjs already splits its pure constructor from
// its Node-only convenience reader, and only the pure one may be reached from
// here. v2/test/e2e-run.mjs R2 fails the day that stops being true.
//
// Assembly copied from _work\_s31_probe_all7.mjs §4, the only place all seven
// have ever been wired together, and proven there on a real Math Ma worksheet
// that Pandoc cannot read at all without it.
import { classifyFiles, readDocument } from "./reader.mjs";
import { createDecide } from "./decide.mjs";
import { runWalk } from "./walk.mjs";
import { surfaceDrops } from "./surface.mjs";
import { surfaceItemMarkers } from "./item-markers.mjs";
import { createAtLetter } from "./transforms/at-letter.mjs";
import { createRequirePackage } from "./transforms/require-package.mjs";
import { createMarkerRewrite } from "./transforms/marker-rewrite.mjs";
import { createPackageOptions } from "./transforms/package-options.mjs";
import { createCommentAlias } from "./transforms/comment-alias.mjs";
import { createIfThen } from "./transforms/ifthen.mjs";
import { createLongPrefix } from "./transforms/long-prefix.mjs";
import { createListCarrier } from "./transforms/list-carrier.mjs";
import { createColumns } from "./transforms/columns.mjs";
import { createFlagging } from "./transforms/flagging.mjs";
import { createInlineBlocks } from "./transforms/inline-blocks.mjs";
import { mergeFlagList, decideDefinitions } from "./flag-list.mjs";
import { findFlagCalls, findDefinitionSites, flagEntries, flagTracker, placeAt } from "./flag-calls.mjs";
import { expandBody, mapper } from "./expand-body.mjs";
import { profileFor } from "./tokenizer.mjs";
import { spliceParentPreamble } from "./subfile-preamble.mjs";

// The registration order, declared here and nowhere else. It is the order
// session 29 ran and session 31 re-ran, and the order every recorded number
// belongs to; changing it changes the output, so it is a visible edit to a
// named constant rather than a rearrangement of a list inside a function.
export const TRANSFORM_ORDER = Object.freeze(
  ["at-letter", "require-package", "marker-rewrite", "package-options",
   "comment-alias", "ifthen", "long-prefix",
   // session 252: list numbers and markers (LISTS-PLAN-s249 step 3), last, so
   // nothing recorded for the seven before it moves
   "list-carrier",
   // session 255: a multicols or minipage holding items of the list around
   // it is unwrapped; every multicols' count is hidden from Pandoc (fix C)
   "columns",
   // session 257: calls of commands that draw what Pandoc cannot carry are
   // wrapped in a tag holding their source (the first flagging build)
   "flagging",
   // session 270: an inline command wrapped around a block reaches Pandoc as
   // visible source text around the block (INLINE-BLOCKS-PLAN-s270, option A)
   "inline-blocks"]);

// Which package options actually RAN, per file. The reader's \ProcessOptions
// rows are the only place this is known; package-options cannot work it out
// and must never guess it from the \usepackage call.
function handlersRanFrom(reader) {
  const m = new Map();
  for (const row of reader.record)
    if (row.what === "\\ProcessOptions" && Array.isArray(row.selected) && !m.has(row.file))
      m.set(row.file, row.selected);
  return m;
}

// Which files the reader opened AS PACKAGES, matched exactly against the
// chain. comment-alias must not edit a package file, and this is how it
// tells one apart from a subfile.
function packageFilesFrom(reader) {
  const set = new Set();
  for (const row of reader.record) {
    if (!row.what.startsWith("load ") || !String(row.effect).startsWith("reading ")) continue;
    for (const p of reader.chain)
      if (row.effect === "reading " + p || row.effect.startsWith("reading " + p + " with ["))
        set.add(p);
  }
  return set;
}

// Run one folder.
//   files        Map of name -> text, or a plain object. Nothing is read
//                from disk; the caller supplies every byte.
//   capability   REQUIRED. The parsed Pandoc capability table. In Node the
//                caller reads the vendored file; in a browser it fetches the
//                JSON. Either way it arrives here already built.
//   entry        optional; defaults to the first file with \documentclass.
// Returns { entry, paths, project, reader, walk, decisions, findings, dropped,
//           markers, flagged, output, subfileParent }
//   subfileParent is null unless the entry is a subfile converted on its
//   own; then { parent, spliced: true }, or { parent, spliced: false, reason }.
//   dropped is surfaceDrops' { entries, byName, total }: what Pandoc discards,
//   measured in the original text. Counted apart from findings, always.
//   markers is surfaceItemMarkers' { entries, byEnvironment, total, kept }:
//   every \item[...] whose marker Pandoc throws away, measured the same way
//   and counted apart from both findings and dropped.
//   flagged is flagEntries' { entries, byName, total, sites } (v2/flag-calls.mjs):
//   every call of a command that draws what Pandoc cannot carry, whatever
//   the version, tagged in the -pp copy or not, with its place and why; and
//   (session 258) every definition site, a piece tagged inside a definition.
//   options.flagList adds names to the also-flag / never-flag lists.
//   tracker is flagTracker's { definitions, uses }: one row per site with
//   its stable ID, definition sites linked to their uses (session 258).
//   options.flagChoices: { "\\name": "call" | "inside" | "leave",
//   "D<n>" | "U<n>": "leave" } - per definition, or per site.
// where output is a Map of name -> rewritten text, ready to be written,
// zipped, or handed to Pandoc.
//
// Session 262 (EXPANDER-PLAN-s260.md, approved: Decision 1 B, 2 A, 3 A): FIRST,
// every call of an author command in the body is written out in the author's
// text (v2/expand-body.mjs); the reading, the dropped and marker reports, the
// flagging and the walk then run on that text, as below. options.expand ===
// false skips the step (the run as it was before). The result's locations -
// findings, dropped, markers, flagged, tracker - are mapped back to the
// ORIGINAL files; `decisions`, `project`, `reader` and `walk` belong to the
// written-out text, which is `expansion.files`. Added to the result:
//   expansion  { files, changed, edits, calls, written }: the written-out text,
//              each call looked at and what became of it, and each written copy
//              of a definition site.
// The expander's own findings (expand/expanded and its kin on the changed or
// removed channel; every refusal, with its reason, on attention) are among
// `findings`.
export function runProject(files, options = {}) {
  const map = files instanceof Map ? files : new Map(Object.entries(files || {}));
  const capability = options.capability;
  if (!capability || typeof capability.drops !== "function")
    throw new Error("runProject: a built capability table must be passed in as " +
      "options.capability — this module never reads it from disk, so that it " +
      "runs unchanged in a browser");
  if (!map.size) throw new Error("runProject: no files were given");

  const project = classifyFiles(map);
  const entry = options.entry || project.documents[0];
  if (!entry)
    throw new Error("runProject: no file in this folder has \\documentclass, " +
      "so there is no document to read");

  const reader = readDocument(entry, map, { project });
  if (options.expand === false) return finish(runOnce(map, project, reader, entry, options, {}), null, map);

  // The first reading decides what is written out: the store, where the body
  // begins, the commands flagged at the call, the definition sites.
  const packageFiles = packageFilesFrom(reader);
  const flagList = mergeFlagList(options.flagList), flagChoices = options.flagChoices || {};
  const flagCommands = decideDefinitions({ store: reader.store, isAuthorFile: (f) => map.has(f), list: flagList, choices: flagChoices });
  const chainFiles = chainOf(entry, reader, project, map);
  const flagSites = findDefinitionSites({ files: chainFiles.filter((f) => map.has(f.path)), commands: flagCommands,
                                          list: flagList, choices: flagChoices, flags: reader.summary.flags || {} });
  const expansion = expandBody({ files: map, project, reader, entry, capability, flagCommands, flagSites, packageFiles });
  if (!expansion.changed) return finish(runOnce(map, project, reader, entry, options, {}), expansion, map);

  // The calls of flagged commands in the ORIGINAL text, for their IDs and
  // places: the written-out text has the same calls, moved, and no longer the
  // calls written out.
  const firstCalls = findFlagCalls({ files: chainFiles.filter((f) => !packageFiles.has(f.path)), commands: flagCommands, store: reader.store,
                                     hidden: reader.summary.hiddenEnvironments, sites: flagSites, choices: flagChoices });
  // A call left by choice (its U-ID) is still written out - that is what TeX
  // reads - but the copies of definition sites in its text are left untagged.
  const quiet = [];
  for (const f of firstCalls) {
    if (!f.left) continue;
    const e = (expansion.edits.get(f.file) || []).find((x) => x.start === f.start);
    if (!e) continue;
    quiet.push({ file: f.file, start: e.at, end: e.at + e.text.length, id: f.id });
    for (const w of expansion.written) if (w.call === e) w.left = true;
  }
  const project2 = classifyFiles(expansion.files);
  const reader2 = readDocument(entry, expansion.files, { project: project2 });
  const r = runOnce(expansion.files, project2, reader2, entry, options, { written: expansion.written.filter((w) => !w.left), quiet });
  return finish(r, expansion, map, firstCalls);
}

// The entry first, then every file it pulled in, with its tokens and text.
function chainOf(entry, reader, project, map) {
  return [entry, ...reader.chain.filter((p) => p !== entry)]
    .map((p) => ({ path: p, tokens: project.byPath.get(p).tokens, text: map.get(p), profile: profileFor(p) }));
}

// Session 262: everything below the reading, on one set of texts - the run as
// it was before the expander was connected. extra.written: the written copies
// of definition sites, for the flagging transform.
function runOnce(map, project, reader, entry, options, extra) {
  const { capability } = options;
  const decide = createDecide({ capability });

  const handlersRan = handlersRanFrom(reader);
  const packageFiles = packageFilesFrom(reader);
  const localNames = new Set(project.support
    .map((p) => project.byPath.get(p).packageName).filter(Boolean));

  // The commands to flag (v2/flag-list.mjs: the author's drawing commands,
  // followed down the store, and the lists' additions; options.flagList adds
  // to the default lists, for a later interface) and every call of them in
  // the author's own files, whatever the version (v2/flag-calls.mjs). Found
  // before the walk, in the original text, like the dropped report.
  // Session 258 (FLAGGING-PLAN2-s257.md): each definition's tag goes at its
  // calls or inside it (decideDefinitions), and the pieces inside are found
  // in every file the document reads, packages included (findDefinitionSites).
  const flagList = mergeFlagList(options.flagList), flagChoices = options.flagChoices || {};
  const flagCommands = decideDefinitions({ store: reader.store, isAuthorFile: (f) => map.has(f),
                                           list: flagList, choices: flagChoices });
  const chainFiles = chainOf(entry, reader, project, map);
  const authorFiles = chainFiles.filter((f) => !packageFiles.has(f.path));
  const flagSites = findDefinitionSites({ files: chainFiles.filter((f) => map.has(f.path)), commands: flagCommands,
                                          list: flagList, choices: flagChoices, flags: reader.summary.flags || {} });
  const hidden = reader.summary.hiddenEnvironments || [];
  const flagging = createFlagging({
    calls: findFlagCalls({ files: authorFiles, commands: flagCommands, store: reader.store,
                           hidden: reader.summary.hiddenEnvironments, sites: flagSites, choices: flagChoices }),
    commands: flagCommands, entry, sites: flagSites, written: extra.written || [], quiet: extra.quiet || [],
    placeAt: (file, tokens, k) => placeAt(tokens, k, { store: reader.store, hidden }) });
  // session 270: the inline commands around blocks, found before the walk in
  // the author's files (packages are never edited), with their IDs in order
  const inline = createInlineBlocks({ files: authorFiles, entry, hidden,
    placeAt: (file, tokens, k) => placeAt(tokens, k, { store: reader.store, hidden }) });

  const transforms = [
    createAtLetter(),
    createRequirePackage({ isLocalPackage: (n) => localNames.has(n) }),
    createMarkerRewrite(),
    createPackageOptions({ handlersRan }),
    createCommentAlias({ hidden: reader.summary.hiddenEnvironments,
                         isPackageFile: (f) => packageFiles.has(f) }),
    createIfThen({ flags: reader.summary.flags || {}, wrapToken: flagging.wrapToken }),
    createLongPrefix(),
    createListCarrier({ lists: reader.lists, store: reader.store, entry,
                        tokensOf: (p) => project.byPath.get(p) && project.byPath.get(p).tokens,
                        tagText: flagging.tagText }),
    createColumns({ lists: reader.lists }),
    flagging.transform,
    inline.transform,
  ];

  // The entry first, then every file it pulled in, in the order it pulled
  // them. Anything in the folder the document never loads is not walked and
  // not rewritten — the tool acts on the document, not on the directory.
  const paths = [entry, ...reader.chain.filter((p) => p !== entry)];
  const walkFiles = paths.map((p) => ({ path: p, tokens: project.byPath.get(p).tokens }));

  // What Pandoc will silently throw away, measured in the AUTHOR'S text as
  // written and BEFORE the walk, so the report can say "in your original
  // file" and mean it. Reports only; edits nothing; never a finding
  // (PLAN-8 §6.5). The report renders it as its own section, on by default,
  // and the switch to hide it is the report's (§7), not this module's.
  const dropped = surfaceDrops({ files: walkFiles, capability });

  // The item markers Pandoc will discard — \item[...] outside a description
  // list — measured in the same text at the same moment, for the same
  // reasons (PLAN-8 P5). Reports only; edits nothing; never a finding. The
  // report gives it a section of its own under the same switch.
  const markers = surfaceItemMarkers({ files: walkFiles, capability });

  const walk = runWalk({
    files: walkFiles,
    state: null,
    decide,
    transforms,
  });

  const output = new Map();
  for (const p of paths) output.set(p, walk.apply(p, map.get(p)));

  // A subfile converted ON ITS OWN gets its parent's preamble in its -pp copy
  // (session 244; Nicholas 2026-10-23, "Approve A"). Pandoc never opens the
  // parent a \documentclass[main]{subfiles} names, so without this every
  // command the course's packages define is lost to it. Done after the walk,
  // so the preamble copied in is the parent's -pp text with its fixes in.
  // A subfile reached through its parent's \subfile is not touched.
  let subfileParent = null;
  if (reader.mode === "subfile-alone") {
    const row = reader.record.find((r) => r.file === entry && r.what === "load subfiles");
    const parent = row && row.parent && output.has(row.parent) ? row.parent : null;
    if (!parent) {
      subfileParent = { parent: null, spliced: false,
                        reason: (row && (row.reason || row.effect)) || "no parent link read" };
    } else {
      const s = spliceParentPreamble({ path: entry, text: output.get(entry) },
                                     { path: parent, text: output.get(parent) });
      if (s.spliced) output.set(entry, s.text);
      subfileParent = s.spliced ? { parent, spliced: true } : { parent, spliced: false, reason: s.reason };
    }
  }

  return {
    entry,
    paths,
    project,
    reader,
    walk,
    decisions: walk.records,
    // session 269: list-carrier's tag on each numbered item (lists/item-mark)
    // is left out like flagging's per-call tags: one line per item would bury
    // the report; the list's own line and the preamble line stay
    findings: walk.findings.filter((f) => f.rule !== "flag/tag" && f.rule !== "lists/item-mark"),
    dropped,
    markers,
    flagging,
    output,
    subfileParent,
  };
}

// Session 262: the result as runProject returns it. Without a written-out call
// it is the run as it was. With them, every location goes back to the
// author's ORIGINAL file (v2/expand-body.mjs mapper), the expander's findings
// join the rest, and each flagged call takes its ID and place from the
// original text: a call written out is decision "expanded", naming the sites
// whose copies its text holds; a call found only inside written-out text is a
// copy of a definition site, counted on that site, not a use of its own.
function finish(r, expansion, original, firstCalls) {
  const { flagging } = r;
  const base = Object.assign({}, r);
  delete base.flagging;
  if (!expansion || !expansion.changed) {
    if (expansion) base.findings = r.findings.concat(expansion.findings);
    if (expansion) base.expansion = expansion;
    base.flagged = flagEntries(flagging.calls, flagging.sites);
    base.tracker = flagTracker(flagging.calls, flagging.sites);
    return base;
  }
  const map = mapper(expansion.edits);
  const span = (file, s) => (s && Number.isInteger(s.start)
    ? Object.freeze({ start: map(file, s.start, "start").pos, end: map(file, s.end, "end").pos }) : s);
  const lineIn = (file, at) => { const t = original.get(file); if (typeof t !== "string") return undefined; let n = 1; for (let j = 0; j < at && j < t.length; j++) if (t.charCodeAt(j) === 10) n++; return n; };
  const moved = (x) => {
    if (!x || !x.span || !expansion.edits.has(x.file)) return x;
    const y = Object.assign({}, x, { span: span(x.file, x.span) });
    if (y.detail && Number.isInteger(y.detail.line)) y.detail = Object.assign({}, y.detail, { line: lineIn(x.file, y.span.start) });
    return y;
  };
  base.findings = r.findings.map(moved).concat(expansion.findings);
  base.dropped = Object.assign({}, r.dropped, { entries: r.dropped.entries.map(moved) });
  base.markers = Object.assign({}, r.markers, { entries: r.markers.entries.map(moved) });

  // the flagged calls, matched to the original text's
  const key = (c) => c.file + "\u0001" + c.name + "\u0001" + c.start;
  const first = new Map(firstCalls.map((c) => [key(c), c]));
  const matched = new Set(), calls = [];
  for (const c of flagging.calls) {
    if (!expansion.edits.has(c.file)) { const f = first.get(key(c)); if (f) matched.add(f); calls.push(f ? Object.assign({}, c, { id: f.id, line: f.line }) : c); continue; }
    const a = map(c.file, c.start, "start");
    if (!a.exact) continue;                                         // a written copy of a definition site
    const f = first.get(c.file + "\u0001" + c.name + "\u0001" + a.pos);
    if (f) matched.add(f);
    calls.push(Object.assign({}, c, f ? { id: f.id, line: f.line, start: f.start, end: f.end, source: f.source }
                                      : { start: a.pos, end: map(c.file, c.end, "end").pos, line: lineIn(c.file, a.pos) }));
  }
  const editOf = (c) => (expansion.edits.get(c.file) || []).find((e) => e.start <= c.start && c.end <= e.end);
  for (const f of firstCalls) {
    if (matched.has(f)) continue;
    const e = editOf(f);
    if (!e) { calls.push(Object.assign({}, f, { tagged: false })); continue; }
    const mine = expansion.written.filter((w) => w.call === e && !w.left && (w.definition === f.name || e.name === f.name)).map((w) => w.id);
    calls.push(Object.assign({}, f, { decision: "expanded", tagged: false, sites: [...new Set(mine)] }));
  }
  const order = new Map(r.paths.map((p, k) => [p, k]));
  calls.sort((a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start);

  // the definition sites: back to their places, with their written copies counted
  const sites = flagging.sites.map((s) => {
    const y = Object.assign(Object.create(Object.getPrototypeOf(s)), s);
    if (expansion.edits.has(s.file)) { y.start = map(s.file, s.start, "start").pos; y.end = map(s.file, s.end, "end").pos; y.line = lineIn(s.file, y.start); }
    y.written = expansion.written.filter((w) => w.id === s.id && w.tagged).length;
    return y;
  });
  base.flagged = flagEntries(calls, sites);
  base.tracker = flagTracker(calls, sites);
  base.expansion = expansion;
  return base;
}
