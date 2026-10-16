// js/preview-pages.js — the platform side of the Output view's pages: one HTML page
// or every page of HTML (multipage), shown one at a time in the sandboxed frame.
//
// Plan: multipage-preview/PLAN-MULTIPAGE-PREVIEW.md. Decided (verbatim in the plan):
// strict sandbox kept; one setup for single-page and multipage; PNG/JPG/SVG handed to
// the page; Math subtitles kept across page swaps and reset by new output (D1 a);
// the Code view (D3 a) follows the page, through onPageChange (the Page drop-down, D2 a,
// was removed 2026-10-10: the frame's spoken name gives the position);
// missing images reported once per output (D4 a: the caller puts them in the Log);
// links other than web links are not followed, with a status message (D5 a).
//
// Same shape as initMathCATProof(ctx): what it needs comes in through ctx.
//   ctx.getPreviewFrame()                 -> the #previewFrame element      (required)
//   ctx.writePreview(html, { pageSwap })  -> index.html's setPreviewHtml: adds the
//                                            MathCAT helper, writes srcdoc  (required)
//   ctx.readZip(bytes)                    -> index.html's readZipFiles      (multipage)
//   ctx.status?(level, text)              -> the status bar
//   ctx.openWeb?(url)                     -> opens a web link; default: a new tab
//   ctx.loadHelperSource?()               -> the helper's text (tests)
//   ctx.focusMode?                        -> 'auto' (default) or 'none' (D6, after NVDA)
//   ctx.win?                              -> window to listen on (tests)
// Nothing here touches what gets downloaded: pages on the shelf stay untouched, and
// only the preview copy carries the helpers.
// Both resolved lazily, as in mathcat-proof.js (a module loaded from a blob: URL would throw),
// and pinned to this module with import.meta.url: no bare relative path strings in a module
// (cm6-src/test-asset-urls.mjs; the house pattern, as for mathcat-proof.js's engine).
const shelfUrl = () => new URL('./preview-shelf.js', import.meta.url).href;
const helperUrl = () => new URL('./preview-helper.js', import.meta.url).href;
let S = null;   // js/preview-shelf.js, loaded the first time an output is shown
async function shelfModule() {
  if (!S) S = await import(shelfUrl());
  return S;
}
async function defaultLoadHelperSource() {
  const url = helperUrl();
  // cache 'no-cache' (2026-10-10): the browser checks with the server each time, so an old
  // cached copy never stands in for an updated helper.
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} not found (HTTP ${r.status})`);
  return r.text();
}
const P = 'astem-preview:';
const UNSAFE_IN_INLINE_SCRIPT = /<\/script|<!--/i;
const FRAME_NAME = 'HTML output';

// JSON that is safe inside an inline <script>.
function jsonForScript(o) {
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const NOT_FOLLOWED = {
  scheme: (h) => `This link isn't followed in the preview: ${h}`,
  'not-a-page': (h) => `This link points to a file, not a page. The preview shows pages only: ${h}`,
  'not-in-output': (h) => `This link points to something that isn't in this output: ${h}`,
};

