// js/a11y-check.js — the accessibility check (Sa11y) for HTML output, platform (parent page) side.
//
// Plan: accessibility-checker\PLAN-ACCESSIBILITY-CHECKER.md. Nicholas, 2026-10-18 (verbatim in the
// plan): "On/off should be as you describe...off by default (for now)". So: off by default; while
// on, every HTML preview (single page, each page of multipage) gets the check; Download, packaging
// and the Code view never do (index.html's setPreviewHtml passes ONLY the preview copy through here).
//
// What goes into the PREVIEW COPY, just before its last </body>, in this order:
//   1. js/a11y-check-agent.js, inlined as text (rule M16: no "</script", no "<!--");
//   2. Sa11y's stylesheet, strings and script, by ABSOLUTE address from sa11y-5.1.0/. The one
//      exception to M16: Sa11y's own text contains "<!--", which M16 refuses to inline. The version
//      is in the folder name, so a browser can't keep an old copy after an update. Absolute because
//      the preview copy's <base> is about:srcdoc.
// The agent starts Sa11y once MathJax and the preview's images are ready, and sends the results
// back ('astem-a11y:results'); they are kept here for stage 2 (the platform's own list). Nothing
// is shown by this module yet.
//
// Same shape as initMathCATProof(ctx):
//   ctx.getPreviewFrame()  -> the #previewFrame element          (required)
//   ctx.win?               window to listen on (tests)
//   ctx.loadAgentSource?   async () => string                     (tests)

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

export function initA11yCheck(ctx) {
  const win = ctx.win || window;
  let on = false;
  let agentText = null, agentFetch = null;
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

  // Returns the HTML for previewFrame.srcdoc. Unchanged while off.
  async function preparePreview(html) {
    if (!on) return html;
    const tags = '<script data-astem-a11y-agent>' + (await agent()) + '</' + 'script>'
      + '<link rel="stylesheet" data-astem-a11y href="' + sa11yUrl('sa11y.min.css') + '">'
      + '<script data-astem-a11y src="' + sa11yUrl('lang/en.umd.js') + '"></' + 'script>'
      + '<script data-astem-a11y src="' + sa11yUrl('sa11y.umd.min.js') + '"></' + 'script>';
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
