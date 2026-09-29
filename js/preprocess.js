// preprocess.js — PLAN-9 step E: the glue between the page and the
// latex-preprocess tool (the platform's preprocess/ copy, never edited here).
//
// Written by latex-preprocess session 51 to js/test-preprocess.mjs, which
// session 50 wrote first and saw fail. The test calls it as the page will:
//   initPreprocess({ model, editor, openProjectFile, syncAuxFiles,
//     runConversion, showReport, updateLog, updateStatus, loadTable,
//     loadTool }) -> { run }       run() is one press of the button.
// Every page function is passed in, and this module never touches
// `document` (judgement call 79), so it runs unchanged in Node and in the
// browser. The tool and its table load on the first press and are kept.
//
// One press (PLAN-9 section 1; calls 80 to 82 and 85; HANDOFF 30.4):
//  - an earlier tagged copy edited since the tool wrote it stops the run;
//    a copy on screen is judged by the editor's text, which the model
//    cannot see until it is captured (81);
//  - the target's original, and every included .tex, .sty and .cls not
//    tagged `preprocessed`, handed to the tool; the editor's file as the
//    editor's current text, never written into the model unless the run
//    succeeds; a tagged -pp target run as its original (80);
//  - a target the tool's own reading does not read as a document, asked
//    of the run's own result and never a text search, is refused (85);
//  - anything changed: a -pp name held by a file the tool did not make
//    stops the run; otherwise the tool's earlier files are removed, from
//    the project AND the editor, which would otherwise restore its old
//    copy (facade L320, L353), a -pp copy of each changed file plus the
//    target's own is saved, and that is opened and converted;
//  - nothing changed: the earlier files removed, the editor moved back to
//    the original if it was on one, the original converted (82).
// A stop writes nothing, converts nothing, and names its reason in the
// report and the log. Session 51's six choices, Nicholas's yes: a stop
// after the tool ran shows the reason only; the report shows before the
// conversion starts; a press during a press is ignored; with no target a
// press is refused; nothing changed with the editor off a copy returns
// only the target to the original; a failed load is not kept.

export const PREPROCESSED = 'preprocessed';   // the tag, PLAN-9 2.1
const HANDED_EXTS = ['tex', 'sty', 'cls'];

const nameOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const join = (dir, name) => (dir ? dir + '/' + name : name);
const message = (e) => (e && e.message ? e.message : String(e));
const splitName = (name) => {                // the last '.', as extOf finds it
  const i = name.lastIndexOf('.');
  return i <= 0 ? [name, ''] : [name.slice(0, i), name.slice(i)];
};

// The -pp path beside a file: the part before the last '.', plus -pp, the
// extension kept, the same folder. project-model.js's ppOriginalName is
// private, so it is mirrored here, both ways; E2c proves they agree
// through the model's own swap.
export function ppPathOf(path) {
  const [stem, tail] = splitName(nameOf(path));
  return join(dirOf(path), stem + '-pp' + tail);
}
export function originalPathOf(path) {
  const [stem, tail] = splitName(nameOf(path));
  if (stem.length <= 3 || !stem.endsWith('-pp')) return null;
  return join(dirOf(path), stem.slice(0, -3) + tail);
}

