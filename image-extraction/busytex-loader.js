// busytex-loader.js — on-demand loading of the BusyTeX engine and TeX Live
// data package.
//
// *** PRINCIPLE 1, AS REVISED 2026-09-30: NOTHING HERE RUNS AT MODULE SCOPE. ***
// No top-level fetch, no top-level import of the pipeline, no side effects at
// module scope; only prepare() and load() fetch anything, and only when called.
// Until 2026-09-30 the engine loaded only when a user pressed the button. Then
// Nicholas decided: "I want for busytex to download automatically in the
// background after index.html and the other main features download." So the
// platform starts prepare() once Pandoc WASM is ready (plan step 3 in
// auto-image-handling\NOTE-AUTO-IMAGE-HANDLING.md), and the headless test that
// asserts zero BusyTeX requests on page load becomes "none before Pandoc is
// ready" (plan step 4).
//
// Tier decision (see DESIGN.md sec.3): texlive-basic (88.5 MB in 1.4.0) + the remote
// endpoint + a map-line bundle. basic produces BYTE-IDENTICAL output to
// recommended on a real document, fits GitHub's 100 MB per-file limit, and
// initialises faster. The cost is ~13 s more per cold compile from streaming
// ~233 files instead of ~87.

export const BUSYTEX_LOADER_VERSION = '0.2.0';

/** The BusyTeX release this loader is pinned to. The library (PIPELINE_URL)
 *  and the engine files in image-extraction/core/busytex/ must come from the
 *  SAME release: each library version expects its own release's files (the
 *  1.4.0 worker requires busytex_biber.js, which 1.2.0 did not have). Change
 *  both together; see NOTE-AUTO-IMAGE-HANDLING.md, plan step 1. */
export const BUSYTEX_VERSION = '1.4.0';

/** Approximate download, for the confirmation dialog. */
export const ASSET_SIZE_MB = 122;      // 1.4.0: wasm 31.0 + texlive-basic.data 88.5 + the rest 2.8

/** Emscripten's own cache database — see the data package loader source:
 *  var DB_NAME = "EM_PRELOAD_CACHE"; indexedDB.open(DB_NAME, DB_VERSION).
 *  Deleting it is how "remove downloaded components" works. */
export const CACHE_DB_NAME = 'EM_PRELOAD_CACHE';

const PIPELINE_URL = `https://cdn.jsdelivr.net/npm/texlyre-busytex@${BUSYTEX_VERSION}/+esm`;
const DEFAULT_ENDPOINT = 'https://texlive2026.texlyre.org';
const DEFAULT_TIER = 'basic';

const state = {
  status: 'idle',       // idle | loading | ready | error
  runner: null,
  engine: null,
  error: null,
  loadedAt: null,
};

// The background prepare (see prepare() below). Kept apart from `state`: a
// prepare never leaves an engine behind, only a warm browser cache.
const prep = {
  status: 'idle',       // idle | preparing | done | failed | skipped
  promise: null,        // set once: a prepare runs at most once per page
  error: null,
  ms: null,
};

export function getStatus() { return state.status; }
export function isLoaded() { return state.status === 'ready'; }
export function getError() { return state.error; }
export function getEngine() { return state.engine; }
export function getRunner() { return state.runner; }
export function getPrepareStatus() { return prep.status; }
export function getPrepareError() { return prep.error; }

/**
 * Is the data package already cached from a previous visit? Read-only —
 * opening the database does not download anything. Used to decide whether
 * the confirm dialog should mention a download at all.
 */
export async function isCached() {
  try {
    if (!('indexedDB' in globalThis)) return false;
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      return dbs.some(d => d.name === CACHE_DB_NAME);
    }
    // Firefox lacks databases(); probe without creating (onupgradeneeded means
    // it did not exist, so abort and delete the empty shell we just made).
    return await new Promise(resolve => {
      let existed = true;
      const req = indexedDB.open(CACHE_DB_NAME);
      req.onupgradeneeded = () => { existed = false; };
      req.onsuccess = () => {
        req.result.close();
        if (!existed) indexedDB.deleteDatabase(CACHE_DB_NAME);
        resolve(existed);
      };
      req.onerror = () => resolve(false);
    });
  } catch { return false; }
}

/**
 * Background prepare: initialise the engine once so that the browser keeps
 * what it downloads (the TeX Live data package in IndexedDB, the engine files
 * in its HTTP cache), then terminate the worker to free its memory. load()
 * then starts from cache. Decision 2026-09-30: "Cached and started on demand
 * seems fine; we can change it later if it turns out to be a problem".
 *
 * Always a real initialisation, never a cache check: the library's
 * isPackageCached() matches by FILE NAME, so it would call an older release's
 * data current. The data package's own loader compares package_uuid (the
 * SHA-256 of the .data file) and downloads afresh on a mismatch.
 *
 * Runs at most once per page; later calls return the same promise. Skipped if
 * load() has already started. Never rejects: a failure is recorded
 * (getPrepareStatus, getPrepareError) and load() then initialises in full.
 * @param {object} opts  as for load()
 * @returns {Promise<void>}
 */
