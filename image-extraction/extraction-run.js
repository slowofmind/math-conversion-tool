// extraction-run.js — orchestrates a compile for figure extraction.
//
// STAGE 3 SCOPE: compile only. This module deliberately does NOT split
// externs, does NOT touch any source file, and does NOT write anything into
// the project model. It compiles, harvests, and reports. Everything that
// modifies the user's work arrives in Stages 4 and 5.
//
// See memoize-integration/DESIGN.md Stage 3, and problems P1-P4 there.
import { buildInjected } from './mmz-inject.js';
import { parseMmz, parseCcMemo, parseCMemo, normaliseSource,
         memoKind, memoHash } from './mmz-parser.js';
import { discoverFigureEnvironments, findCommandCandidates,
         maskComments } from './latex-scanner.js';
import { mapLineBlock } from './map-lines.js';
import { defaultEndpoint } from './busytex-loader.js';

export const EXTRACTION_RUN_VERSION = '0.5.0';

/**
 * Versions of the modules ACTUALLY LOADED in this page. A browser can serve
 * a stale copy of a module from HTTP cache even after a hard refresh of the
 * document, so reporting the on-disk version would be misleading — these are
 * read from the live imports.
 */
export async function loadedVersions() {
  const out = { 'extraction-run.js': EXTRACTION_RUN_VERSION };
  const mods = ['mmz-parser.js', 'mmz-inject.js', 'mmz-match.js',
                'mmz-rewrite.js', 'mmz-split.js', 'latex-scanner.js',
                'figure-extractor.js'];
  await Promise.all(mods.map(async n => {
    try {
      const m = await import('./' + n);
      out[n] = m.MODULE_VERSION || '(unmarked)';
    } catch (e) { out[n] = 'FAILED: ' + (e && e.message ? e.message : e); }
  }));
  return out;
}

const EARLY_BLOCK = '\\usepackage[extract=no]{memoize}';

/**
 * tcolorbox draws its own frame with TikZ, so a decorated box becomes a
 * tikzpicture the author never wrote: memoize externalises the skin, the
 * scanner cannot claim it, and the whole file is refused. It ALSO errors -
 * tcolorbox opens a tikzpicture and closes it as its own tcb@drawing, so
 * memoize's collargs collector meets the wrong \end.
 * Registering that internal drawing environment as nomemoize (memoize's
 * own advice style, = noop + disable) suppresses the skin while leaving an
 * author's figure INSIDE the box memoized, because tcolorbox typesets the
 * content into boxes BEFORE it draws the frame.
 * MEASURED 2026-09-09 on Ma PS01 / PS02 / PS16: 22 skin externs and 22
 * collargs errors cleared, non-tcolorbox extern count IDENTICAL before and
 * after (3/3, 11/11, 10/10). Nothing survived, so no second hook is needed.
 * Suppressing the whole tcolorbox scope instead was measured and REJECTED:
 * it returns ZERO externs for a box containing a real figure, i.e. it
 * silently destroys author figures. Do not "simplify" it to that.
 * Detection keys on the LOAD signal only, and must be TRANSITIVE - the
 * corpus loads tcolorbox through handout.sty, never directly. Keying on
 * \tcbox or \tcbset would also fire on a document that never LOADS the
 * package, where registering an undefined environment is UNTESTED.
 */
export const TCOLORBOX_SUPPRESSION =
  '\\makeatletter\\mmzset{auto={tcb@drawing}{nomemoize}}\\makeatother';

export function usesTcolorbox(texts) {
  const RE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const t of texts || []) {
    const masked = (() => {
      try { return maskComments(t); } catch { return t; }
    })();
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(masked)) !== null)
      if (m[1].split(',').some(p => p.trim() === 'tcolorbox')) return true;
  }
  return false;
}
/**
 * P3: the late block registers the figure environments memoize must hook.
 * `tikzangle` and `tikzcalibratedcircle` are Ma/Mb-specific — hardcoding
 * them would register environments a different document never defines, so
 * the list is DISCOVERED from the project's own sources.
 * discoverFigureEnvironments finds \newenvironment / \NewEnviron whose body
 * contains a figure hint (tikzpicture, \begin{axis}).
 */
