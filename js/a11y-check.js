// js/a11y-check.js — the accessibility check (Sa11y) for HTML output, platform (parent page) side.
//
// Plan: accessibility-checker\PLAN-ACCESSIBILITY-CHECKER.md. Nicholas, 2026-10-18 (verbatim in the
// plan): "On/off should be as you describe...off by default (for now)". So: off by default; while
// on, every HTML preview (single page, each page of multipage) gets the check; Download, packaging
// and the Code view never do (index.html's setPreviewHtml passes ONLY the preview copy through here).
//
// What goes into the PREVIEW COPY, just before its last </body>, in this order:
//   1. js/a11y-check-agent.js, inlined as text (rule M16: no "</script", no "<!--");
//   2. Sa11y's stylesheet, strings and script from sa11y-5.1.0/, each carried INSIDE a data: address
//      (2026-11-09, Nicholas: "Let's try A."). This page fetches them once: it is signed in, and the
//      strictly sandboxed preview is not, so on Harvard Pages the preview's own fetch got the HarvardKey
//      login page and Sa11y never started (accessibility-checker\FINDING-2026-11-09-HARVARD-PAGES.md).
//      The preview now fetches nothing. Base64 keeps "<!--" (in Sa11y's own text) and "</script" out
//      of the preview copy, so M16 holds with no exception. If this page cannot get the files, the
//      preview falls back to loading them by ABSOLUTE address (absolute because the preview copy's
//      <base> is about:srcdoc), which works only where no sign-in is needed; the console says so.
//      The version is in the folder name, so a browser can't keep an old copy after an update.
// The agent starts Sa11y once MathJax and the preview's images are ready, and sends the results
// back ('astem-a11y:results'); they are kept here for stage 2 (the platform's own list). Nothing
// is shown by this module yet.
//
// Same shape as initMathCATProof(ctx):
//   ctx.getPreviewFrame()  -> the #previewFrame element          (required)
//   ctx.win?               window to listen on (tests)
//   ctx.loadAgentSource?   async () => string                     (tests)
//   ctx.loadSa11yFile?     async (file) => Uint8Array             (tests)

// Resolved lazily, pinned to this module (the house pattern; see mathcat-proof.js).
const agentUrl = () => new URL('./a11y-check-agent.js', import.meta.url).href;
const sa11yUrl = (file) => new URL('../sa11y-5.1.0/' + file, import.meta.url).href;
const MSG_RESULTS = 'astem-a11y:results';
const UNSAFE_IN_INLINE_SCRIPT = /<\/script|<!--/i;
const BODY_CLOSE = /<\/body\s*>/gi;

async function defaultLoadAgentSource() {
  const url = agentUrl();
  // cache 'no-cache' (2026-10-10 rule): the browser checks with the server each time.
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} not found (HTTP ${r.status})`);
  return r.text();
}

// Sa11y's files, in the order they go into the preview copy (2026-11-09).
const SA11Y_FILES = [
  { file: 'sa11y.min.css', type: 'text/css' },
  { file: 'lang/en.umd.js', type: 'text/javascript' },
  { file: 'sa11y.umd.min.js', type: 'text/javascript' },
];

async function defaultLoadSa11yFile(file) {
  const url = sa11yUrl(file);
  const r = await fetch(url, { cache: 'no-cache' });   // 2026-10-10 rule: check with the server each time
  if (!r.ok) throw new Error(`${url} not found (HTTP ${r.status})`);
  // Redirected: a sign-in page answered instead of the file, which must not go in as Sa11y.
  if (r.redirected) throw new Error(`${url} was redirected (a sign-in page?)`);
  return new Uint8Array(await r.arrayBuffer());
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The tag for one Sa11y file; address = a data: address carrying the file, or the file's own address.
function sa11yTag(f, address) {
  return f.type === 'text/css'
    ? '<link rel="stylesheet" data-astem-a11y href="' + address + '">'
    : '<script data-astem-a11y src="' + address + '"></' + 'script>';
}
const sa11yAddressTags = () => SA11Y_FILES.map((f) => sa11yTag(f, sa11yUrl(f.file))).join('');   // the fallback

export function initA11yCheck(ctx) {
  const win = ctx.win || window;
  let on = false;
  let agentText = null, agentFetch = null;
  let sa11yText = null, sa11yFetch = null;   // the Sa11y tags with the files inside (2026-11-09)
  let last = null;
  const watchers = [];

  async function agent() {        // fetched once, the first time the check is used
    if (agentText !== null) return agentText;
    if (!agentFetch) {
      agentFetch = (async () => {
        const src = await (ctx.loadAgentSource || defaultLoadAgentSource)();
        if (UNSAFE_IN_INLINE_SCRIPT.test(src)) {
          throw new Error('a11y-check-agent.js contains text that cannot be inlined in a <script>');
        }
        agentText = src;
      })().catch((e) => { agentFetch = null; throw e; });
    }
    await agentFetch;
    return agentText;
  }

  async function sa11yTags() {    // fetched once, the first time the check is used; tried again after a failure
    if (sa11yText !== null) return sa11yText;
    if (!sa11yFetch) {
      sa11yFetch = (async () => {
        const load = ctx.loadSa11yFile || defaultLoadSa11yFile;
        const bytes = await Promise.all(SA11Y_FILES.map((f) => load(f.file)));
        sa11yText = SA11Y_FILES.map((f, i) => sa11yTag(f, 'data:' + f.type + ';charset=utf-8;base64,' + toBase64(bytes[i]))).join('');
      })().catch((e) => { sa11yFetch = null; throw e; });
    }
    await sa11yFetch;
    return sa11yText;
  }

  // Returns the HTML for previewFrame.srcdoc. Unchanged while off.
  async function preparePreview(html) {
    if (!on) return html;
    let sa11y;
    try { sa11y = await sa11yTags(); }
    catch (e) {   // flag, don't fail: the addresses still work where no sign-in is needed
      console.warn('Accessibility check: could not get Sa11y\'s files (' + (e && e.message || e)
        + '); the preview will load them by address, which works only where no sign-in is needed.');
      sa11y = sa11yAddressTags();
    }
    const tags = '<script data-astem-a11y-agent>' + (await agent()) + '</' + 'script>' + sa11y;
    let at = -1;
    for (const m of html.matchAll(BODY_CLOSE)) at = m.index;          // last </body>
    return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at);
  }

  function setOn(v) {
    on = !!v;
    if (!on) last = null;
  }

  function wellFormed(d) {
    return Number.isInteger(d.errors) && Number.isInteger(d.warnings) && Array.isArray(d.items)
      && d.items.every(i => i && typeof i.test === 'string' && typeof i.type === 'string');
  }
  function onMessage(event) {
    const frame = ctx.getPreviewFrame();
    if (!frame || event.source !== frame.contentWindow) return;      // only our preview
    const d = event.data;
    if (!d || typeof d !== 'object' || d.type !== MSG_RESULTS) return;
    if (!on || !wellFormed(d)) return;
    last = { errors: d.errors, warnings: d.warnings, items: d.items.map(i => ({ test: i.test, type: i.type })) };
    for (const fn of watchers.slice()) {
      try { fn(last); } catch (e) { console.warn('Accessibility check: ' + (e && e.message || e)); }
    }
  }
  win.addEventListener('message', onMessage);

  return {
    preparePreview, setOn,
    isOn: () => on,
    lastResults: () => last,
    onResults: (fn) => {
      watchers.push(fn);
      return () => { const i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); };
    },
    dispose: () => win.removeEventListener('message', onMessage),
  };
}
