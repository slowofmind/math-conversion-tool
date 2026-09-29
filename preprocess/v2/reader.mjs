// v2/reader.mjs — Stage 4 of the v2 rebuild. DESIGN-V2 §4.1 and §4.4.
//
// Plain terms: read a whole PROJECT the way LaTeX would, one document at a
// time. Sort the files into kinds, work out which file is which document's
// parent, then start at the top of the document and walk down. When a line
// names a file that is in the project, jump in, read it, come back to the
// same spot. Write what is learnt into the Stage 3 notebook (v2/store.mjs).
// Put \DeclareOption blocks in a side pocket unread; open the pocket only at
// \ProcessOptions and run the blocks the document actually asked for, in the
// order the package declared them. Never step into a command's body just
// because the command is called. Keep a record of every statement passed and
// what was true at that moment.
//
// This is the v2 replacement for lib/reader.mjs, lib/bodies.mjs,
// lib/prefilter.mjs and lib/evidence.mjs. The knowledge is re-hosted, not
// copied: v1 found its statements with one big regular expression over raw
// text and used a second scan to guess which of them sat inside a body.
// Here the statements are found by the SAME token walk that fills the store
// (walkDefinitions, given this module's table of extra statements), so a
// declaration inside a macro body, a comment or a verbatim block cannot be
// mistaken for one that runs.
//
// THIS IS NOT RUNNING THE DOCUMENT. Nothing is expanded, counted, measured
// or looped. A flag flipped inside a command body has no single value and is
// reported as "unknown", and that ceiling does not move by adding code here.
//
// MEASURED CONTEXT (README, "Measured before building the reader"): a course
// folder is not a document. Math Mb is 129 documents sharing six support
// files, and handout.sty is asked for three different ways. So the reader
// runs PER DOCUMENT CHAIN, and the same .sty legitimately reaches different
// states in different chains. Output is keyed by (document, file).
//
// Findings raised here start "reader/". Zero dependencies.

import { tokenize, profileFor } from "./tokenizer.mjs";
import { readGroup, readBracket, skipSpaces } from "./structure.mjs";
import { groupText } from "./definition.mjs";
import { createStore, walkDefinitions, HIDING_ENVS } from "./store.mjs";
// THE SEAM decides with the SAME rule the fold decides with — deliberately
// the same module, not a copy of it, so the text Pandoc receives and the
// notebook the later rules read can never disagree about which branch won.
// This points UP the layering (reader -> transform), which is the price of
// having one rule instead of two; it is acyclic (transforms/ifthen.mjs
// reaches only definition.mjs and lib/ifthen-eval.mjs). Session 24.
import { ifThenState, chooseBranch } from "./transforms/ifthen.mjs";

// ---- the include family (DESIGN-V2 §4.1; TREE-SITTER §2; D5) ------------
// One argument: the file. \subfileinclude and \InputIfFileExists were named
// in the design; \SweaveInput and \markdownInput come from D5's "also" list,
// where they are recorded as merely missed rather than misread.
export const INCLUDE_ONE = new Set([
  "input", "include", "subfile", "subfileinclude", "InputIfFileExists",
  "SweaveInput", "markdownInput",
]);
// Two arguments, DIRECTORY FIRST, then the file. This is D5's actual defect:
// v1 reads the first argument as the filename, so every one of these loads
// the wrong thing or nothing at all.
export const INCLUDE_TWO = new Set([
  "import", "subimport", "inputfrom", "subimportfrom",
  "includefrom", "subincludefrom",
]);
// Named so the reader can say it chose not to follow them, rather than
// appearing not to have noticed (DESIGN-V2 §4.1: graphics and verbatim
// includes are never followed).
export const NEVER_FOLLOW = new Set([
  "includegraphics", "includesvg", "includepdf",
  "verbatiminput", "lstinputlisting", "inputminted",
]);
// Loading statements. \documentclass and \LoadClass name a class; the rest
// name packages. All carry an optional list of requested options.
const LOADING = new Set([
  "documentclass", "usepackage", "RequirePackage", "LoadClass",
  "RequirePackageWithOptions", "LoadClassWithOptions",
]);

const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const slash = (p) => String(p).split("\\").join("/");
const lower = (p) => slash(p).toLowerCase();
const dirOf = (p) => slash(p).split("/").slice(0, -1).join("/");
const baseOf = (p) => slash(p).split("/").pop();
const isSupportPath = (p) => { const l = lower(p); return l.endsWith(".sty") || l.endsWith(".cls"); };
const star = (tokens, i) => (tokens[i] && tokens[i].kind === "Other" && tokens[i].text === "*" ? i + 1 : i);

