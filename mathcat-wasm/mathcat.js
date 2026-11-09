// mathcat-wasm/mathcat.js — the MathCAT engine for speech proofing.
//
// Plan: PLAN-MATHCAT-SPEECH-PROOFING.md, section 2.3.
//   M15  Location-independent: give it wasm bytes or a URL, get speak() back.
//        It knows nothing about the DOM, the preview, or messaging, so it can
//        run in the platform page (v1, M2), inside a sandboxed preview, or in
//        an exported page, unchanged.
//   M4   speak() returns what NVDA's speech viewer shows with the MathCAT NVDA
//        add-on and the default Windows OneCore voice ("eigh", no pause
//        punctuation).
//   M14  ...with whitespace collapsed to single spaces.
//   M8   Settings are fixed: the add-on's defaults with Verbosity = Verbose
//        (Nicholas, 2026-11-09: "I want "verbose" as the default, but I will want to add some controls at a later time to adjust that.").
//   M11  MathCAT errors come back as { ok: false, error }.
//
// Pinned build: MathCAT 0.7.7 = the MathCAT inside the NVDA add-on 0.7.7, as the
// NVDA Add-on Store serves it (since 2026-11-09; until then the MathCAT built
// into NVDA 2026.2, plan F1; mathcat-proofing-v2/NOTE-MATHCAT-UPGRADE-0.7.7.md).
// See VERSIONS.md before changing anything below the line "PINNED BUILD".

import init, * as mc from './mathcat_wasm.js';

// ---- PINNED BUILD (update together with mathcat-wasm.bin; VERSIONS.md) ----
export const PINNED_MATHCAT = '0.7.7';
// What the popup models; shown after "NVDA" in its info line and the console.
export const NVDA_SETUP = 'add-on, Verbose';
// sha1 of the raw (uncompressed) wasm. It is the cache-buster in the .bin
// URL, exactly as WASM_SHA1 is for pandoc-wasm: if it is not changed on an
// upgrade, browsers keep serving the previously cached payload.
export const WASM_SHA1 = 'cd71ab27120dcdfac84b1830c106b88f88d3ce19';   // MathCAT 0.7.7 build, 2026-11-09
// ---------------------------------------------------------------------------

export function defaultBinUrl() {
  return new URL(`./mathcat-wasm.bin?sha1=${WASM_SHA1}`, import.meta.url).href;
}

// Settings at startup, as the MathCAT NVDA add-on 0.7.7 sets them
// (globalPlugins/MathCAT/MathCAT.py, MathCAT.__init__): SetRulesDir, then
// TTS=SSML only. Every other setting comes from MathCAT's own prefs.yaml
// (embedded; build gate G1 checks it equals the add-on's) and the user's
// %APPDATA%\MathCAT\prefs.yaml. The modelled user changed one setting:
// Verbosity = Verbose (Nicholas, 2026-11-09). The add-on's defaults equal the
// values this list set explicitly for NVDA 2026.2, except Language (Auto),
// which speak() sets for every expression anyway (checked 2026-11-09).
const NVDA_STARTUP_PREFS = [
  ['TTS', 'SSML'],
  ['Verbosity', 'Verbose'],
];
// Set by the add-on's getSpeechForMathMl around every expression, after
// Language and SetMathML: IgnoreBold from NVDA's "Report highlighting"
// (default on, so "false"), then the capital-letter settings from the OneCore
// voice's defaults (configSpec.py; OneCore supports PitchCommand, so the pitch
// preference is sent too).
const NVDA_PER_EXPRESSION_PREFS = [
  ['IgnoreBold', 'false'],
  ['CapitalLetters_Beep', 'false'],
  ['CapitalLetters_UseWord', 'false'],
  ['CapitalLetters_Pitch', '30'],
];