export function buildLateBlock(texts) {
  const names = new Set();

  // pass 1: commands whose bodies draw (e.g. \@tikzanglecommand, \axes)
  const drawCmds = new Set();
  for (const t of texts) {
    let cands = [];
    try { cands = findCommandCandidates(t) || []; } catch { /* skip */ }
    for (const c of cands) if (c && c.name) drawCmds.add(c.name);

    // findCommandCandidates only recognises [a-zA-Z]+ command names, so
    // internal \@-prefixed commands (the usual style for a package's own
    // drawing routine) are invisible to it. Scan for those too.
    const masked = (() => { try { return maskComments(t); } catch { return t; } })();
    const CMD = /\\(?:re)?newcommand\s*\*?\s*\{\s*\\([\w@]+)\s*\}((?:\s*\[[^\]]*\])*)\s*\{/g;
    let cm;
    while ((cm = CMD.exec(masked)) !== null) {
      let depth = 1, i = CMD.lastIndex;
      while (i < masked.length && depth > 0) {
        const ch = masked[i];
        if (ch === '{' && masked[i - 1] !== '\\') depth++;
        else if (ch === '}' && masked[i - 1] !== '\\') depth--;
        i++;
      }
      const body = masked.slice(CMD.lastIndex, i - 1);
      if (/\\begin\s*\{tikzpicture\}|\\begin\s*\{axis\}/.test(body))
        drawCmds.add(cm[1]);
    }
  }

  // pass 2: environments that draw directly (the scanner's own answer)
  for (const t of texts) {
    let found = [];
    try { found = discoverFigureEnvironments(t) || []; } catch { /* skip */ }
    for (const e of found) {
      const n = typeof e === 'string' ? e : e.name;
      if (n && n !== 'tikzpicture') names.add(n);
    }
  }

  // pass 3: environments that DELEGATE to a drawing command. Matches
  //   \NewEnviron{name}[..]{ ...\drawcmd... }
  //   \newenvironment{name}[..]{ ...\drawcmd... }{...}
  const DEF = /\\(?:NewEnviron|newenvironment|RenewEnviron|renewenvironment)\s*\*?\s*\{([\w@]+)\}((?:\s*\[[^\]]*\])*)\s*\{/g;
  for (const t of texts) {
    const masked = (() => { try { return maskComments(t); } catch { return t; } })();
    let m;
    while ((m = DEF.exec(masked)) !== null) {
      const name = m[1];
      if (!name || name === 'tikzpicture' || names.has(name)) continue;
      // read the balanced body that starts at the brace we just matched
      let depth = 1, i = DEF.lastIndex;
      while (i < masked.length && depth > 0) {
        const ch = masked[i];
        if (ch === '{' && masked[i - 1] !== '\\') depth++;
        else if (ch === '}' && masked[i - 1] !== '\\') depth--;
        i++;
      }
      const body = masked.slice(DEF.lastIndex, i - 1);
      const delegates = [...body.matchAll(/\\([\w@]+)/g)]
        .some(c => drawCmds.has(c[1]));
      if (delegates || /tikzpicture|\\begin\s*\{axis\}/.test(body)) names.add(name);
    }
  }
  const lines = ['\\mmzset{no memo dir}', '\\mmzset{padding=2pt}'];
  // tcolorbox skins would otherwise arrive as unclaimable externs AND
  // break the compile; see TCOLORBOX_SUPPRESSION above.
  const suppressions = [];
  if (usesTcolorbox(texts)) {
    lines.push(TCOLORBOX_SUPPRESSION);
    suppressions.push('tcb@drawing');
  }
  for (const n of [...names].sort())
    lines.push(`\\mmzset{auto={${n}}{memoize}}`);
  return { block: lines.join('\n'), environments: [...names].sort(),
           suppressions };
}

/**
 * P2: compile scope is DERIVED, not chosen.
 *  - target has \documentclass and it is not `subfiles`  -> it is the master
 *  - target is \documentclass[main]{subfiles}            -> use the named master
 *  - target has no \documentclass (a fragment)           -> REFUSE and explain
 * Per the 2026-09-06 decision, fragments are fixed by hand in the editor for
 * now rather than having their master inferred.
 */
