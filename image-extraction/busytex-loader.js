// busytex-loader.js — on-demand loading of the BusyTeX engine and TeX Live
// data package.
//
// *** PRINCIPLE 1 OF THE INTEGRATION DESIGN: NOTHING HERE RUNS ON PAGE LOAD. ***
// No top-level fetch, no top-level import of the pipeline, no side effects at
// module scope. A user who never presses the button must not be able to tell
// this exists. There is a headless test asserting zero BusyTeX network
// requests on page load; it is the guard on that promise.
//
// Tier decision (see DESIGN.md sec.3): texlive-basic (86.6 MB) + the remote
// endpoint + a map-line bundle. basic produces BYTE-IDENTICAL output to
// recommended on a real document, fits GitHub's 100 MB per-file limit, and
// initialises faster. The cost is ~13 s more per cold compile from streaming
// ~233 files instead of ~87.

export const BUSYTEX_LOADER_VERSION = '0.1.0';

/** Approximate download, for the confirmation dialog. */
export const ASSET_SIZE_MB = 120;      // wasm 31 + texlive-basic.data 86.6 + loader ~2

/** Emscripten's own cache database — see the data package loader source:
 *  var DB_NAME = "EM_PRELOAD_CACHE"; indexedDB.open(DB_NAME, DB_VERSION).
 *  Deleting it is how "remove downloaded components" works. */
export const CACHE_DB_NAME = 'EM_PRELOAD_CACHE';

const PIPELINE_URL = 'https://cdn.jsdelivr.net/npm/texlyre-busytex@1/+esm';
const DEFAULT_ENDPOINT = 'https://texlive2026.texlyre.org';
const DEFAULT_TIER = 'basic';

const state = {
  status: 'idle',       // idle | loading | ready | error
  runner: null,
  engine: null,
  error: null,
  loadedAt: null,
};

export function getStatus() { return state.status; }
export function isLoaded() { return state.status === 'ready'; }
export function getError() { return state.error; }
export function getEngine() { return state.engine; }
export function getRunner() { return state.runner; }

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
 * Load the engine. Called ONLY from an explicit user action.
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
    onProgress('fetching-pipeline');
    const { BusyTexRunner, PdfLatex } = await import(/* webpackIgnore: true */ PIPELINE_URL);

    onProgress('initialising', { tier });
    const runner = new BusyTexRunner({
      busytexBasePath: basePath,
      verbose: false,
      preloadDataPackages: [`${basePath}/texlive-${tier}.js`],
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