// ---------------------------------------------------------------------------
// NVDA speech-viewer text, OneCore voice, English (plan F11, 2.3 step 5).
//
// Reproduces what convertSSMLTextForNVDA leaves as PLAIN STRINGS, joined the way
// speechViewer.appendSpeechSequence does (speechViewer.py: strings only,
// two-space separator). The function exists in the MathCAT NVDA add-on
// (globalPlugins/MathCAT/MathCAT.py, 0.7.7), modelled since 2026-11-09, and in
// NVDA (mathPres/MathCAT/speech.py, release-2026.2), modelled before; the parts
// that produce text are identical in both. Independent reimplementation of that
// behavior (NVDA is GPL-2.0, the add-on GPL v2 per the Add-on Store; no code is
// copied here); test T1b checks it against the add-on's own function,
// downloaded from the Store's package and run unmodified by nvda_reference.py.
//
// Token grammar, tried in this order at each position:
//   <break .../> ?                        -> timing command  (no text)
//   <say-as ...characters'>X</say-as> ?   -> " ", X, " "   ("eigh" for "a":
//        NVDA skips character mode for OneCore and substitutes for English)
//   <phoneme ...>W</phoneme> ?  (W w/o spaces) -> PhonemeCommand (no text)
//   <audio src='beep.mp4'>..</audio> ?    -> BeepCommand      (no text)
//   any other <...> ?  (prosody etc.)     -> command/ignored  (no text)
//   run of non-'<' characters             -> " ", run, " "
// then one final " ". Characters matched by no alternative are skipped.
const SSML_TOKEN = new RegExp([
  "<break time='\\d+ms'\\/> ?",
  "<say-as interpret-as='characters'>([^<]+)<\\/say-as> ?",
  "<phoneme alphabet='ipa' ph='[^']+'>[^ <]+<\\/phoneme> ?",
  "<audio src='beep\\.mp4'>.*?<\\/audio> ?",
  "<[^>]+> ?",
  "([^<]+)",
].join('|'), 'g');

export function toSpeechViewerRaw(ssml) {
  const strings = [];
  for (const m of String(ssml).matchAll(SSML_TOKEN)) {
    if (m[1] !== undefined) strings.push(' ', m[1] === 'a' ? 'eigh' : m[1], ' ');
    else if (m[2] !== undefined) strings.push(' ', m[2], ' ');
  }
  strings.push(' ');
  return strings.join('  ');
}

export function collapseWhitespace(s) {
  return String(s).split(/\s+/).join(' ').trim();
}
// ==== BEGIN navigation, part 1 of 2 (PLAN-MATHCAT-NAVIGATION.md 3.3, N14) ====
// NVDA 2026.2's navigation command names (source/mathPres/MathCAT/navCommands.py;
// the plan's Appendix A): 29 fixed commands plus 4 placemarker commands x 10
// digits. navigate() refuses any other name without touching MathCAT (N14).
// Test N-T2 compares this list with NVDA's file, downloaded at test time.
// The add-on sends key presses instead (DoNavigateKeyPress); MathCAT 0.7.7's own
// key table gives the same command for all 69 of NVDA's keys (checked
// 2026-11-09; mathcat-proofing-v2/NOTE-MATHCAT-UPGRADE-0.7.7.md).
// Deleting both navigation blocks restores the first plan's engine.
export const NAV_COMMANDS = Object.freeze([
  'MovePrevious', 'MoveNext', 'ZoomOut', 'ZoomIn',
  'MoveCellPrevious', 'MoveCellNext', 'MoveCellUp', 'MoveCellDown',
  'ReadPrevious', 'ReadNext', 'ToggleZoomLockUp', 'ToggleZoomLockDown',
  'DescribePrevious', 'DescribeNext', 'ZoomOutAll', 'ZoomInAll',
  'WhereAmI', 'WhereAmIAll', 'ReadCurrent', 'ReadCellCurrent', 'ToggleSpeakMode', 'DescribeCurrent',
  'MoveStart', 'MoveLineStart', 'MoveColumnStart', 'MoveEnd', 'MoveLineEnd', 'MoveColumnEnd',
  'MoveLastLocation',
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`MoveTo${n}`, `SetPlacemarker${n}`, `Read${n}`, `Describe${n}`]),
]);
// The add-on's two messages (MathCAT.py 0.7.7): entering math fails
// (MathCATInteraction.reportFocus); a later key fails (script_navigate). N6,
// N22. (NVDA 2026.2's built-in copy said "Error in starting navigation of
// math." and "Error in navigating math".)
export const NAV_ENTER_FAILED = 'Error in starting navigation of math: see NVDA error log for details';
export const NAV_FAILED = 'Error in navigating math: see NVDA error log for details';
// Ids in a MathML string (either quote style), and the top-most elements of a
// MathCAT subtree whose id is one of them. A string scan, not a DOM (M15);
// test N-T1 compares it with an XML-parser walk (gen-nav-ssml.mjs).
const NAV_TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const NAV_ID = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/;
function idOfAttrs(attrs) {
  const m = NAV_ID.exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
}
export function idsInMathML(mathml) {
  const ids = new Set();
  for (const m of String(mathml).matchAll(NAV_TAG)) {
    if (m[1]) continue;
    const id = idOfAttrs(m[3]);
    if (id !== null) ids.add(id);
  }
  return ids;
}
export function topMostTagged(xml, ids) {
  const out = [];
  if (typeof xml !== 'string') return out;
  let depth = 0;
  let inside = -1;             // depth of the tagged element whose subtree is skipped, or -1
  for (const m of xml.matchAll(NAV_TAG)) {
    if (m[1]) {                // end tag
      depth--;
      if (depth === inside) inside = -1;
      continue;
    }
    if (inside < 0) {
      const id = idOfAttrs(m[3]);
      if (id !== null && ids.has(id)) {
        out.push(id);
        if (!m[4]) inside = depth;
      }
    }
    if (!m[4]) depth++;
  }
  return out;
}
// ==== END navigation, part 1 of 2 ====

