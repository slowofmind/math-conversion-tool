// project-model.js — the single description of "the project".
//
// Stage 0 of the file-tree work. NOTHING user-visible depends on this
// yet: index.html keeps reading resourceFiles.auxFiles, which becomes a
// PROJECTION of this model rather than the source of truth.
//
// Design: Accessible-STEM-Project/file-tree-design/stage-0-project-model-spec.md
// Engine facts it encodes: ENGINE-FINDINGS-311.md
//
// Deliberately has NO DOM dependencies, so it is unit-testable in Node
// the way cm6-src/test-*.mjs already are.

export const PROJECT_MODEL_VERSION = '0.1.0';

// ── Classification ────────────────────────────────────────────────
// Source-verified against index.html (2026-09-05):
//   BINARY_INPUT_FORMATS = ['docx','odt','pptx','epub','fb2','ipynb']
//   formatMap in handleFileUpload()
// viewable and convertible are INDEPENDENT: .docx is convertible but
// not viewable; .sty is viewable but not convertible.

const TEXT_DOC_EXTS   = ['tex','latex','md','markdown','html','htm','rst','org','typ','txt'];
const BINARY_DOC_EXTS = ['docx','odt','pptx','epub','fb2','ipynb'];
const STYLE_EXTS      = ['sty','cls','def','clo'];
const BIB_EXTS        = ['bib','bibtex'];
const IMAGE_EXTS      = ['png','jpg','jpeg','gif','svg','webp','pdf','eps'];
const SUPPORT_EXTS    = ['csv','json','yaml','yml','xml','lua','css'];

export function classify(ext) {
  const e = (ext || '').toLowerCase();
  if (TEXT_DOC_EXTS.includes(e))   return { role: 'document', viewable: true,  convertible: true  };
  if (BINARY_DOC_EXTS.includes(e)) return { role: 'document', viewable: false, convertible: true  };
  if (STYLE_EXTS.includes(e))      return { role: 'style',    viewable: true,  convertible: false };
  if (BIB_EXTS.includes(e))        return { role: 'bib',      viewable: true,  convertible: false };
  if (IMAGE_EXTS.includes(e))      return { role: 'image',    viewable: false, convertible: false };
  if (SUPPORT_EXTS.includes(e))    return { role: 'support',  viewable: true,  convertible: false };
  return { role: 'unknown', viewable: false, convertible: false };
}

// ── Path normalisation ────────────────────────────────────────────
// Must agree with splitPath() in pandoc-wasm/pandoc.js, which splits on
// '/' and drops '' and '.' segments. Divergence here would be a silent,
// hard-to-find class of bug.
//
// Backslash conversion is PROVEN necessary: the browser virtual
// filesystem does not treat '\' as a separator, so a Windows-zipped
// project would otherwise lose every include and its .sty.
// (ENGINE-FINDINGS-311.md §8.2)

export function normalisePath(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const parts = raw
    .replace(/\\/g, '/')          // Windows zip tools
    .split('/')
    .filter(p => p !== '' && p !== '.');
  if (parts.length === 0) return null;
  if (parts.includes('..')) return null;   // flag, don't fail: caller skips + warns
  return parts.join('/');
}

export function dirOf(path)  { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
export function nameOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? path : path.slice(i + 1); }
export function extOf(name)  { const i = name.lastIndexOf('.'); return i <= 0 ? '' : name.slice(i + 1).toLowerCase(); }

// ── Wrapper detection ─────────────────────────────────────────────
// A folder upload or hand-zipped project keeps the chosen folder as the
// first path component, while the document still says \input{chapters/ch1}
// and \usepackage{handout}. Both lookups are literal and root-relative,
// so the wrapper breaks the chapters AND the style file together.
// Mirrors the allNested && topDirs.size === 1 test already used by
// importProjectZip() for its resource-path call.

export function detectWrapper(paths) {
  if (paths.length === 0) return null;
  const tops = new Set();
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i <= 0) return null;          // something lives at the root
    tops.add(p.slice(0, i));
  }
  return tops.size === 1 ? [...tops][0] : null;
}

// ── Sorting ───────────────────────────────────────────────────────
// Overleaf's collator, adopted verbatim: numeric so file2 precedes
// file10; variant sensitivity; upper-case first.
const collator = new Intl.Collator('en', {
  numeric: true, sensitivity: 'variant', caseFirst: 'upper',
});

// ── The model ─────────────────────────────────────────────────────