const finding = (rule, level, span, file, message, detail) =>
  ({ rule, channel: "attention", level, kind: "literal", file: file ?? null,
     span: span || null, message, detail: detail || {} });

// ---- line numbers ------------------------------------------------------
// One pass per file, then a binary search per statement. v1 sliced the text
// and split it at every statement, which is the same answer far more slowly.
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, at) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

// ---- resolving a named file to a path in the project -------------------
// \input{../../macros/asst-macros} is normal in an Overleaf project. Without
// collapsing ".." these all report as missing files, which is a resolver bug
// wearing the costume of a finding about the author's project (v1, kept).
function collapse(p) {
  const out = [];
  for (const seg of slash(p).split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
// Candidates in order: beside the including file, then at the project root,
// then a unique basename match anywhere (v1, kept).
function resolveInclude(files, from, name, exts) {
  const dir = dirOf(from);
  const cands = [];
  for (const e of exts) cands.push(collapse((dir ? dir + "/" : "") + name + e), collapse(name + e));
  for (const c of cands) for (const key of files.keys()) if (collapse(lower(key)) === c.toLowerCase()) return key;
  const base = lower(baseOf(name));
  const hits = [...files.keys()].filter((k) => exts.some((e) => lower(baseOf(k)) === base + e));
  return hits.length === 1 ? hits[0] : null;
}

// ---- intake (DESIGN-V2 §4.1) -------------------------------------------
// The package name a support file announces, or its basename. Read from
// tokens, so a \ProvidesPackage sitting in a comment cannot name the file.
function packageNameOf(pathName, tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord") continue;
    if (t.name !== "ProvidesPackage" && t.name !== "ProvidesClass") continue;
    const g = readGroup(tokens, i + 1);
    if (g) return groupText(tokens, g).trim();
  }
  const b = baseOf(pathName);
  const cut = b.lastIndexOf(".");
  return cut > 0 ? b.slice(0, cut) : b;
}

// The first \documentclass, with its option list. A .tex with none is a
// fragment; one naming `subfiles` is a subfile and its option is the parent.
function classStatement(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "documentclass") continue;
    const o = readBracket(tokens, i + 1);
    const g = readGroup(tokens, o ? o.close + 1 : i + 1);
    if (!g) continue;
    return { name: groupText(tokens, g).trim(), options: o ? groupText(tokens, o).trim() : "", at: t.start };
  }
  return null;
}

// `% !TEX root = ../main.tex` — second in §4.1's order of evidence. Unused in
// this corpus and cheap to honour, so it is honoured.
function magicRoot(tokens) {
  for (const t of tokens) {
    if (t.kind !== "Comment") continue;
    const body = t.text.replace(/^%+/, "").trim();
    const eq = body.indexOf("=");
    if (eq < 0) continue;
    if (body.slice(0, eq).trim().toLowerCase() !== "!tex root") continue;
    return body.slice(eq + 1).trim();
  }
  return null;
}

// classifyFiles(files) — four kinds, parent links read BEFORE structure is
// inferred (rule 11). files is Map<path, text>. Tokens are produced once here
// and reused by every document that reads the file, which is what makes a
// 129-document folder affordable.
export function classifyFiles(files, options = {}) {
  const byPath = new Map(), documents = [], support = [], fragments = [], subfiles = [];
  for (const [p, text] of files) {
    const { tokens, findings } = tokenize(text, { profile: profileFor(p), file: p, verbatimEnvs: options.verbatimEnvs });
    const info = { path: p, text, tokens, lines: lineIndex(text), tokenFindings: findings,
                   kind: null, parent: null, parentVia: null, className: null, packageName: null };
    if (isSupportPath(p)) {
      info.kind = "support";
      info.packageName = packageNameOf(p, tokens);
      support.push(p);
    } else {
      const cs = classStatement(tokens);
      const root = magicRoot(tokens);
      if (cs && cs.name === "subfiles") {
        info.kind = "subfile"; info.className = "subfiles";
        info.parent = cs.options || root || null;
        info.parentVia = cs.options ? "\\documentclass[parent]{subfiles}" : root ? "% !TEX root" : null;
        subfiles.push(p);
      } else if (cs) {
        info.kind = "document"; info.className = cs.name;
        if (root) { info.parent = root; info.parentVia = "% !TEX root"; }
        documents.push(p);
      } else {
        info.kind = "fragment";
        if (root) { info.parent = root; info.parentVia = "% !TEX root"; }
        fragments.push(p);
      }
    }
    byPath.set(p, info);
  }
  // A subfile is both a document and a fragment (§4.1), so it is convertible.
  return { byPath, documents: documents.sort(), support: support.sort(),
           fragments: fragments.sort(), subfiles: subfiles.sort(),
           convertible: documents.concat(subfiles).sort() };
}