// ---------------------------------------------------------------------------
// Loading. Route (b) in plan F10: fetch the gzipped .bin and decompress it,
// the same pattern as pandoc-wasm/pandoc.js.
export async function fetchWasmBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`mathcat-wasm.bin fetch failed: HTTP ${resp.status} (${url})`);
  const stream = resp.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let enginePromise = null;   // one MathCAT instance per window (wasm-bindgen module state)

/**
 * createMathCATEngine({ bytes }) | ({ url }) | ()  ->  Promise<engine>
 *   bytes: ArrayBuffer | Uint8Array of the RAW wasm (route (a): e.g. posted in
 *          by a parent window).
 *   url:   URL of mathcat-wasm.bin (route (b)); default: next to this module.
 * The first call decides the source; later calls return the same engine.
 * engine = { version, nvda, speak(mathml) -> Promise<{ ok, text, viewerRaw, error }> }
 */
export function createMathCATEngine(src = {}) {
  if (!enginePromise) {
    enginePromise = start(src).catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}

async function start(src) {
  const bytes = src.bytes ? src.bytes : await fetchWasmBytes(src.url || defaultBinUrl());
  await init({ module_or_path: bytes });
  mc.init();                                   // SetRulesDir: must come first
  for (const [k, v] of NVDA_STARTUP_PREFS) mc.setPreference(k, v);
  const version = mc.version();
  if (version !== PINNED_MATHCAT) {
    throw new Error(`mathcat-wasm.bin reports MathCAT ${version}; mathcat.js is pinned to ${PINNED_MATHCAT}`);
  }
  const cache = new Map();
  let stopped = null;                          // set if the wasm traps (panic=abort)

  async function speak(mathml) {
    const key = String(mathml);
    if (cache.has(key)) return cache.get(key);
    if (stopped) return { ok: false, text: '', viewerRaw: '', error: stopped };
    let result;
    try {
      // NVDA order (MathCAT.py L341-367): Language, SetMathML, capitals, speech.
      mc.setPreference('Language', 'en');
      mc.setMathML(key);
      for (const [k, v] of NVDA_PER_EXPRESSION_PREFS) mc.setPreference(k, v);
      const viewerRaw = toSpeechViewerRaw(mc.getSpokenText());
      result = { ok: true, text: collapseWhitespace(viewerRaw), viewerRaw, error: null };
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        // A Rust panic aborts the wasm instance; it cannot be trusted after.
        stopped = `MathCAT stopped (${e.message}); reload the page to restart it.`;
        return { ok: false, text: '', viewerRaw: '', error: stopped };
      }
      result = { ok: false, text: '', viewerRaw: '', error: String(e && e.message !== undefined ? e.message : e) };
      try { mc.setMathML('<math></math>'); } catch { /* as NVDA does after an error */ }
    }
    cache.set(key, result);
    return result;
  }

  // ==== BEGIN navigation, part 2 of 2 (PLAN-MATHCAT-NAVIGATION.md 3.3, N8,
  // N13, N14, N19, N22). Deleting this block, down to END, makes the first
  // plan's return statement below it live again; speak() itself is unchanged.
  //
  // MathCAT holds ONE expression and one navigation state. `loaded` is the
  // MathML string whose navigation state MathCAT holds, or null when that is
  // not known: speak() answers repeats from its cache without calling
  // setMathML, so after a cache hit MathCAT may hold another expression, or
  // this one at a moved position. navigate() then reloads (3.3).
  let loaded = null;
  async function speakTracked(mathml) {
    const hit = cache.has(String(mathml));
    const result = await speak(mathml);
    // A miss ran setMathML (or <math></math> after an error), as NVDA does each
    // time it reads an equation: navigation is back at the whole expression.
    loaded = hit ? null : String(mathml);
    return result;
  }
  const trapped = (e) => e instanceof WebAssembly.RuntimeError;
  const messageOf = (e) => String(e && e.message !== undefined ? e.message : e);
  // NVDA's arriving order (getSpeechForMathMl, as gen-nav-ssml.mjs drives it):
  // Language, SetMathML (on failure SetMathML("<math></math>")), capitals, speech.
  function loadForNavigation(key) {
    loaded = key;
    try {
      mc.setPreference('Language', 'en');
      mc.setMathML(key);
    } catch (e) {
      if (trapped(e)) throw e;
      try { mc.setMathML('<math></math>'); } catch (e2) { if (trapped(e2)) throw e2; }
      return;
    }
    for (const [k, v] of NVDA_PER_EXPRESSION_PREFS) mc.setPreference(k, v);
    try { mc.getSpokenText(); } catch (e) { if (trapped(e)) throw e; }
  }
  // The current node, read after every step (also after a failed one): our tag
  // when it is one we sent, else the top-most tagged parts inside it (3.3).
  function position(ids) {
    let navId = null;
    let navMathml = null;
    try { navId = mc.getNavigationMathMLId()[0]; } catch (e) { if (trapped(e)) throw e; }
    try { navMathml = mc.getNavigationMathML()[0]; } catch (e) { if (trapped(e)) throw e; }
    const nodeTag = ids.has(navId) ? navId : null;
    return { nodeTag, highlightTags: nodeTag !== null ? [nodeTag] : topMostTagged(navMathml, ids) };
  }
  const failed = (text, error) => ({ ok: false, text, nodeTag: null, highlightTags: [], error });
  const NAV_SET = new Set(NAV_COMMANDS);
  // Reload when asked (fresh) or when MathCAT holds something else, run one
  // MathCAT step, then read where navigation is.
  function step(key, fresh, run, failText) {
    if (stopped) return failed(failText, stopped);
    try {
      if (fresh || loaded !== key) loadForNavigation(key);
      const ids = idsInMathML(key);
      let ssml = null;
      let error = null;
      try { ssml = run(); } catch (e) { if (trapped(e)) throw e; error = messageOf(e); }
      const at = position(ids);
      if (error !== null) return { ok: false, text: failText, ...at, error };
      return { ok: true, text: collapseWhitespace(toSpeechViewerRaw(ssml)), ...at, error: null };
    } catch (e) {
      if (!trapped(e)) throw e;
      // A Rust panic aborts the wasm instance, as in speak().
      stopped = `MathCAT stopped (${e.message}); reload the page to restart it.`;
      loaded = null;
      return failed(failText, stopped);
    }
  }
  /**
   * navigate(mathml, command, { fresh, entering }) -> { ok, text, nodeTag, highlightTags, error }
   *   command   one of NAV_COMMANDS; anything else is refused (N14)
   *   fresh     reload first, back to the whole expression (N19)
   *   entering  the entering step: a failure shows NVDA's entering message (N22)
   *   text      the speech-viewer text, or the add-on's message on failure (N6)
   *   error     MathCAT's own text on failure, for the console
   */
  async function navigate(mathml, command, opts = {}) {
    const name = String(command);
    if (!NAV_SET.has(name)) {
      return failed(NAV_FAILED, `"${name}" is not an NVDA navigation command; refused (N14)`);
    }
    return step(String(mathml), !!opts.fresh, () => mc.doNavigateCommand(name),
      opts.entering ? NAV_ENTER_FAILED : NAV_FAILED);
  }
  /** goTo(mathml, tag, { fresh }): move to one of our tags, then ReadCurrent. Reserved (N13). */
  async function goTo(mathml, tag, opts = {}) {
    const key = String(mathml);
    const id = String(tag);
    if (!idsInMathML(key).has(id)) return failed(NAV_FAILED, `no element with id "${id}" in the MathML sent`);
    return step(key, !!opts.fresh, () => {
      mc.setNavigationNode(id, 0);
      return mc.doNavigateCommand('ReadCurrent');
    }, NAV_FAILED);
  }
  return Object.freeze({ version, nvda: NVDA_SETUP, speak: speakTracked, navigate, goTo });
  // ==== END navigation, part 2 of 2 ====
  return Object.freeze({ version, nvda: NVDA_SETUP, speak });
}