export function initPreprocess({ model, editor, openProjectFile, syncAuxFiles,
  runConversion, showReport, updateLog, updateStatus, loadTable, loadTool } = {}) {
  let loaded = null;       // { tool, capability }, kept only once a load succeeds
  let busy = false;        // a press during a press is ignored

  async function load() {
    if (loaded) return loaded;
    const tool = await loadTool();
    const table = await loadTable();
    const capability = tool.createCapability(table);   // the tool wants it built
    loaded = { tool, capability };
    return loaded;
  }

  // A stop: nothing written, nothing converted, the reason in both places.
  // updateLog and updateStatus in the page's own shapes (call 94,
  // latex-preprocess s55): updateLog([{ level, message }]),
  // js/log-display.js; updateStatus(state, text), index.html L2825.
  // E's stand-ins enforce both.
  function stop(reason) {
    showReport('Preprocess stopped: ' + reason);
    updateLog([{ level: 'error', message: 'Preprocess stopped: ' + reason }]);
    updateStatus('error', 'Preprocess stopped. See the Preprocess tab.');
    return false;
  }

  // Call 81. The copy on screen is judged by the editor's text against what
  // the tool wrote; any other copy by the model.
  function isEditedCopy(entry) {
    if (entry.path === model.project.mainPath) {
      const base = model.baselineOf(entry.path);
      return typeof base === 'string' && editor.getText() !== base;
    }
    return model.isDirty(entry.path);
  }

  // The tool's own earlier files, out of the project and out of the editor.
  function removeEarlier(entries) {
    for (const e of entries) {
      model.removeFile(e.path);
      editor.dropDocument(e.path);
    }
  }

  async function press() {
    const p = model.project;

    // 1. The tool and its table (79). A failed load is not kept.
    let tool, capability;
    try { ({ tool, capability } = await load()); } catch (e) {
      return stop(`the preprocessor could not be loaded (${message(e)}). ` +
        'Nothing was changed or converted.');
    }

    // 2. The target, run as its original if it is a tagged -pp copy (80).
    const target = p.convertTargetPath ? model.getEntry(p.convertTargetPath) : undefined;
    if (!target) return stop('there is no document to convert. Nothing was changed.');
    let entryPath = target.path;
    if (target.source === PREPROCESSED) {
      const orig = originalPathOf(target.path);
      const o = orig === null ? undefined : model.getEntry(orig);
      if (!o || o.source === PREPROCESSED)
        return stop(`${target.path} is a preprocessed copy whose original is not in ` +
          'the project. Nothing was changed or converted.');
      entryPath = o.path;
    }

    // 3. Call 81: an earlier copy edited since the tool wrote it.
    const earlier = [...p.entries.values()].filter((e) => e.source === PREPROCESSED);
    const edited = earlier.filter(isEditedCopy).map((e) => e.path);
    if (edited.length)
      return stop(`${edited.join(', ')} ${edited.length === 1 ? 'has' : 'have'} been ` +
        'edited since the preprocessor wrote ' + (edited.length === 1 ? 'it' : 'them') +
        '. Nothing was changed or converted.');

    // 4. What the tool is handed (80). The editor's file as the editor's text.
    const files = {};
    for (const e of p.entries.values()) {
      if (e.include === false || e.source === PREPROCESSED) continue;
      if (!HANDED_EXTS.includes(e.ext)) continue;
      const text = e.path === p.mainPath ? editor.getText() : model.getText(e.path);
      if (typeof text === 'string') files[e.path] = text;
    }

    // 5. The tool. A throw writes nothing. Then call 85, from the run itself.
    let result;
    try { result = tool.runProject(files, { capability, entry: entryPath }); } catch (e) {
      return stop(`the preprocessor failed on ${entryPath} (${message(e)}). ` +
        'Nothing was changed or converted.');
    }
    const documents = (result.project && result.project.documents) || [];
    if (!documents.includes(entryPath))
      return stop(`${entryPath} is not read as a document: the preprocessor finds no ` +
        '\\documentclass in it. Nothing was changed or converted.');
    let report;
    try { report = tool.renderReport(result, files); } catch (e) {
      return stop(`the preprocessor's report could not be made (${message(e)}). ` +
        'Nothing was changed or converted.');
    }

    // 6. What changed: the output differs from the input by even one
    // character (PLAN-9 2.2). Files the document never loads are not in
    // the output, so they never change.
    const changed = [...result.output.entries()]
      .filter(([path, text]) => text !== files[path]).map(([path]) => path);
    const onCopy = earlier.find((e) => e.path === p.mainPath);
    const listed = (xs) => xs.join(', ');

    if (changed.length) {
      // Each changed file's copy, plus the target's own, main-pp.tex.
      const wanted = [...new Set([entryPath, ...changed])].map((path) => [path, ppPathOf(path)]);
      const held = wanted.map(([, pp]) => pp).filter((pp) => {
        const e = model.getEntry(pp);
        return e !== undefined && e.source !== PREPROCESSED;
      });
      if (held.length)
        return stop(`${listed(held)} already ${held.length === 1 ? 'exists' : 'exist'} ` +
          `and ${held.length === 1 ? 'was' : 'were'} not made by the preprocessor. ` +
          'Nothing was changed or converted.');
      removeEarlier(earlier);
      for (const [path, pp] of wanted)
        model.addFile(pp, new TextEncoder().encode(result.output.get(path)),
          { source: PREPROCESSED });
      syncAuxFiles();
      const mainPp = ppPathOf(entryPath);
      showReport(report);
      updateLog([{ level: 'info', message: `Preprocess: ${listed(changed)} changed; saved ` +
        `${listed(wanted.map(([, pp]) => pp))}; converting ${mainPp}.` }]);
      updateStatus('loading', `Preprocessed. Converting ${mainPp}.`);
      await openProjectFile(model.getEntry(mainPp));
      await runConversion();
      return true;
    }

    // 7. Nothing changed (82): the earlier copies go; the editor back to the
    // original of the copy it was on; the target back to the original if it
    // was a copy; the original converted.
    removeEarlier(earlier);
    showReport(report);
    updateLog([{ level: 'info', message: `Preprocess: nothing in ${entryPath} needed changing` +
      (earlier.length ? `; removed the earlier copies ${listed(earlier.map((e) => e.path))}` : '') +
      `; converting ${entryPath}.` }]);
    updateStatus('loading', `Preprocessed: nothing to change. Converting ${entryPath}.`);
    if (onCopy) {
      const back = originalPathOf(onCopy.path);
      await openProjectFile((back !== null && model.getEntry(back)) || model.getEntry(entryPath));
    }
    if (!model.project.convertTargetPath) model.setConvertTarget(entryPath);
    syncAuxFiles();
    await runConversion();
    return true;
  }

  async function run() {
    if (busy) return false;
    busy = true;
    try { return await press(); } finally { busy = false; }
  }

  return { run };
}