// A project can hold SEVERAL copies of the same package. Math Ma has
// handout.sty at the root and another under assessments\Exam 1, and they
// differ — the root one hides `wsplan` and `choices`, the Exam 1 one does
// not. Taking whichever came first read the wrong file for every worksheet,
// so proximity decides, the way TEXINPUTS would (v1, kept):
//   1. the including file's own directory
//   2. the entry document's directory
//   3. the project root
//   4. a unique match anywhere
function findPackageFile(project, pkg, fromPath, entryPath) {
  const matches = [];
  for (const p of project.support) if (project.byPath.get(p).packageName === pkg) matches.push(p);
  if (matches.length <= 1) return matches[0] || null;
  for (const dir of [dirOf(fromPath), dirOf(entryPath), ""]) {
    const hit = matches.find((k) => dirOf(k) === dir);
    if (hit) return hit;
  }
  return matches[0];
}

// Does `name` mean a hidden environment right now? Asked of the store, never
// tracked privately (DESIGN-V2 §8 rule 2).
function hides(store, name) {
  const r = store.resolve(name);
  const target = r.record && r.record.kind === "frozen" ? r.record.aliasOf : r.chain[r.chain.length - 1];
  return !!(target && target !== name && HIDING_ENVS.has(target));
}

// Token index of \begin{document}, or -1. A subfile's parent contributes its
// PREAMBLE only: that is what the subfiles package loads.
function preambleEnd(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || t.name !== "begin") continue;
    const g = readGroup(tokens, i + 1);
    if (g && groupText(tokens, g).trim() === "document") return i;
  }
  return -1;
}