export function resolveCompileTarget(targetPath, getText, listPaths) {
  const text = getText(targetPath);
  if (text == null) return { ok: false, reason: `cannot read ${targetPath}` };

  const dc = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(text);
  if (!dc) {
    return { ok: false, kind: 'fragment', reason:
      `${targetPath} has no \\documentclass, so it cannot be compiled on its ` +
      `own. Open the file that includes it and run from there, or give this ` +
      `file its own preamble.` };
  }
  if (dc[2].trim() !== 'subfiles')
    return { ok: true, kind: 'master', masterPath: targetPath };

  // subfiles: the option names the master, conventionally without extension
  const named = (dc[1] || 'main').trim().replace(/\.tex$/i, '');
  const all = listPaths();
  const hit = all.find(p => p === `${named}.tex`) ||
              all.find(p => p.endsWith(`/${named}.tex`)) ||
              all.find(p => p.toLowerCase().endsWith(`/${named.toLowerCase()}.tex`));
  if (!hit) return { ok: false, kind: 'subfile', reason:
    `${targetPath} is a subfile of "${named}", which is not in this project. ` +
    `Add the master file and try again.` };
  return { ok: true, kind: 'subfile', masterPath: hit, subfileOf: named };
}

/** Sort harvested project files into the pieces a split would need. */
function harvest(files) {
  const out = { mmz: null, mmzName: null, synctex: null,
                memos: { c: {}, cc: {} }, memoCount: 0, all: files };
  const dec = new TextDecoder('utf-8');
  for (const f of files) {
    const base = f.path.replace(/^.*[\\/]/, '');
    if (/\.mmz$/i.test(base)) { out.mmz = dec.decode(f.content); out.mmzName = f.path; }
    else if (/\.synctex\.gz$/i.test(base)) out.synctex = f.content;
    else if (/\.memo$/i.test(base)) {
      const text = dec.decode(f.content);
      const h = memoHash(base);
      if (memoKind(base) === 'cc') out.memos.cc[h] = parseCcMemo(text);
      else out.memos.c[h] = parseCMemo(text);
      out.memoCount++;
    }
  }
  return out;
}

/**
 * Compile the master with memoize injected, then harvest.
 *
 * @param {object} o
 * @param {object} o.engine        from busytex-loader.load()
 * @param {object} o.runner        from busytex-loader.getRunner()
 * @param {string} o.masterPath    project-relative path of the document
 * @param {function} o.getText     (path) -> string|null
 * @param {function} o.listPaths   () -> string[]
 * @param {function} [o.getBytes]  (path) -> Uint8Array|null, for binaries
 * @param {function} [o.onProgress]
 * @returns {Promise<object>} report — never throws for a failed COMPILE;
 *          throws only for a programming error.
 */
