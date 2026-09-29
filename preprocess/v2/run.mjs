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

// The registration order, declared here and nowhere else. It is the order
// session 29 ran and session 31 re-ran, and the order every recorded number
// belongs to; changing it changes the output, so it is a visible edit to a
// named constant rather than a rearrangement of a list inside a function.
export const TRANSFORM_ORDER = Object.freeze(
  ["at-letter", "require-package", "marker-rewrite", "package-options",
   "comment-alias", "ifthen", "long-prefix"]);

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
//           markers, output }
//   dropped is surfaceDrops' { entries, byName, total }: what Pandoc discards,
//   measured in the original text. Counted apart from findings, always.
//   markers is surfaceItemMarkers' { entries, byEnvironment, total, kept }:
//   every \item[...] whose marker Pandoc throws away, measured the same way
//   and counted apart from both findings and dropped.
// where output is a Map of name -> rewritten text, ready to be written,
// zipped, or handed to Pandoc.
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
  const decide = createDecide({ capability });

  const handlersRan = handlersRanFrom(reader);
  const packageFiles = packageFilesFrom(reader);
  const localNames = new Set(project.support
    .map((p) => project.byPath.get(p).packageName).filter(Boolean));

  const transforms = [
    createAtLetter(),
    createRequirePackage({ isLocalPackage: (n) => localNames.has(n) }),
    createMarkerRewrite(),
    createPackageOptions({ handlersRan }),
    createCommentAlias({ hidden: reader.summary.hiddenEnvironments,
                         isPackageFile: (f) => packageFiles.has(f) }),
    createIfThen({ flags: reader.summary.flags || {} }),
    createLongPrefix(),
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

  return {
    entry,
    paths,
    project,
    reader,
    walk,
    decisions: walk.records,
    findings: walk.findings,
    dropped,
    markers,
    output,
  };
}