export function prepare({ basePath, tier = DEFAULT_TIER,
                          onProgress = () => {} } = {}) {
  if (prep.promise) return prep.promise;
  if (state.status !== 'idle') {             // the button got there first
    prep.status = 'skipped';
    prep.promise = Promise.resolve();
    return prep.promise;
  }
  prep.status = 'preparing';
  prep.promise = (async () => {
    const t0 = (globalThis.performance || Date).now();
    let runner = null;
    try {
      onProgress('fetching-pipeline');
      const { BusyTexRunner } = await import(/* webpackIgnore: true */ PIPELINE_URL);
      onProgress('initialising', { tier });
      runner = new BusyTexRunner({
        busytexBasePath: basePath,
        verbose: false,
        preloadDataPackages: [`${basePath}/texlive-${tier}.js`],
        onDownloadProgress: (p) => onProgress('downloading', p),
      });
      await runner.initialize(true);          // true = run in a Web Worker
      prep.ms = Math.round((globalThis.performance || Date).now() - t0);
      prep.status = 'done';
      onProgress('prepared', { ms: prep.ms });
    } catch (err) {
      prep.status = 'failed';
      prep.error = String(err && err.message ? err.message : err);
      onProgress('prepare-failed', { error: prep.error });
    } finally {
      try { if (runner) runner.terminate(); } catch { /* best effort */ }
    }
  })();
  return prep.promise;
}

/**
 * Load the engine, when the user presses the button. If a background
 * prepare() is still running this waits for it, so nothing downloads twice;
 * if the prepare failed, this full initialisation is the retry.
 * @param {object} opts
 * @param {string} opts.basePath   directory holding busytex.wasm + the tier
 * @param {string} opts.tier       'basic' (default) | 'recommended'
 * @param {function} opts.onProgress  (phase, detail) => void
 */
export async function load({ basePath, tier = DEFAULT_TIER,
                             onProgress = () => {} } = {}) {
  if (state.status === 'ready') return state.engine;
  if (state.status === 'loading') throw new Error('already loading');
  state.status = 'loading';
  state.error = null;
  const t0 = (globalThis.performance || Date).now();

  try {
    if (prep.status === 'preparing') {       // it never rejects; see prepare()
      onProgress('waiting-for-prepare');
      await prep.promise;
    }
    onProgress('fetching-pipeline');
    const { BusyTexRunner, PdfLatex } = await import(/* webpackIgnore: true */ PIPELINE_URL);

    onProgress('initialising', { tier });
    const runner = new BusyTexRunner({
      busytexBasePath: basePath,
      verbose: false,
      preloadDataPackages: [`${basePath}/texlive-${tier}.js`],
      onDownloadProgress: (p) => onProgress('downloading', p),
    });
    await runner.initialize(true);            // true = run in a Web Worker

    state.runner = runner;
    state.engine = new PdfLatex(runner);
    state.status = 'ready';
    state.loadedAt = Date.now();
    onProgress('ready', {
      ms: Math.round((globalThis.performance || Date).now() - t0) });
    return state.engine;
  } catch (err) {
    state.status = 'error';
    state.error = String(err && err.message ? err.message : err);
    onProgress('error', { error: state.error });
    throw err;
  }
}

export const defaultEndpoint = DEFAULT_ENDPOINT;

/**
 * Drop the in-memory engine. Does NOT touch the cached data package —
 * see removeCache() for that.
 */
export function unload() {
  try { if (state.runner && state.runner.terminate) state.runner.terminate(); }
  catch { /* best effort */ }
  state.runner = null;
  state.engine = null;
  state.status = 'idle';
  state.error = null;
  state.loadedAt = null;
}

/**
 * "Remove downloaded components": delete Emscripten's cached data package.
 * Unloads the engine first so nothing is left holding a half-removed cache.
 *
 * NOTE the user-facing wording should also say that clearing browsing data
 * (cookies and site data) removes this too — it is ordinary origin storage,
 * NOT something that survives a deliberate clear.
 *
 * @returns {Promise<{removed:boolean, reason?:string}>}
 */
export async function removeCache() {
  unload();
  if (!('indexedDB' in globalThis))
    return { removed: false, reason: 'no indexedDB in this browser' };
  return new Promise(resolve => {
    let settled = false;
    const done = r => { if (!settled) { settled = true; resolve(r); } };
    const req = indexedDB.deleteDatabase(CACHE_DB_NAME);
    req.onsuccess = () => done({ removed: true });
    req.onerror = () => done({ removed: false, reason: 'delete failed' });
    // fires when another tab still holds the database open
    req.onblocked = () => done({ removed: false,
      reason: 'another tab has the cache open — close other tabs and retry' });
    setTimeout(() => done({ removed: false, reason: 'timed out' }), 10000);
  });
}

/** One-line summary for the toolbar control. */
export function statusLabel() {
  switch (state.status) {
    case 'ready':   return 'Image handling: ready';
    case 'loading': return 'Loading image handling…';
    case 'error':   return 'Image handling: failed';
    default:        return 'Experimental image handling';
  }
}
