// js/mathcat-proof.js — MathCAT speech proofing, platform (parent page) side.
//
// Plan: PLAN-MATHCAT-SPEECH-PROOFING.md, sections 2.1, 2.5, 2.7.
//   M2   v1 runs the engine here, in the platform page, once per session.
//   M3   The in-frame agent is added to the PREVIEW copy of the HTML only
//        while proofing is on; toggling re-renders the preview.
//   M16  The agent's text is inlined into the srcdoc (not loaded by URL).
//   Exports (Download, SCORM) never see the agent: callers pass
//   injectForPreview() output to previewFrame.srcdoc ONLY.
//
// Same shape as initIntentReview(ctx): dependencies come in through ctx.
//   ctx.getPreviewFrame()  -> the #previewFrame element          (required)
//   ctx.updateLog?(level, text)                                  (optional)
//   ctx.win?               window to listen on (tests)            (optional)
//   ctx.loadEngine?        async () => engine                     (tests)
//   ctx.loadAgentSource?   async () => string                     (tests)

// Subtitle settings (PLAN-MATHCAT-NAVIGATION.md 3.9, N44): the way back is this one
// switch. On (the default): one drop-down (N46) chooses Hide, MathCat or MathJax, the helper
// is in every HTML preview (revises M3 above), and a change does not rebuild the
// preview. Off: exactly today's behaviour (M3). The helper has no switch of its own.
const subtitleSettings = true;

// Resolved lazily: evaluating new URL(..., import.meta.url) at module load
// would throw when this module is loaded from a blob: URL (demo page).
const engineUrl = () => new URL('../mathcat-wasm/mathcat.js', import.meta.url).href;
const agentUrl = () => new URL('./mathcat-proof-agent.js', import.meta.url).href;
const MSG_SPEAK = 'mathcat-proof:speak';
const MSG_SPEECH = 'mathcat-proof:speech';
const MSG_READY = 'mathcat-proof:ready';