export async function compileForExtraction(o) {
  const { engine, runner, masterPath, getText, listPaths,
          getBytes = () => null, onProgress = () => {} } = o;
  const t0 = Date.now();
  const report = { masterPath, ok: false, stage: 'start', error: null,
                   pages: null, externs: null, memoCount: 0,
                   mmzPresent: false, synctexPresent: false,
                   environments: [], suppressions: [],
                   sourceCoverage: null, figures: [] };

  report.moduleVersions = await loadedVersions();

  const original = getText(masterPath);
  if (original == null) { report.error = `cannot read ${masterPath}`; return report; }

  // P3: discover figure environments across the WHOLE project — a figure
  // macro or environment may be defined in any .sty, not the main file.
  const paths = listPaths();
  const styTexts = paths.filter(p => /\.(sty|cls|tex)$/i.test(p))
    .map(p => getText(p)).filter(Boolean);
  const late = buildLateBlock(styTexts);
  report.environments = late.environments;
  report.suppressions = late.suppressions;

  // map lines go with the late block: after the document's own packages, so
  // nothing can overwrite them, and before \begin{document}.
  const lateFull = late.block + '\n' + mapLineBlock();
  const { injected, insertions } = buildInjected(original, EARLY_BLOCK, lateFull);
  report.insertions = insertions.map(i => ({ at: i.at, len: i.len }));
  // planRewrite must rebuild the IDENTICAL injected text to get the same
  // offset map, so record the exact blocks used.
  report.earlyBlock = EARLY_BLOCK;
  report.lateBlock = lateFull;

  // P1: every file goes into the virtual FS at its PROJECT-RELATIVE path.
  // \input and \usepackage resolve literally against the filesystem root,
  // and resource-path does not reach either (ENGINE-FINDINGS-311).
  const additionalFiles = [];
  for (const p of paths) {
    if (p === masterPath) continue;
    const t = getText(p);
    if (t != null) { additionalFiles.push({ path: p, content: t }); continue; }
    const b = getBytes(p);
    if (b) additionalFiles.push({ path: p, content: b });
  }
  report.filesSupplied = additionalFiles.length;

  try {
    report.stage = 'compile';
    onProgress('compiling', { files: additionalFiles.length });
    const res = await engine.compile({
      input: injected, verbose: 'info',
      additionalFiles, remoteEndpoint: defaultEndpoint,
    });
    report.compileMs = Date.now() - t0;
    report.exitCode = res.exitCode;
    report.pdfBytes = res.pdf ? res.pdf.length : 0;

    // pdfTeX hard-wraps its log at 79 columns, splitting tokens mid-name.
    const flat = (res.log || '').replace(/\r?\n/g, '');
    report.logTail = (res.log || '').split('\n').slice(-60).join('\n');
    report.pages = Number((/Output written[^(]*\((\d+) pages/.exec(flat) || [])[1]) || null;
    report.externs = Number((/produced (\d+) new extern/.exec(flat) || [])[1]);
    report.fontNotFound = /Font \S+ at \d+ not found/.test(flat);
    report.remoteFiles = new Set([...flat.matchAll(/texlive_remote\/\d+_([\w.+-]+)/g)]
      .map(m => m[1])).size;
    if (!res.success) {
      report.error = 'compile failed';
      report.firstError = ((res.log || '').match(/^!.*$/m) || [])[0] || null;
      return report;
    }
    report.pdf = res.pdf;
  } catch (err) {
    report.error = String(err && err.message ? err.message : err);
    return report;
  }

  try {
    report.stage = 'harvest';
    onProgress('harvesting');
    const h = harvest(await runner.readProjectFiles());
    report.mmzPresent = !!h.mmz;
    report.synctexPresent = !!h.synctex;
    report.memoCount = h.memoCount;
    if (h.mmz) {
      const man = parseMmz(h.mmz);
      report.figures = man.externs.map((e, i) => ({
        id: `dc-fig-${String(i + 1).padStart(3, '0')}`,
        // matchExterns reads sourcePage (the harness manifest's field name);
        // page is kept for readability. Emit both.
        page: e.page, sourcePage: e.page, hash: e.hash,
        mmzSource: h.memos.c[e.hash] || null,
        mmzSourceNormalised: normaliseSource(h.memos.c[e.hash]) || null,
      }));
      const withSrc = report.figures.filter(f => f.mmzSource).length;
      report.sourceCoverage = `${withSrc}/${report.figures.length}`;
      report.harvest = h;
    }
    report.ok = true;
    report.stage = 'done';
  } catch (err) {
    report.error = 'harvest failed: ' + String(err && err.message ? err.message : err);
  }
  report.totalMs = Date.now() - t0;
  return report;
}

/**
 * STAGE 4: split the extern pages into per-figure PDFs and write them into
 * the project model. ADDS files; modifies none. Source rewriting is Stage 5.
 *
 * Placement (decided 2026-09-06): ALONGSIDE THE SOURCE FILE, numbered
 * PER FILE. A figure from worksheets/12/ws12.tex becomes
 * worksheets/12/dc-fig-001.pdf. Per-file numbering REQUIRES per-file
 * placement — global numbering would be required for a flat root, and the
 * two cannot be mixed.
 *
 * @param {object} o
 * @param {object} o.report      the report from compileForExtraction
 * @param {function} o.addFile   (path, bytes, opts) -> void
 * @param {function} o.hasFile   (path) -> boolean
 * @param {function} [o.onProgress]
 * @param {boolean} [o.overwrite] permit replacing existing dc-fig-*.pdf
 */
export async function splitAndWrite(o) {
  const { report, addFile, hasFile, projectPaths = [],
          onProgress = () => {}, overwrite = false } = o;
  const out = { ok: false, written: [], skipped: [], unclaimed: [],
                collisions: [], error: null };

  if (!report || !report.ok) { out.error = 'compile did not succeed'; return out; }
  if (!report.harvest || !report.harvest.mmz) { out.error = 'no .mmz harvested'; return out; }
  if (!report.pdf) { out.error = 'no PDF from the compile'; return out; }

  const { parseSynctex } = await import('./mmz-match.js');
  const { splitExterns } = await import('./mmz-split.js');
  const { parseMmz } = await import('./mmz-parser.js');

  const manifest = parseMmz(report.harvest.mmz);

  // Build page -> source file from SyncTeX. A claim carries no file; the
  // Input: table does, and it is the only thing that can attribute a figure
  // to a subfile.
  let pageFile = new Map();
  if (report.harvest.synctex) {
    const { files, pages } = await parseSynctex(report.harvest.synctex);
    const known = new Set(projectPaths);
    // tag -> project-relative path, for local files only. main.tex is the
    // engine's job name for the injected master — map it back (see
    // planRewrite for the full explanation).
    const localTag = new Map();
    for (const [tag, raw] of files) {
      const p = String(raw).replace(/^\.?\//, '');
      if (/^main\.tex$/i.test(p) || /[\\/]main\.tex$/i.test(p)) {
        localTag.set(tag, report.masterPath); continue;
      }
      if (known.has(p)) { localTag.set(tag, p); continue; }
      const base = p.replace(/^.*[\\/]/, '');
      const hit = projectPaths.find(q => q === base || q.endsWith('/' + base));
      if (hit) localTag.set(tag, hit);
    }
    for (const [page, byTag] of pages) {
      let best = null, bestN = 0;
      for (const [tag, lines] of byTag) {
        if (!localTag.has(tag)) continue;
        let n = 0;
        for (const c of lines.values()) n += c;
        if (n > bestN) { bestN = n; best = localTag.get(tag); }
      }
      if (best) pageFile.set(page, best);
    }
  }

  onProgress('splitting', { count: manifest.externs.length });
  const results = await splitExterns(report.pdf, manifest, {
    renderSvg: false,
    onProgress: (n, total) => onProgress('splitting', { n, total }),
  });

  // Per-file numbering restarts at 001 in each directory. Per-file numbering
  // REQUIRES per-file placement; global numbering would be required for a
  // flat root, and the two cannot be mixed.
  const perDir = new Map();
  for (const r of results) {
    if (r.error) { out.skipped.push({ id: r.id, reason: r.error }); continue; }
    const srcPath = pageFile.get(r.page) || report.masterPath || '';
    const dir = srcPath.includes('/') ? srcPath.slice(0, srcPath.lastIndexOf('/')) : '';
    const n = (perDir.get(dir) || 0) + 1;
    perDir.set(dir, n);
    const name = 'dc-fig-' + String(n).padStart(3, '0') + '.pdf';
    const path = dir ? dir + '/' + name : name;

    if (hasFile(path) && !overwrite) { out.collisions.push(path); continue; }
    addFile(path, r.bytes, { source: 'derived' });
    out.written.push({ id: r.id, path, page: r.page, bytes: r.bytes.length,
      sourceFile: srcPath || null,
      sizeCheck: r.sizeCheck, confidence: r.confidence || null });
  }

  out.ok = out.collisions.length === 0 && out.skipped.length === 0;
  if (out.collisions.length)
    out.error = out.collisions.length + ' file(s) already exist: ' +
      out.collisions.slice(0, 3).join(', ');
  else if (out.skipped.length)
    out.error = out.skipped.length + ' extern(s) failed to split';
  return out;
}

// ─── STAGE 5: rewrite sources ────────────────────────────────────────────
// THE FIRST STAGE THAT MODIFIES THE USER'S FILES. Everything before this is
// additive and reversible by deletion.
//
// Two safeguards, both independent of TikZ or any figure package:
//  1. OFFSET MAP — claims are measured against the INJECTED master (PS16:
//     +6 lines / +157 chars). Only the master is injected; every other file
//     maps identity. Getting this wrong silently comments out the wrong
//     block.
//  2. RECORDED-TEXT CHECKSUM — each claim carries the exact bytes it spanned
//     at build time; the text at the translated range must match byte for
//     byte before anything is written. A checksum, not a pattern, so it
//     behaves the same for tikzpicture, \axes, a custom macro, or a drawing
//     mechanism nobody has seen.

/**
 * Build a rewrite PLAN without touching anything. Returns a per-file list of
 * what WOULD be commented out — the D7 dry run.
 */
export async function planRewrite(o) {
  const { report, getText, projectPaths = [], masterName = 'main.tex' } = o;
  const plan = { ok: false, error: null, files: [], untouched: [],
                 totalEdits: 0, warnings: [] };
  if (!report || !report.ok) { plan.error = 'compile did not succeed'; return plan; }
  if (!report.harvest || !report.harvest.synctex) {
    plan.error = 'no SyncTeX harvested — cannot attribute figures to files';
    return plan;
  }

  const { parseSynctex, mainTag, buildClaims, matchExterns } =
    await import('./mmz-match.js');
  const { buildInjected } = await import('./mmz-inject.js');
  const { rewrite } = await import('./mmz-rewrite.js');

  const { files, pages } = await parseSynctex(report.harvest.synctex);

  // tag -> project-relative path, local files only
  const known = new Set(projectPaths);
  const tagPath = new Map();
  for (const [tag, raw] of files) {
    const p = String(raw).replace(/^\.?\//, '');
    // *** The engine compiles the injected master under the job name "main",
    // so SyncTeX calls it main.tex regardless of its project path. Map it
    // back. Real subfiles keep their project-relative names. ***
    if (/^main\.tex$/i.test(p) || /[\\/]main\.tex$/i.test(p)) {
      tagPath.set(tag, report.masterPath);
      continue;
    }
    if (known.has(p)) { tagPath.set(tag, p); continue; }
    const base = p.replace(/^.*[\\/]/, '');
    const hit = projectPaths.find(q => q === base || q.endsWith('/' + base));
    if (hit) tagPath.set(tag, hit);
  }

  // which file produced each extern page
  const pageFile = new Map(), pageTag = new Map();
  for (const [page, byTag] of pages) {
    let best = null, bestTag = null, bestN = 0;
    for (const [tag, lines] of byTag) {
      if (!tagPath.has(tag)) continue;
      let n = 0; for (const c of lines.values()) n += c;
      if (n > bestN) { bestN = n; best = tagPath.get(tag); bestTag = tag; }
    }
    if (best) { pageFile.set(page, best); pageTag.set(page, bestTag); }
  }

  // group figures by source file
  const byFile = new Map();
  for (const f of report.figures) {
    const p = pageFile.get(f.page) || report.masterPath;
    if (!byFile.has(p)) byFile.set(p, []);
    byFile.get(p).push(f);
  }

  const styTexts = projectPaths.filter(p => /\.(sty|cls)$/i.test(p))
    .map(n => ({ name: n, text: getText(n) })).filter(x => x.text);

  for (const [path, figs] of byFile) {
    const original = getText(path);
    if (original == null) {
      plan.warnings.push(`${path}: cannot read; skipped`);
      continue;
    }
    // ONLY the master is injected, so only it needs an offset map.
    let claimText = original, insertions = [];
    if (path === report.masterPath) {
      const built = buildInjected(original, report.earlyBlock || '',
                                  report.lateBlock || '');
      claimText = built.injected;
      insertions = built.insertions;
    }
    const claims = buildClaims(claimText, report.environments || [], styTexts);
    const tag = pageTag.get(figs[0].page) || mainTag(files, masterName);
    const { rows, unmatchedClaims } = matchExterns(figs, claims, pages, tag);
    const res = rewrite(original, insertions, rows, unmatchedClaims, {
      externCount: figs.length,
      imageRef: id => {
        const w = (report.writtenFigures || []).find(x => x.id === id);
        return w ? w.path : id + '.pdf';
      },
    });
    // *** Suppression-aware diagnosis. If suppression WAS injected and a
    // tcolorbox skin still appears, the suppression is INCOMPLETE - an
    // internal drawing environment we have not registered - which is a
    // different fault from "the scanner missed a figure", and the hook names
    // are exactly what is needed to extend the registration. If it was NOT
    // injected, the tcolorbox load went undetected. Either way the REFUSAL
    // STANDS: never discard a claim-less extern, because an unknown one is
    // indistinguishable from a genuinely missed author figure. ***
    const suppressed = (report.suppressions || []).length > 0;
    for (const r of (res.report.refusals || [])) {
      const fig = figs.find(f => f.id === r.id);
      const hooks = [...new Set(((fig && fig.mmzSource) || '')
        .match(/\\tcb@[A-Za-z@]+/g) || [])];
      if (!hooks.length) continue;
      r.cause = suppressed ? 'tcolorbox-suppression-incomplete' : 'tcolorbox-skin-undetected';
      r.hooks = hooks;
      r.reason = (r.reason || 'refused') + (suppressed
        ? ` -- tcolorbox skin SURVIVED suppression; unregistered internal(s): ` +
          hooks.join(' ')
        : ` -- tcolorbox skin, but suppression was not injected (tcolorbox load ` +
          `not detected in this project)`);
      plan.warnings.push(`${path}: ${r.id} is a tcolorbox skin (${r.cause})`);
    }

    plan.files.push({
      path, figures: figs.length,
      ok: res.ok, reason: res.report.reason || null,
      edits: (res.report.edits || []).map(e => ({
        id: e.id, shape: e.shape, confidence: e.confidence,
        firstLine: original.slice(e.from, e.to).split('\n')[0].trim().slice(0, 90),
        lines: original.slice(0, e.from).split('\n').length + '-' +
               original.slice(0, e.to).split('\n').length,
      })),
      refusals: res.report.refusals || [],
      opaqueWarnings: res.report.warnings || [],
      untouchedClaims: (res.report.untouched || []).length,
      newText: res.rewritten,
    });
    plan.totalEdits += (res.report.edits || []).length;
  }

  plan.untouched = projectPaths.filter(p => /\.tex$/i.test(p) &&
    !byFile.has(p) && p !== report.masterPath);
  plan.ok = plan.files.length > 0 && plan.files.every(f => f.ok);
  if (!plan.ok && !plan.error)
    plan.error = plan.files.filter(f => !f.ok)
      .map(f => `${f.path}: ${f.reason || 'refused'}`).join('; ') || 'nothing to rewrite';
  return plan;
}

/** Human-readable dry run — the D7 per-file list of what will be commented out. */
export function describePlan(plan) {
  const L = [];
  if (!plan.ok) L.push('THIS PLAN WILL NOT BE APPLIED: ' + (plan.error || 'refused'));
  for (const f of plan.files) {
    L.push(`${f.path} — ${f.edits.length} figure(s)`);
    for (const e of f.edits)
      L.push(`    lines ${e.lines}: ${e.firstLine}`);
    for (const r of f.refusals) L.push(`    REFUSED ${r.id}: ${r.reason}`);
    for (const w of f.opaqueWarnings)
      L.push(`    WARNING ${w.id}: inside \\${w.wrapper} — Pandoc discards that ` +
             `content, so this image will not reach the output`);
    if (f.untouchedClaims)
      L.push(`    (${f.untouchedClaims} figure(s) left as-is — not produced by ` +
             `this build mode)`);
  }
  if (plan.untouched.length)
    L.push(`\nNot reached by this compile, left untouched: ${plan.untouched.join(', ')}`);
  for (const w of plan.warnings) L.push('NOTE ' + w);
  return L.join('\n');
}

/**
 * Apply a plan. ONE project-wide checkpoint for the whole batch, so the
 * entire rewrite reverts as a unit.
 *
 * NOTE the revert is TEXT ONLY: checkpointProject() skips binary entries and
 * has no concept of added or removed files, so extracted images survive a
 * revert. Callers must say so plainly (D9).
 */
export function applyRewrite(plan, o) {
  const { updateText, checkpointProject, replaceInEditor = () => false,
          label = 'Figure extraction' } = o;
  const out = { ok: false, applied: [], error: null, checkpoint: null };
  if (!plan.ok) { out.error = plan.error || 'plan refused'; return out; }

  try {
    out.checkpoint = checkpointProject(label);
  } catch (err) {
    out.error = 'could not checkpoint: ' + (err && err.message ? err.message : err);
    return out;
  }

  for (const f of plan.files) {
    if (!f.newText) continue;
    updateText(f.path, f.newText);
    // the editor holds the live copy for an open file and would overwrite
    // the model on the next switch, so it must be told too
    const inEditor = replaceInEditor(f.path, f.newText);
    out.applied.push({ path: f.path, edits: f.edits.length, inEditor });
  }
  out.ok = true;
  return out;
}

// ─── STAGE 6: hand the extracted PDFs to the existing MuPDF chain ────────
// The memoize toolchain is a PREFIX onto the MuPDF chain (2026-09-06
// decision): it writes per-figure PDFs into the project and rewrites the
// source to reference them, and MuPDF then converts them exactly as it does
// user-uploaded PDF images. MuPDF needs no knowledge of memoize.
//
// *** POLICY IS A PARAMETER, NOT BAKED IN. *** The user has foreseen wanting:
// intermediates preserved for use outside the platform; uploaded PDFs
// converted only on request; and a fully automatic mode. None of that is
// designed yet, so the shape below keeps each choice as a flag rather than
// a hardcoded behaviour.

/** Default policy. Extracted PDFs are intermediates: convert, do not keep. */
export const DEFAULT_FIGURE_POLICY = {
  // Convert the figures this toolchain extracted. Deliberately INDEPENDENT
  // of opt-pdf-image-mode: that setting governs the user's OWN uploaded
  // assets, whereas an extracted PDF exists only as scaffolding and would
  // otherwise reach HTML as an <img src="*.pdf"> that no browser renders.
  // FALSE since 2026-09-09: conversion is a MANUAL action covering
  // uploaded and extracted PDFs together. The chain stops at rewrite.
  // See pdf-conversion-design/DESIGN.md.
  convertExtracted: false,
  // Re-add the .pdf next to the .svg after conversion, for use outside the
  // platform. Off by default — the original figure code also survives,
  // commented, in the source.
  keepIntermediatePdf: false,
};

/**
 * @param {object} o
 * @param {Array}  o.written        splitAndWrite().written
 * @param {function} o.convert      (names[]) -> Promise<{converted,failed,details}>
 *                                  i.e. the platform's processPdfAuxFiles
 * @param {function} [o.getBytes]   (path) -> Uint8Array|null
 * @param {function} [o.addFile]    (path, bytes, opts) -> void
 * @param {function} [o.hasFile]    (path) -> boolean
 * @param {object}  [o.policy]
 */
export async function convertExtractedFigures(o) {
  const { written = [], convert, getBytes = () => null,
          addFile = () => {}, hasFile = () => false,
          policy = DEFAULT_FIGURE_POLICY, onProgress = () => {} } = o;
  const out = { ok: false, skipped: false, converted: 0, failed: 0,
                details: [], kept: [], error: null };

  if (!policy.convertExtracted) {
    out.ok = true; out.skipped = true;
    out.details.push('conversion disabled by policy');
    return out;
  }
  const names = written.map(w => w.path).filter(p => /\.pdf$/i.test(p));
  if (!names.length) { out.ok = true; out.details.push('no PDFs to convert'); return out; }

  // capture the bytes first if we are to preserve the intermediates —
  // the converter removes the .pdf entry as part of replacing it
  const saved = new Map();
  if (policy.keepIntermediatePdf)
    for (const p of names) { const b = getBytes(p); if (b) saved.set(p, b); }

  onProgress('converting', { count: names.length });
  let res;
  try { res = await convert(names); }
  catch (err) { out.error = String(err && err.message ? err.message : err); return out; }

  out.converted = res.converted || 0;
  out.failed = res.failed || 0;
  out.details = res.details || [];

  if (policy.keepIntermediatePdf) {
    for (const [p, b] of saved) {
      if (hasFile(p)) continue;                 // converter left it in place
      addFile(p, b, { source: 'derived' });
      out.kept.push(p);
    }
  }
  out.ok = out.failed === 0;
  if (!out.ok) out.error = `${out.failed} figure(s) failed to convert`;
  return out;
}