// ---- readDocument — the ordered walk (DESIGN-V2 §4.4) -------------------
// readDocument(entry, files, options) -> {
//   entry, mode, record, statements, skipped, decided, store, filesRead,
//   findings, needsAttention, unresolved, summary }
//
// `record` is the READER's statement list, in order: loads, includes, option
// statements, flags, hiding and environment definitions — the list a person
// reads to see what the tool believed. Definition statements go to
// `statements` (the walk's own ordered list, one entry per file) rather than
// into the record, so the record stays short enough to read; both are
// ordered, and the pairing is judgement call 20 of the rebuild.
export function readDocument(entry, files, options = {}) {
  const project = options.project || classifyFiles(files, options);
  const entryInfo = project.byPath.get(entry);
  if (!entryInfo) throw new Error("no such file in project: " + entry);

  const store = options.store || createStore();
  const record = [], findings = [], statements = [], skipped = [], decided = [];
  const unresolved = [], filesRead = [], stack = [], reading = new Set();
  const requested = new Map();      // package -> Set(option) requested so far
  const loaded = new Set();         // packages already read in this chain
  const tally = { includes: 0, notFollowed: 0, optionHandlersRun: 0 };
  // \ifSubfilesClassLoaded is decided by OUR conversion mode, never by the
  // author (D6): the subfiles class is loaded exactly when the document being
  // converted is itself the subfile.
  const subfilesLoaded = entryInfo.kind === "subfile";
  const mode = subfilesLoaded ? "subfile-alone" : "document";

  const top = () => stack[stack.length - 1];
  const say = (at, what, effect, confidence = "certain", extra = {}) => {
    const f = top();
    const e = { file: f.file, line: lineOf(f.info.lines, at), what, effect, confidence };
    if (f.viaOption) e.viaOption = f.viaOption;
    record.push(Object.assign(e, extra));
    return e;
  };

  // A skipped entry carries open/close as TOKEN INDICES, and for anything
  // reached through walkInto those indices are relative to the SLICE, not to
  // the file's token array — and nothing on the entry says which array that
  // was. The seam could not otherwise find its own branch. This Map remembers
  // it, and is deliberately LOCAL: `skipped` is part of readDocument's return
  // value, so hanging whole token arrays off the entries would drag them
  // through anything that serialises the result. Session 24, option S1.
  const sliceOf = new Map();
  const absorb = (r, file, toks) => {
    for (const f of r.findings) findings.push(f);
    for (const s of r.statements) statements.push(Object.assign({ file }, s));
    for (const s of r.skipped) {
      const e = Object.assign({ file }, s);
      if (toks) sliceOf.set(e, toks);
      skipped.push(e);
    }
  };
  // Walk a slice of an already-tokenized file — an option handler's body, or
  // the branch of a conditional we have decided. Positions are absolute, so
  // the slice carries its own line numbers with it.
  const walkInto = (toks, file) => absorb(walkDefinitions(toks, file, store, hooks), file, toks);

  // Read one file of the chain. Frames are per FILE; `viaOption` is set on the
  // frame while an option handler body runs, because those statements sit in
  // the same file as the handler that declared them.
  function readFile(pathName, opts) {
    const info = project.byPath.get(pathName);
    if (!info) return;
    reading.add(pathName);
    filesRead.push(pathName);
    stack.push({ file: pathName, info, pkg: opts.package || null, processed: false,
                 viaOption: null, starHandler: false });
    let toks = info.tokens;
    if (opts.preambleOnly) { const e = preambleEnd(toks); if (e >= 0) toks = toks.slice(0, e); }
    absorb(walkDefinitions(toks, pathName, store, hooks), pathName, toks);
    stack.pop();
    reading.delete(pathName);
  }

  // Follow an include: resolve, guard against a cycle, read, record.
  function follow(t, what, raw) {
    const f = top();
    tally.includes++;
    const target = resolveInclude(files, f.file, raw, [".tex", ""]);
    if (!target) {
      say(t.start, what, "file not found in project", "opaque", { reason: "included file missing" });
      unresolved.push({ file: f.file, line: lineOf(f.info.lines, t.start), target: raw, kind: "include" });
      return;
    }
    if (reading.has(target)) {
      say(t.start, what, "already open further up this chain; not read again", "opaque",
          { reason: "circular include" });
      return;
    }
    say(t.start, what, "reading " + target);
    readFile(target, {});
  }

  const hooks = { commands: new Map() };
  const on = (names, fn) => { for (const n of names) hooks.commands.set(n, fn); };

  // ---- loading: \documentclass \usepackage \RequirePackage \LoadClass -----
  on([...LOADING], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    const carries = t.name.endsWith("WithOptions");
    const o = carries ? null : readBracket(tokens, i + 1);
    const g = readGroup(tokens, o ? o.close + 1 : i + 1);
    if (!g) return null;                       // unreadable; the walk carries on
    const wanted = splitList(o ? groupText(tokens, o) : "");
    for (const name of splitList(groupText(tokens, g))) loadOne(t, name, wanted);
    return g.close + 1;
  });

  function loadOne(t, name, wanted) {
    const f = top();
    const cur = requested.get(name) || new Set();
    const fresh = wanted.filter((w) => !cur.has(w));
    for (const w of wanted) cur.add(w);
    requested.set(name, cur);

    if (t.name === "documentclass" && name === "subfiles") { loadParent(t, wanted); return; }

    const target = findPackageFile(project, name, f.file, entry);
    if (!target) { say(t.start, "load " + name, "not in this project; skipped"); return; }
    if (loaded.has(name)) {
      say(t.start, "load " + name, "already loaded in this chain");
      // What lib/options-resolve.mjs's fixed point was really guarding
      // against. In an ordered walk a forward that arrives after its target
      // was read is not a round to run again — it is LaTeX's option clash,
      // and the honest answer is to say so rather than to re-read the file.
      if (fresh.length)
        findings.push(finding("reader/option-clash", "author-error",
          { start: t.start, end: t.end }, f.file,
          "Package " + name + " is asked for [" + fresh.join(",") + "] after it was already loaded; those options have no effect.",
          { package: name, tooLate: fresh, already: [...cur].filter((x) => !fresh.includes(x)) }));
      return;
    }
    loaded.add(name);
    say(t.start, "load " + name, "reading " + target +
        (wanted.length ? " with [" + wanted.join(",") + "]" : ""));
    readFile(target, { package: name });
  }

  // D6. \documentclass[../main]{subfiles} is a PARENT LINK, not a package
  // request — v1 logged all 359 corpus sites as "not in this project;
  // skipped" and lost the parent's preamble with them. The subfiles package
  // loads the parent's preamble and nothing else, so that is what is read.
  function loadParent(t, wanted) {
    const f = top();
    if (!(subfilesLoaded && f.file === entry)) {
      say(t.start, "load subfiles", "this file is read through its parent; the \\documentclass is not executed");
      return;
    }
    const name = (wanted[0] || f.info.parent || "").trim();
    if (!name) {
      say(t.start, "load subfiles", "subfiles document names no parent", "opaque",
          { reason: "subfiles class loaded with no parent in the option" });
      return;
    }
    const target = resolveInclude(files, f.file, name, [".tex", ""]);
    if (!target) {
      say(t.start, "load subfiles", "parent " + name + " is not in this project", "opaque",
          { reason: "subfiles parent missing" });
      unresolved.push({ file: f.file, line: lineOf(f.info.lines, t.start), target: name, kind: "subfiles parent" });
      return;
    }
    if (reading.has(target)) { say(t.start, "load subfiles", "parent " + target + " is already open above; not read again"); return; }
    say(t.start, "load subfiles", "reading " + target + " (parent preamble)");
    readFile(target, { preambleOnly: true });
  }

  // ---- inclusion (§4.1; D5) ----------------------------------------------
  on([...INCLUDE_ONE], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    const g = readGroup(tokens, star(tokens, i + 1));
    if (!g) return null;
    const raw = groupText(tokens, g).trim();
    let next = g.close + 1;
    if (t.name === "InputIfFileExists") {           // {file}{if found}{if not}
      const y = readGroup(tokens, next), n = y && readGroup(tokens, y.close + 1);
      if (n) next = n.close + 1;
    }
    follow(t, t.name + " " + raw, raw);
    if (t.name === "InputIfFileExists" && next > g.close + 1)
      say(t.start, "\\InputIfFileExists branches", "neither branch is executed by the reader", "opaque",
          { reason: "the found / not-found branches of \\InputIfFileExists are not run" });
    return next;
  });

  // D5's real defect: DIRECTORY first, then the file. v1 read the directory
  // as the filename, so \import{chapters/}{intro} looked for a file called
  // "chapters/" and reported the author's project as broken.
  on([...INCLUDE_TWO], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    const g1 = readGroup(tokens, star(tokens, i + 1));
    if (!g1) return null;
    const g2 = readGroup(tokens, g1.close + 1);
    if (!g2) return null;
    const dir = slash(groupText(tokens, g1).trim()), name = groupText(tokens, g2).trim();
    const joined = !dir ? name : dir.endsWith("/") ? dir + name : dir + "/" + name;
    follow(t, t.name + " " + dir + " " + name, joined);
    return g2.close + 1;
  });

  // Named so that "we did not follow this" is a decision on the books rather
  // than an omission (§4.1). They are counted, not recorded one by one.
  on([...NEVER_FOLLOW], () => { tally.notFollowed++; return null; });

  // ---- options, phase one: declarations into the side pocket -------------
  // The hook RECORDS and returns null, so the walk's own \DeclareOption
  // branch does the stepping-over and puts the body in `skipped`. One place
  // knows how to measure the statement; this one only has to read its name.
  on(["DeclareOption"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    if (tokens[i + 1] && tokens[i + 1].kind === "Other" && tokens[i + 1].text === "*") {
      f.starHandler = true;
      say(t.start, "\\DeclareOption*", "fallback handler registered");
      return null;
    }
    const n = readGroup(tokens, i + 1);
    if (!n) return null;
    const name = groupText(tokens, n).trim();
    say(t.start, "declare option " + name, "registered, not yet in force", "conditional",
        { dependsOn: (f.pkg || "?") + "[" + name + "]" });
    return null;
  });

  on(["ExecuteOptions"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    const g = readGroup(tokens, i + 1);
    if (!g) return null;
    if (!f.pkg) return g.close + 1;
    const cur = requested.get(f.pkg) || new Set();
    for (const o of splitList(groupText(tokens, g))) cur.add(o);
    requested.set(f.pkg, cur);
    say(t.start, "default options " + groupText(tokens, g).trim(), "added to requested set");
    return g.close + 1;
  });

  on(["PassOptionsToPackage", "PassOptionsToClass"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    const a = readGroup(tokens, i + 1);
    const b = a && readGroup(tokens, a.close + 1);
    if (!b) return null;
    const raw = groupText(tokens, a).trim(), tgt = groupText(tokens, b).trim();
    const opt = raw === "\\CurrentOption" ? (f.viaOption || null) : raw;
    if (!opt) {
      say(t.start, "forward to " + tgt, "\\CurrentOption outside an option handler", "opaque",
          { reason: "\\CurrentOption used where no option is being processed" });
      return b.close + 1;
    }
    const cur = requested.get(tgt) || new Set();
    const fresh = splitList(opt).filter((o) => !cur.has(o));
    for (const o of splitList(opt)) cur.add(o);
    requested.set(tgt, cur);
    say(t.start, "forward [" + opt + "] to " + tgt, "added to its requested set");
    if (loaded.has(tgt) && fresh.length)
      findings.push(finding("reader/forward-after-load", "author-error",
        { start: t.start, end: t.end }, f.file,
        "[" + fresh.join(",") + "] is forwarded to " + tgt + ", which this chain has already read; the forward comes too late to have any effect.",
        { target: tgt, tooLate: fresh }));
    return b.close + 1;
  });

  // ---- options, phase two: the pocket opens ------------------------------
  // \ProcessOptions is the moment deferred handlers become real. The bodies
  // are the ones the walk put in `skipped` as it passed them, so they arrive
  // here in DECLARATION ORDER, which is the order LaTeX runs them in — not
  // the order the document asked for them.
  on(["ProcessOptions"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    const next = star(tokens, i + 1);
    if (f.processed) return next;
    f.processed = true;
    const wanted = requested.get(f.pkg) || new Set();
    const handlers = ctx.skipped.filter((s) => s.kind === "DeclareOption" && s.option !== "*")
                                .map((s) => ({ name: String(s.option).trim(), open: s.open }));
    const selected = handlers.filter((h) => wanted.has(h.name));
    const unmatched = [...wanted].filter((w) => !handlers.some((h) => h.name === w));
    // A1(b), checkpoint 3 (2026-09-16): the handler names that RAN, as data on
    // the row. package-options reads this list — never the sentence above and
    // never the final requested set (summary.options), which differs in the
    // four divergence documents. Nothing else on the row changes; gate R keys
    // rows on file|line|what|effect|confidence and ignores extras.
    say(t.start, "\\ProcessOptions", selected.length
      ? "running handler(s) in declaration order: " + selected.map((h) => h.name).join(", ")
      : "no requested option matches a handler",
      "certain", { selected: selected.map((h) => h.name), unmatched: [...unmatched] });
    for (const h of selected) {
      const k = skipSpaces(tokens, h.open + 1);
      const g1 = readGroup(tokens, k);
      const g2 = g1 && readGroup(tokens, g1.close + 1);
      if (!g2) continue;
      tally.optionHandlersRun++;
      const before = f.viaOption;
      f.viaOption = h.name;
      store.beginOption(f.pkg || "?", h.name);
      walkInto(tokens.slice(g2.open + 1, g2.close), f.file);
      store.endOption();
      f.viaOption = before;
    }
    if (unmatched.length)
      say(t.start, "options with no handler: " + unmatched.join(", "),
          f.starHandler ? "package has a \\DeclareOption* fallback" : "nothing will happen",
          f.starHandler ? "certain" : "opaque",
          { reason: "option requested but the package declares no handler" });
    return next;
  });

  // ---- flags, hiding and environments: RECORD here, APPLY in the walk ----
  // Each of these hooks returns null. It reads only what the record needs to
  // say, and leaves the store write to definition.mjs / store.mjs, so there
  // is one implementation of what \let or \newboolean actually means.
  on(["newboolean", "provideboolean"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    const g = readGroup(tokens, i + 1);
    if (g) say(t.start, "declare flag " + groupText(tokens, g).trim(), "defaults to false");
    return null;
  });

  on(["setboolean"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    const a = readGroup(tokens, i + 1);
    const b = a && readGroup(tokens, a.close + 1);
    if (!b) return null;
    const v = groupText(tokens, b).toLowerCase().includes("true");
    say(t.start, "set flag " + groupText(tokens, a).trim() + " = " + v,
        f.viaOption ? "in force because [" + f.viaOption + "] was requested" : "in force from here on");
    return null;
  });

  // \let\X=\comment hides an environment; \let\endX=\endcomment is its other
  // half and carries no extra information. Anything else is just a second
  // name for a command, which is a definition, not news for a person.
  on(["let"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    let k = skipSpaces(tokens, i + 1);
    const a = tokens[k];
    if (!a || a.kind !== "ControlWord") return null;
    k = skipSpaces(tokens, k + 1);
    if (tokens[k] && tokens[k].kind === "Other" && tokens[k].text === "=") k = skipSpaces(tokens, k + 1);
    const b = tokens[k];
    if (!b || b.kind !== "ControlWord") return null;
    if (b.name === "comment") say(t.start, "hide environment " + a.name, "aliased to \\comment");
    else if (b.name !== "endcomment") say(t.start, "define \\" + a.name, "alias for \\" + b.name);
    return null;
  });

  on(["newenvironment", "renewenvironment", "provideenvironment"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i];
    const g = readGroup(tokens, i + 1);
    if (!g) return null;
    const n = groupText(tokens, g).trim();
    say(t.start, "define environment " + n,
        hides(store, n) ? "REPLACES the earlier \\comment alias; no longer hidden" : "defined");
    return null;
  });

  // \begin{document} is not a scoping group for us. \end{document} ends the
  // job rather than restoring what came before, so a definition made in the
  // body is still in force when the reader finishes — and a store that had
  // replayed the undo would report every one of them as never made. The
  // reader knows what a document is; the store does not, so the policy lives
  // here (judgement call 21).
  on(["begin", "end"], (ctx) => {
    const { tokens, i } = ctx;
    const g = readGroup(tokens, i + 1);
    if (!g || groupText(tokens, g).trim() !== "document") return null;
    return g.close + 1;
  });

  // D6. \ifSubfilesClassLoaded{A}{B} is fully decidable by us, always,
  // because the condition is about OUR choice of conversion mode and not
  // about anything in the author's file. Pandoc drops both branches; we take
  // the one that runs and walk it, which is following the document, not
  // expanding it.
  on(["ifSubfilesClassLoaded"], (ctx) => {
    const { tokens, i } = ctx, t = tokens[i], f = top();
    const g1 = readGroup(tokens, i + 1);
    const g2 = g1 && readGroup(tokens, g1.close + 1);
    if (!g2) return null;
    const taken = subfilesLoaded ? g1 : g2;
    say(t.start, "\\ifSubfilesClassLoaded", subfilesLoaded
      ? "true — this subfile is being converted on its own, so the first branch runs"
      : "false — the subfiles class is not loaded in this conversion, so the second branch runs");
    decided.push({ kind: "ifSubfilesClassLoaded", file: f.file, value: subfilesLoaded,
                   start: t.start, end: tokens[g2.close].end,
                   taken: { start: tokens[taken.open].start, end: tokens[taken.close].end },
                   dropped: { start: tokens[(subfilesLoaded ? g2 : g1).open].start,
                              end: tokens[(subfilesLoaded ? g2 : g1).close].end } });
    walkInto(tokens.slice(taken.open + 1, taken.close), f.file);
    return g2.close + 1;
  });

  // ---- the walk itself ---------------------------------------------------
  readFile(entry, {});

  // A flag assigned inside a MACRO body is run-time state: that body runs
  // every time the command is called, so there is no single answer and the
  // honest value is "unknown". v1 found these by scanning the raw text of
  // every file in the folder; here the question is put to the store, so only
  // definitions this document's chain actually made are considered, and a
  // \setboolean inside a comment or a verbatim block cannot count.
  const runtime = new Set();
  const scanBody = (toks) => {
    if (!toks) return;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind !== "ControlWord") continue;
      if (t.name === "setboolean" || t.name === "settoggle" ||
          t.name === "toggletrue" || t.name === "togglefalse") {
        const g = readGroup(toks, i + 1);
        if (g) runtime.add(groupText(toks, g).trim());
        continue;
      }
      const s = store.flagSetter(t.name);
      if (s) runtime.add(s.name);
    }
  };
  const scanBodies = () => {
    for (const name of store.names()) {
      const d = store.lookup(name);
      if (!d || !d.body) continue;
      if (Array.isArray(d.body)) scanBody(d.body);
      else { scanBody(d.body.beginBody); scanBody(d.body.endBody); }
    }
  };
  const settledFlags = () => {
    const f = {};
    for (const [name, rec] of store.flags()) f[name] = runtime.has(name) ? "unknown" : rec.value;
    for (const n of runtime) if (!Object.prototype.hasOwnProperty.call(f, n)) f[n] = "unknown";
    return f;
  };
  scanBodies();

  // ---- THE SEAM (E11) ----------------------------------------------------
  // walkDefinitions measures an \ifthenelse, files it on `skipped`, and jumps
  // past it WITHOUT entering either branch — so a \def written inside the
  // branch that WON is invisible to the notebook, and to every rule that
  // reads it. This walks that branch in.
  //
  // WHY IT RUNS HERE, AT THE END, AND NOT AS A COMMAND HOOK. A hook would
  // fire mid-walk (store.mjs consults the hook table BEFORE the ifthenelse
  // skip, so it would work) — but the test needs flags, and a flag set later
  // in the chain is not settled yet when the walk passes the construct. At
  // the end they are settled, which is why this needs no position-aware
  // evaluation. The price is the notebook's ORDER: branch definitions arrive
  // last, so a name redefined at walk level LATER in the chain loses to the
  // branch, which is not what LaTeX would do. That ceiling is PINNED by
  // v2/test/ifthen.mjs B5 and was MEASURED ABSENT in the narrow corpus
  // (_work\_s19-order-probe.txt: 0 hazards / 24 site-and-name pairs). Two-pass
  // closes it; B5 flipping to "LATER" is the signal that it has, not a
  // regression.
  //
  // The state is built ONCE, from the flags as the chain left them, so the
  // seam is order-independent: no branch can change the answer to another
  // branch's test. A flag a branch sets is still reported (it reaches the
  // summary below) — it just does not feed back into a folding decision,
  // which is exactly what the session-19 probe licensed: all 25 branch
  // payloads were DEFINITIONS, none was a flag assignment.
  //
  // `skipped` GROWS while this runs: a branch we walk may hold conditionals
  // of its own, and walkInto files those as new entries. The index loop picks
  // them up, and it terminates because every slice is strictly shorter than
  // the construct it came from.
  const seamState = ifThenState(settledFlags());
  for (let s = 0; s < skipped.length; s++) {
    const e = skipped[s];
    if (e.kind !== "ifthenelse" || e.seam) continue;
    const toks = sliceOf.get(e);
    if (!toks) continue;
    const c = chooseBranch(toks, e.open, seamState);
    if (!c) { e.seam = { value: "U", why: "malformed", walked: false }; continue; }
    e.seam = { value: c.value, why: c.why, walked: !!c.keep };
    if (!c.keep) continue;
    // A FRAME IS REQUIRED HERE, and only here. Every other walkInto caller
    // runs inside readFile, which has already pushed one; the seam runs after
    // the whole chain has been read and the stack is EMPTY, so `say` and the
    // command hooks — \setboolean is one — would read top() as undefined and
    // throw. The frame is this branch's own file, which is also what makes
    // the statements the branch produces attributable to the right place.
    const info = project.byPath.get(e.file);
    if (!info) continue;
    stack.push({ file: e.file, info, pkg: null, processed: false,
                 viaOption: null, starHandler: false });
    try { walkInto(toks.slice(c.keep[0], c.keep[1] + 1), e.file); }
    finally { stack.pop(); }
  }

  // Again, because the seam can have added definitions (whose bodies may hold
  // run-time flag writes) and flag statements of its own.
  scanBodies();
  const flags = settledFlags();

  const opaque = record.filter((r) => r.confidence === "opaque");
  const read = [...new Set(filesRead)];
  return {
    entry, mode, record, statements, skipped, decided, store, findings, unresolved,
    // v1's filesRead is what the chain READ BESIDE the entry; `chain` is the
    // whole set including it, which is what a person means by "the chain".
    filesRead: read.filter((p) => p !== entry),
    chain: read,
    // The residue: everything the reader could not decide. This is what a
    // report is built from, and the goal is for it to be SHORT.
    needsAttention: opaque.map((r) => ({ file: r.file, line: r.line, what: r.what,
                                         reason: r.reason || r.effect })),
    summary: {
      statements: record.length,
      options: Object.fromEntries([...requested].filter(([, v]) => v.size).map(([k, v]) => [k, [...v]])),
      hiddenEnvironments: store.hiddenEnvironments().sort(),
      flags,
      opaque: opaque.length,
      definitions: statements.length,
      includes: tally.includes,
      notFollowed: tally.notFollowed,
      optionHandlersRun: tally.optionHandlersRun,
    },
  };
}

// ---- readProject — every convertible document, each on its own -----------
// There is no flat model. DESIGN-V2 §9 retires runProject: a folder is not a
// document, and unioning what several documents ask for is how a problems
// handout kept ~700 blocks of solutions (test/fixtures-folder.mjs). Each
// document gets its own store, its own chain and its own answer; the files
// are tokenized once and shared, which is what makes 129 documents cheap.
export function readProject(files, options = {}) {
  const project = classifyFiles(files, options);
  const only = options.documents || project.convertible;
  const documents = only.map((entry) => readDocument(entry, files, Object.assign({}, options, { project, store: undefined })));
  return { project, documents,
           unresolved: documents.flatMap((d) => d.unresolved),
           findings: documents.flatMap((d) => d.findings) };
}