export function initProjectModel({ updateStatus } = {}) {
  const project = {
    entries: new Map(),        // path -> entry
    mainPath: null,            // document currently in the editor
    convertTargetPath: null,   // Stage 3 reads this; === mainPath in Stage 0
  };

  function makeEntry(path, bytes, opts = {}) {
    const name = nameOf(path);
    const ext = extOf(name);
    const cls = classify(ext);
    return {
      path, name, dir: dirOf(path), ext,
      bytes: bytes ?? null,
      text: null,                       // lazily decoded
      // BASELINE = the file exactly as it arrived. Captured HERE, at
      // intake, not lazily on first read: a lazy capture fires after the
      // user has already edited, so "revert to original" would restore
      // the edited text — or never appear at all, because nothing had
      // read the file yet. Holding the original bytes costs nothing (it
      // is the same array we were given) and never goes stale, because
      // updateText replaces `bytes`, not `baselineBytes`.
      baselineBytes: bytes ?? null,
      baseline: undefined,              // decoded on demand by baselineOf()
      role: cls.role,
      viewable: cls.viewable,
      convertible: cls.convertible,
      isMain: !!opts.isMain,
      source: opts.source || 'upload',
      // Reserved — initialised now, read by nobody until later stages.
      include: true,
      dirty: false,
      docState: null,
    };
  }

  // Returns { path, replaced } or { skipped, reason } for a bad path.
  function addFile(rawPath, bytes, opts = {}) {
    const path = normalisePath(rawPath);
    if (path === null) return { skipped: true, reason: `unusable path: ${rawPath}` };
    const replaced = project.entries.has(path);
    project.entries.set(path, makeEntry(path, bytes, opts));
    return { path, replaced };
  }

  // Bulk intake. Applies wrapper-stripping when every entry shares one
  // top-level directory, then adds them all. One projection at the end,
  // not one per file — a 200-file Overleaf zip must not re-project 200
  // times.
  //
  // items: [{ path, bytes }]
  // Returns { added, replaced, skipped:[reason], strippedWrapper }
  function addFiles(items, opts = {}) {
    const normalised = [];
    const skipped = [];
    for (const it of items) {
      const p = normalisePath(it.path);
      if (p === null) { skipped.push(`unusable path: ${it.path}`); continue; }
      normalised.push({ path: p, bytes: it.bytes });
    }

    let strippedWrapper = null;
    if (opts.stripWrapper !== false) {
      strippedWrapper = detectWrapper(normalised.map(n => n.path));
      if (strippedWrapper) {
        const cut = strippedWrapper.length + 1;
        for (const n of normalised) n.path = n.path.slice(cut);
      }
    }

    let added = 0, replaced = 0;
    for (const n of normalised) {
      const r = addFile(n.path, n.bytes, opts);
      if (r.skipped) { skipped.push(r.reason); continue; }
      added++;
      if (r.replaced) replaced++;
    }
    return { added, replaced, skipped, strippedWrapper };
  }

  function removeFile(rawPath) {
    const path = normalisePath(rawPath);
    if (path === null) return false;
    const had = project.entries.delete(path);
    if (project.mainPath === path) project.mainPath = null;
    if (project.convertTargetPath === path) project.convertTargetPath = null;
    return had;
  }

  // The main document. It reaches Pandoc as STDIN, never as a file in
  // the virtual filesystem — adding it to auxFiles would place a
  // duplicate there and could change conversion output. The isMain flag
  // is what keeps it out of the projection.
  function setMainDocument(rawPath, content, opts = {}) {
    const path = normalisePath(rawPath);
    if (path === null) return { skipped: true, reason: `unusable path: ${rawPath}` };
    if (project.mainPath && project.mainPath !== path) {
      const prev = project.entries.get(project.mainPath);
      if (prev) prev.isMain = false;
    }
    const existing = project.entries.get(path);
    const entry = existing || makeEntry(path, null, { source: opts.source || 'upload' });
    entry.isMain = true;
    if (opts.binary) { entry.bytes = content ?? null; entry.text = null; }
    else { entry.text = typeof content === 'string' ? content : null; }
    // A document uploaded straight into the editor never went through
    // addFile, so this is its only chance to record a baseline.
    if (entry.baseline === undefined && entry.baselineBytes == null &&
        typeof content === 'string') {
      entry.baseline = content;
    }
    project.entries.set(path, entry);
    project.mainPath = path;
    // The editor document and the conversion target are SEPARATE. A
    // viewable-but-not-convertible file (.sty, .bib) can be opened for
    // editing without changing what gets converted, so callers pass
    // keepTarget for those. Otherwise opening a document retargets.
    if (!opts.keepTarget || !project.convertTargetPath ||
        !project.entries.has(project.convertTargetPath)) {
      project.convertTargetPath = entry.convertible ? path : project.convertTargetPath;
    }
    return { path };
  }

  // ── Stage 5: baseline + checkpoints ───────────────────────────────
  // Deliberately minimal and additive, so this can grow (auto snapshots
  // before batch operations) or shrink (baseline only) without touching
  // callers. A checkpoint is just { id, label, text, at }.
  //
  // The BASELINE is checkpoint zero: captured at intake, permanent, not
  // deletable. Everything else is user-created.

  let checkpointSeq = 0;

  function baselineOf(rawPath) {
    const e = getEntry(rawPath);
    if (!e) return null;
    if (typeof e.baseline === 'string') return e.baseline;
    if (!e.baselineBytes) return null;
    try {
      e.baseline = new TextDecoder('utf-8', { fatal: true }).decode(e.baselineBytes);
      return e.baseline;
    } catch {
      e.baseline = null;              // binary: no text baseline, ever
      return null;
    }
  }

  // Called once, when an entry first receives content.
  function captureBaseline(entry, text) {
    if (entry.baseline !== undefined) return;   // never overwrite
    entry.baseline = typeof text === 'string' ? text : null;
  }
  void captureBaseline;   // retained for callers that assign text directly

  function addCheckpoint(rawPath, label) {
    const e = getEntry(rawPath);
    if (!e) return null;
    const text = getText(e.path);
    if (text === null) return null;             // binary: nothing to snapshot
    if (!e.checkpoints) e.checkpoints = [];
    const cp = {
      id: `cp${++checkpointSeq}`,
      label: label || `Checkpoint ${e.checkpoints.length + 1}`,
      text,
      at: Date.now(),
    };
    e.checkpoints.push(cp);
    return cp;
  }

  // Baseline first, then newest checkpoints first.
  function listCheckpoints(rawPath) {
    const e = getEntry(rawPath);
    if (!e) return [];
    const out = [];
    const base = baselineOf(rawPath);
    if (typeof base === 'string') {
      out.push({ id: 'baseline', label: 'Original (as uploaded)',
                 text: base, at: null, permanent: true });
    }
    for (const cp of [...(e.checkpoints || [])].reverse()) out.push(cp);
    return out;
  }

  // Returns the TEXT to restore. The caller applies it — via the
  // editor's replaceAll, so the restore is itself one undoable edit.
  function checkpointText(rawPath, id) {
    const found = listCheckpoints(rawPath).find(c => c.id === id);
    return found ? found.text : null;
  }

  function removeCheckpoint(rawPath, id) {
    const e = getEntry(rawPath);
    if (!e || !e.checkpoints) return false;
    const i = e.checkpoints.findIndex(c => c.id === id);
    if (i < 0) return false;
    e.checkpoints.splice(i, 1);
    return true;
  }

  // Project-wide stamp: one shared label across every text file that
  // differs from its baseline. Matches "apply intent across five
  // chapters, then revert them together".
  function checkpointProject(label) {
    const stamped = [];
    for (const e of project.entries.values()) {
      const t = getText(e.path);
      if (t === null) continue;
      const base = baselineOf(e.path);
      if (typeof base === 'string' && base === t) continue;  // unchanged
      if (addCheckpoint(e.path, label)) stamped.push(e.path);
    }
    return stamped;
  }

  function isDirty(rawPath) {
    const base = baselineOf(rawPath);
    if (typeof base !== 'string') return false;
    const t = getText(rawPath);
    return t !== null && t !== base;
  }

  const getEntry = (rawPath) => {
    const p = normalisePath(rawPath);
    return p === null ? undefined : project.entries.get(p);
  };

  // Decoded text for a viewable entry. Lazily decoded and cached, so a
  // file opened repeatedly is only decoded once. Returns null for
  // binary entries and for anything that is not valid UTF-8.
  function getText(rawPath) {
    const e = getEntry(rawPath);
    if (!e) return null;
    if (e.text !== null) return e.text;
    if (!e.bytes) return null;
    try {
      e.text = new TextDecoder('utf-8', { fatal: true }).decode(e.bytes);
      return e.text;
    } catch { return null; }
  }

  // Write edited text back into an entry. Re-encodes bytes as well, so
  // the auxFiles projection never serves a stale copy: once a file stops
  // being the editor document it returns to the projection, and it must
  // carry the edits with it.
  function updateText(rawPath, text) {
    const e = getEntry(rawPath);
    if (!e || typeof text !== 'string') return false;
    if (e.text === text) return false;
    e.text = text;
    e.bytes = new TextEncoder().encode(text);
    e.dirty = true;
    return true;
  }

  // Stage 3: the conversion target is INDEPENDENT of the main document.
  // Only convertible entries may be targets; images, .sty and .bib are
  // rejected so the caller can simply not offer the affordance.
  function setConvertTarget(rawPath) {
    const e = getEntry(rawPath);
    if (!e || !e.convertible) return { ok: false, reason: 'not convertible' };
    project.convertTargetPath = e.path;
    return { ok: true, path: e.path, entry: e };
  }

  // A .tex with no \documentclass is a FRAGMENT: macros defined in the
  // parent preamble are undefined, and pandoc drops unknown inline
  // commands silently (content destruction, not tagging). Converting one
  // is legitimate — flag, don't fail — so this only reports.
  function targetIsFragment() {
    const p = project.convertTargetPath;
    if (!p) return false;
    const e = getEntry(p);
    if (!e || e.ext !== 'tex') return false;
    const t = getText(p);
    return t !== null && !t.includes('\\documentclass');
  }

  // Folders before files, then collated by name — so the Stage 1 tree
  // renderer does no sorting of its own.
  function listEntries() {
    return [...project.entries.values()].sort((a, b) =>
      collator.compare(a.dir, b.dir) || collator.compare(a.name, b.name));
  }

  // THE PROJECTION. resourceFiles.auxFiles is rebuilt from this after
  // every mutation. `include` is deliberately NOT consulted in Stage 0 —
  // wiring it in is the whole of Stage 2.
  function toAuxFiles() {
    const out = {};
    for (const e of project.entries.values()) {
      if (e.isMain) continue;          // stdin, never a file
      if (e.include === false) continue;   // Stage 2: excluded this run
      out[e.path] = e.bytes;
    }
    return out;
  }

  // ── Stage 2: include / exclude ────────────────────────────────────
  // Exclusion is STICKY across conversion runs: convert() rebuilds the
  // whole virtual filesystem from toAuxFiles() every time, so an
  // excluded file is simply absent that run. No cleanup, no leakage.
  //
  // Deliberately kept in the model rather than the tree, so the UI can
  // be replaced without moving any logic.

  function setInclude(rawPath, include) {
    const e = getEntry(rawPath);
    if (!e) return false;
    if (e.include === !!include) return false;
    e.include = !!include;
    return true;
  }

  // Every entry at or below a directory path. '' means the whole project.
  function entriesUnder(dir) {
    const d = dir ? normalisePath(dir) : '';
    return [...project.entries.values()].filter(e =>
      d === '' ? true : (e.path === d || e.path.startsWith(d + '/')));
  }

  // 'all' | 'none' | 'mixed' | 'empty' — drives the folder toggle and
  // the ", partly excluded" wording, which NVDA testing showed is far
  // clearer than aria-checked="mixed" (spoken as "half checked").
  function folderIncludeState(dir) {
    const kids = entriesUnder(dir).filter(e => !e.isMain);
    if (!kids.length) return 'empty';
    const inc = kids.filter(e => e.include !== false).length;
    if (inc === kids.length) return 'all';
    if (inc === 0) return 'none';
    return 'mixed';
  }

  // Cascade. The main document is skipped: it is stdin, so including or
  // excluding it is meaningless and would only confuse.
  function setFolderInclude(dir, include) {
    let changed = 0;
    for (const e of entriesUnder(dir)) {
      if (e.isMain) continue;
      if (e.include !== !!include) { e.include = !!include; changed++; }
    }
    return changed;
  }

  // Feeds the Stage 1 aria-describedby line, whose wording was verified
  // with NVDA: "47 files in 6 folders, 3 excluded. Converting main.tex."
  // Must stay ONE short sentence — it is spoken on every entry to the
  // panel. Must be rebuilt whenever the model changes. Must NOT be a
  // live region. (nvda-test/RESULTS-tree-patterns.md §follow-up)
  function summarise() {
    const dirs = new Set();
    let fileCount = 0, excludedCount = 0;
    for (const e of project.entries.values()) {
      fileCount++;
      if (e.include === false) excludedCount++;
      let d = e.dir;
      while (d) { dirs.add(d); d = dirOf(d); }
    }
    const target = project.convertTargetPath
      ? nameOf(project.convertTargetPath) : null;
    return { fileCount, folderCount: dirs.size, excludedCount, targetName: target };
  }

  function summaryText() {
    const s = summarise();
    let head = `${s.fileCount} file${s.fileCount === 1 ? '' : 's'}`;
    if (s.folderCount) head += ` in ${s.folderCount} folder${s.folderCount === 1 ? '' : 's'}`;
    if (s.excludedCount) head += `, ${s.excludedCount} excluded`;
    head += '.';
    return s.targetName ? `${head} Converting ${s.targetName}.` : head;
  }

  return {
    project, addFile, addFiles, removeFile, setMainDocument,
    getEntry, getText, updateText, setConvertTarget, targetIsFragment,
    setInclude, setFolderInclude, folderIncludeState,
    baselineOf, isDirty, addCheckpoint, listCheckpoints, checkpointText,
    removeCheckpoint, checkpointProject,
    listEntries, toAuxFiles, summarise, summaryText,
    // exposed for tests and for Stage 1
    normalisePath, detectWrapper, classify,
    _updateStatus: updateStatus,
  };
}