async function defaultLoadEngine() {
  const { createMathCATEngine } = await import(engineUrl());
  return createMathCATEngine();                       // route (b): fetch mathcat-wasm.bin
}
async function defaultLoadAgentSource() {
  const url = agentUrl();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} not found (HTTP ${r.status})`);
  return r.text();
}

// Text that must never appear inside an inline <script>: it would end the
// script early or switch the HTML parser into its escaped script state.
const UNSAFE_IN_INLINE_SCRIPT = /<\/script|<!--/i;
const BODY_CLOSE = /<\/body\s*>/gi;

export function initMathCATProof(ctx) {
  const win = ctx.win || window;
  const log = (level, text) => { try { ctx.updateLog && ctx.updateLog(level, text); } catch { /* optional */ } };
  let enabled = false;
  let engine = null;
  let agentTag = null;
  let starting = null;

  async function enable() {
    if (!starting) {
      starting = (async () => {
        const [eng, src] = await Promise.all([
          (ctx.loadEngine || defaultLoadEngine)(),
          (ctx.loadAgentSource || defaultLoadAgentSource)(),
        ]);
        if (UNSAFE_IN_INLINE_SCRIPT.test(src)) {
          throw new Error('mathcat-proof-agent.js contains text that cannot be inlined in a <script>');
        }
        engine = eng;
        agentTag = '<script data-astem-mathcat-agent>' + src + '</' + 'script>';
        log('info', `MathCAT proofing ready: MathCAT ${engine.version}, NVDA ${engine.nvda} settings`);
      })().catch((e) => { starting = null; throw e; });
    }
    await starting;
    enabled = true;
  }

  function disable() { enabled = false; }

  // Returns the HTML to put in previewFrame.srcdoc. Unchanged when off.
  function injectForPreview(html) {
    if (!enabled || !agentTag) return html;
    let at = -1;
    for (const m of html.matchAll(BODY_CLOSE)) at = m.index;   // last </body>
    return at < 0 ? html + agentTag : html.slice(0, at) + agentTag + html.slice(at);
  }

  async function onMessage(event) {
    const frame = ctx.getPreviewFrame();
    if (!frame || event.source !== frame.contentWindow) return;   // only our preview
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === MSG_READY) { log('info', `MathCAT proofing: preview math mode = ${d.mode}`); return; }
    if (typeof relayNavigation === 'function' && isNavigationMessage(d)) return relayNavigation(event, d);   // navigation hook (N21)
    if (typeof onModeReport === 'function' && d.type === 'mathcat-proof:mode') return onModeReport(event, d);   // subtitle settings hook (3.9)
    if (d.type !== MSG_SPEAK || !enabled || !engine) return;
    const r = await engine.speak(String(d.mathml));
    // The preview has an opaque origin, so '*' is the only usable target.
    event.source.postMessage({
      type: MSG_SPEECH, id: d.id, ok: r.ok, text: r.text, error: r.error,
      version: engine.version, nvda: engine.nvda,
    }, '*');
  }
  // ==== BEGIN navigation (PLAN-MATHCAT-NAVIGATION.md 3.6, N13, N14, N21) ====
  // Relays navigation requests from the preview to the engine, inside the first
  // plan's single message listener (one hook line there). Deleting this block
  // makes that hook line inert. Same rules as speech: only our preview frame,
  // only while proofing is on; the reply echoes the request's id and counter.
  const MSG_NAV = 'mathcat-proof:nav';
  const MSG_GOTO = 'mathcat-proof:goto';          // reserved: no sender in this build (N13)
  const MSG_NAVSPEECH = 'mathcat-proof:navspeech';
  const NAV_FAILED = 'Error in navigating math';   // NVDA's message (N6)
  function isNavigationMessage(d) { return d.type === MSG_NAV || d.type === MSG_GOTO; }
  async function relayNavigation(event, d) {
    if (!enabled || !engine) return;
    let r = null;
    try {
      if (d.type === MSG_NAV && typeof engine.navigate === 'function') {
        r = await engine.navigate(String(d.mathml), String(d.command), { fresh: !!d.fresh, entering: !!d.entering });
      } else if (d.type === MSG_GOTO && typeof engine.goTo === 'function') {
        r = await engine.goTo(String(d.mathml), String(d.tag), { fresh: !!d.fresh });
      }
    } catch (e) {
      r = { ok: false, text: NAV_FAILED, nodeTag: null, highlightTags: [], error: String(e && e.message || e) };
    }
    // An engine without navigation (e.g. the first plan's) answers NVDA's message (N21).
    if (!r) r = { ok: false, text: NAV_FAILED, nodeTag: null, highlightTags: [], error: 'this MathCAT engine has no navigation' };
    if (!r.ok && r.error) console.warn(`MathCAT navigation: ${r.error}`);   // MathCAT's own text (N6)
    event.source.postMessage({
      type: MSG_NAVSPEECH, id: d.id, nav: d.nav, ok: r.ok, text: r.text,
      nodeTag: r.nodeTag, highlightTags: r.highlightTags, version: engine.version, nvda: engine.nvda,
    }, '*');
  }
  // ==== END navigation ====
  // ==== BEGIN subtitle settings (PLAN-MATHCAT-NAVIGATION.md 3.9, N41-N45) ====
  // One setting for the math subtitles in the preview: Hide, MathCat or MathJax,
  // chosen in the platform's drop-down (N46). Switch on (`subtitleSettings` at the
  // top of this file; ctx.subtitleSettings overrides it in tests): the helper goes
  // into every HTML preview with one line just ahead of it (N42, N44), each new
  // preview starts at Hide (N43), and a change is sent to the helper without
  // rebuilding the preview. Switch off: today's rule (N44): the helper only while
  // MathCat is chosen, the preview rebuilt on each change, the cycle Hide <-> MathCat,
  // no line. Download and SCORM are never given preparePreview's output. Deleting
  // this block leaves the two "subtitle settings hook" lines inert; enable, disable
  // and injectForPreview are the first plan's, unchanged.
  const MSG_MODE = 'mathcat-proof:mode';
  const MSG_SETMODE = 'mathcat-proof:setmode';
  const CHOICES = ['hide', 'mathcat', 'mathjax'];
  const settingsOn = typeof ctx.subtitleSettings === 'boolean' ? ctx.subtitleSettings : subtitleSettings;
  const SETTINGS_TAG = '<script data-astem-mathcat-settings>window.__ASTEM_MC_SUBTITLE_SETTINGS = true;</' + 'script>';
  let current = 'hide';
  let mjPresent = null;           // null until the new preview's helper first reports
  let pageBtn = null;
  let firstReportSeen = false;
  let kept = null;                // switch off: the Download string, kept for rebuilding
  let agentText = null, agentFetch = null, engineLoad = null;
  const watchers = [];
  // N46 (sitting 13): the drop-down's pause (A) and the last-choice guard (C).
  const choosePause = typeof ctx.choosePauseMs === 'number' ? ctx.choosePauseMs : 500;
  let ticket = 0;                 // bumped by each choice and each Convert; older requests drop out
  let pending = null;             // a drop-down change still in its pause: { timer, resolve }
  function dropPending() {
    if (pending) { clearTimeout(pending.timer); pending.resolve(false); pending = null; }
  }
  function announced(p) {         // N46 B: the platform page is told when a MathCAT load starts
    if (!engine && ctx.onEngineLoad) { try { ctx.onEngineLoad(p); } catch { /* optional */ } }
    return p;
  }

  async function helperText() {   // N45: fetched once, the first time Convert produces HTML
    if (agentText !== null) return agentText;
    if (!agentFetch) {
      agentFetch = (async () => {
        const src = await (ctx.loadAgentSource || defaultLoadAgentSource)();
        if (UNSAFE_IN_INLINE_SCRIPT.test(src)) {
          throw new Error('mathcat-proof-agent.js contains text that cannot be inlined in a <script>');
        }
        agentText = src;
      })().catch((e) => { agentFetch = null; throw e; });
    }
    await agentFetch;
    return agentText;
  }
  async function loadEngineOnce() {   // the first change to MathCat loads MathCAT
    if (engine) return;
    if (!engineLoad) {
      engineLoad = (async () => {
        const eng = await (ctx.loadEngine || defaultLoadEngine)();
        engine = eng;
        log('info', `MathCAT proofing ready: MathCAT ${eng.version}, NVDA ${eng.nvda} settings`);
      })().catch((e) => { engineLoad = null; throw e; });
    }
    await engineLoad;
  }
  function nextChoice() {
    if (!settingsOn) return current === 'mathcat' ? 'hide' : 'mathcat';
    if (current === 'hide') return 'mathcat';
    if (current === 'mathcat') return mjPresent === true ? 'mathjax' : 'hide';   // N37: skip MathJax without it
    return 'hide';
  }
  function tell(source) {         // source: 'platform', 'page' or 'new-preview'
    const info = { choice: current, next: nextChoice(), mathjax: mjPresent, pageButton: pageBtn, source };
    for (const fn of watchers.slice()) {
      try { fn(info); } catch (e) { console.warn('MathCAT subtitle settings: ' + (e && e.message || e)); }
    }
  }
  function sendToPreview() {
    const frame = ctx.getPreviewFrame();
    const w = frame && frame.contentWindow;
    if (w) w.postMessage({ type: MSG_SETMODE, choice: current }, '*');
  }
  async function preparePreview(html) {
    if (!settingsOn) { kept = html; return injectForPreview(html); }   // today's rule
    current = 'hide'; mjPresent = null; pageBtn = null; firstReportSeen = false; enabled = false;   // N43
    ticket++; dropPending();          // N46 C: anything still waiting belongs to the old preview
    tell('new-preview');
    const tags = SETTINGS_TAG + '<script data-astem-mathcat-agent>' + (await helperText()) + '</' + 'script>';
    let at = -1;
    for (const m of html.matchAll(BODY_CLOSE)) at = m.index;          // last </body>
    return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at);
  }
  async function setChoice(c) {
    if (!CHOICES.includes(c)) return false;
    if (c === 'mathjax' && (!settingsOn || mjPresent !== true)) return false;
    const mine = ++ticket;            // N46 C: a newer choice or a Convert makes this one stale
    if (!settingsOn) {                                                // today's rule: rebuild
      if (c === 'mathcat') await announced(enable()); else disable();
      if (mine !== ticket) { enabled = current === 'mathcat'; return false; }   // N46 C
      current = c;
      const frame = ctx.getPreviewFrame();
      if (frame && kept !== null) frame.srcdoc = injectForPreview(kept);
      tell('platform');
      return true;
    }
    if (c === 'mathcat') await announced(loadEngineOnce());
    if (mine !== ticket) return false;                                 // N46 C
    current = c;
    enabled = c === 'mathcat';
    sendToPreview();
    tell('platform');
    return true;
  }
  function choose(c) {            // N46 A: the drop-down calls this on every change
    ticket++; dropPending();      // N46 C: anything still waiting is now older
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = null;
        setChoice(c).then(resolve, reject);
      }, choosePause);
      pending = { timer, resolve };
    });
  }
  function onModeReport(event, d) {   // reached through the hook line in onMessage (our preview only)
    if (!settingsOn) return;
    const nextBefore = nextChoice(), mjBefore = mjPresent;   // N46: the drop-down needs MathJax's presence too
    if (typeof d.mathjax === 'boolean') mjPresent = d.mathjax;
    if (typeof d.pageButton === 'boolean') pageBtn = d.pageButton;
    if (!firstReportSeen) {           // a new preview's first report: answered, not adopted
      firstReportSeen = true;
      event.source.postMessage({ type: MSG_SETMODE, choice: current }, '*');
      if (nextChoice() !== nextBefore || mjPresent !== mjBefore) tell('new-preview');
      return;
    }
    const c = d.choice;               // later reports: the page's own button or menu (N38 a)
    if (!CHOICES.includes(c) || c === current || (c === 'mathjax' && mjPresent !== true)) {
      if (nextChoice() !== nextBefore) tell('page');
      return;
    }
    ticket++; dropPending();          // N46 C: a change made inside the preview is newer
    current = c;
    enabled = c === 'mathcat' && !!engine;
    if (c === 'mathcat' && !engine) {
      loadEngineOnce().then(() => { if (current === 'mathcat') enabled = true; },
        (e) => log('error', 'MathCAT could not be loaded: ' + (e && e.message || e)));
    }
    tell('page');
  }
  const subtitleSettingsApi = {
    preparePreview, setChoice, nextChoice, choose,
    cycle: () => setChoice(nextChoice()),
    choice: () => current,
    mathjaxPresent: () => mjPresent,
    onChoice: (fn) => {
      watchers.push(fn);
      return () => { const i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); };
    },
  };
  // ==== END subtitle settings ====
  win.addEventListener('message', onMessage);

  return {
    enable, disable, injectForPreview,
    ...(typeof subtitleSettingsApi === 'object' ? subtitleSettingsApi : {}),   // subtitle settings hook (3.9)
    isEnabled: () => enabled,
    label: () => (engine ? `MathCAT ${engine.version} (NVDA ${engine.nvda})` : 'MathCAT'),
    dispose: () => win.removeEventListener('message', onMessage),
  };
}