export function initPreviewPages(ctx) {
  const win = ctx.win || window;
  const status = (level, text) => { try { ctx.status && ctx.status(level, text); } catch { /* optional */ } };
  let shelf = null;
  let current = null;           // { name, fragment }
  let token = 0;                // bumped by every page shown and by clear(): older pages' messages drop out
  let helperText = null, helperFetch = null;
  let lastLanding = null;
  const watchers = [];

  async function helper() {     // fetched once, the first time a page is shown
    if (helperText !== null) return helperText;
    if (!helperFetch) {
      helperFetch = (async () => {
        const src = await (ctx.loadHelperSource || defaultLoadHelperSource)();
        if (UNSAFE_IN_INLINE_SCRIPT.test(src)) throw new Error('preview-helper.js contains text that cannot be inlined in a <script>');
        helperText = src;
      })().catch((e) => { helperFetch = null; throw e; });
    }
    await helperFetch;
    return helperText;
  }

  function info(cause) {
    if (!shelf || !current) return { kind: null, cause };
    const list = S.pageList(shelf);
    const entry = list.find(p => p.name === current.name);
    return { kind: shelf.kind, name: current.name, fragment: current.fragment, title: entry.title,
             label: entry.label, position: entry.position, count: entry.count, pages: list, cause };
  }
  function notify(cause) {
    const i = info(cause);
    for (const fn of watchers.slice()) {
      try { fn(i); } catch (e) { console.warn('Preview pages: ' + (e && e.message || e)); }
    }
  }
  function nameFrame() {        // G9: the frame's spoken name says which page
    const frame = ctx.getPreviewFrame();
    if (!frame) return;
    const i = info();
    frame.title = (i.count > 1) ? `${FRAME_NAME}: ${i.label}, page ${i.position} of ${i.count}` : FRAME_NAME;
  }

  /**
   * Shows one page of the current shelf. cause: 'output' (a new conversion's output),
   * 'link' (a link in the preview) or 'picker' (any other caller; the Page drop-down until
   * it was removed 2026-10-10). Only a link moves focus inside the page.
   */
  async function showPage(name, fragment = '', { cause = 'picker' } = {}) {
    const page = shelf && S.getPage(shelf, name);   // a shelf means preview-shelf.js is loaded
    if (!page) return false;
    const mine = ++token;
    const marked = S.markImages(page.html, name, shelf);
    // Same-page links are the browser's own (2026-10-10): links naming this page become "#...",
    // and the <base> keeps "#..." in this document. Preview copy only, like everything here.
    const copy = S.insertAtHeadStart(S.rewriteSelfLinks(marked.html, name, shelf), S.PREVIEW_BASE_TAG);
    const config = { token: mine, page: name, fragment: fragment || '',
                     focus: cause === 'link' ? (ctx.focusMode || 'auto') : 'none' };
    const tags = '<script data-astem-preview-config>window.__ASTEM_PREVIEW = ' + jsonForScript(config) + ';</' + 'script>'
               + '<script data-astem-preview-helper>' + (await helper()) + '</' + 'script>';
    if (mine !== token) return false;               // a newer page was asked for meanwhile
    current = { name, fragment: fragment || '' };
    lastLanding = null;
    await ctx.writePreview(S.insertBeforeBodyEnd(copy, tags), { pageSwap: cause !== 'output' });
    if (mine !== token) return false;
    nameFrame();
    notify(cause);
    return true;
  }

  async function showShelf(s) {
    shelf = s;
    const problems = S.findImageProblems(shelf);
    await showPage(shelf.start, '', { cause: 'output' });
    return problems;
  }

  /** Single-page HTML: { name: the download's name, html: the untouched output, files: lastOutput.files }. */
  async function showSinglePage({ name, html, files }) {
    const M = await shelfModule();
    return showShelf(await M.shelfFromPage({ name, html, files }));
  }

  /** HTML (multipage): { bytes: Pandoc's zip } or { entries: [{ name, data }] } already opened. */
  async function showMultipage({ bytes, entries }) {
    const M = await shelfModule();
    const e = entries || await ctx.readZip(bytes);
    return showShelf(M.shelfFromZipEntries(e));
  }

  /** Not HTML any more (another format converted): forget the shelf; late messages are ignored. */
  function clear() {
    token++;
    shelf = null; current = null; lastLanding = null;
    nameFrame();
    notify('cleared');
  }

  function openWebLink(url) {
    let opened = null;
    try { opened = ctx.openWeb ? ctx.openWeb(url) : win.open(url, '_blank', 'noopener'); } catch { opened = null; }
    // window.open with noopener returns null even when it worked, so only an explicit false is a failure
    if (opened === false) status('error', `The browser blocked a new tab for this link: ${url}`);
    else status('ready', `Opened in a new tab: ${url}`);
  }

  async function onMessage(e) {
    const frame = ctx.getPreviewFrame();
    if (!frame || e.source !== frame.contentWindow) return;          // only our preview
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith(P)) return;
    if (!shelf || d.token !== token) return;                        // a page since replaced
    if (d.type === P + 'ready') {
      const files = {};
      for (const path of Array.isArray(d.images) ? d.images : []) {
        const img = shelf.images.get(path);
        if (img) files[path] = new Blob([img.data], { type: img.type });   // labelled: an unlabelled SVG does not draw
      }
      e.source.postMessage({ type: P + 'images', token, files }, '*');
    } else if (d.type === P + 'link') {
      const r = S.classifyLink(shelf, current.name, d.href);
      if (r.kind === 'page') await showPage(r.page, r.fragment, { cause: 'link' });
      else if (r.kind === 'same') e.source.postMessage({ type: P + 'jump', token, fragment: r.fragment }, '*');
      else if (r.kind === 'web') openWebLink(r.url);
      else status('ready', NOT_FOLLOWED[r.reason](r.href));
    } else if (d.type === P + 'landed') {
      lastLanding = { page: d.page, fragment: d.fragment, found: !!d.found, focused: d.focused || null };
      notify('landed');
    }
  }
  win.addEventListener('message', onMessage);

  return {
    showSinglePage, showMultipage, showPage, clear,
    current: () => info(),
    pages: () => (shelf ? S.pageList(shelf) : []),
    shelf: () => shelf,
    pageHtml: (name) => { const p = shelf && S.getPage(shelf, name || (current && current.name)); return p ? p.html : null; },
    lastLanding: () => lastLanding,
    onPageChange: (fn) => {
      watchers.push(fn);
      return () => { const i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); };
    },
    dispose: () => win.removeEventListener('message', onMessage),
  };
}
