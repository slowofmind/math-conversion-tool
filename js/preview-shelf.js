// js/preview-shelf.js — the "shelf" for the Output view: an output's pages and
// images, held in memory after a conversion, and the rules for reading them.
//
// Plan: multipage-preview/PLAN-MULTIPAGE-PREVIEW.md ("How it works" 1 to 4).
// Decided by Nicholas 2026-10-05 / 2026-10-08 (verbatim in the plan): keep the
// strict sandbox; one setup for single-page and multipage HTML; PNG, JPG and SVG
// only; image handoff built now; the shelf usable later by a manifest tool.
//
// Plain data, no page or screen parts, so everything here runs in Node tests
// (js/test-preview/test-shelf.mjs). Nothing here changes an output: callers get
// back new strings for the PREVIEW COPY only; Download, SCORM and Copy all keep
// using the untouched output (lastOutput).
//
// A shelf:
//   { kind: 'single' | 'multipage',
//     start: the first page shown (multipage: 'index.html'),
//     pages: [{ name, title, html }]   in reading order (html untouched),
//     images: Map(path -> { data: Uint8Array, type }),   PNG/JPG/SVG only
//     others: [path]   every other file in the output (sitemap.json, a .gif ...) }

// The image kinds the preview shows (decided 2026-10-05). Each is labelled with
// its type from the extension: an SVG handed over without a type does not draw.
export const PREVIEW_IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
};

const PAGE_RE = /\.html?$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const dec = new TextDecoder();

function extOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);
}

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : '';
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ---- building the shelf -------------------------------------------------------

/**
 * The shelf for HTML (multipage): Pandoc's zip, opened by index.html's
 * readZipFiles into [{ name, data }] in the zip's order. Pandoc writes the pages
 * in reading order (index.html first), so that order is the page order;
 * sitemap.json is not used for it, because it leaves out the page holding
 * content before the first heading (checked with Pandoc 3.11).
 */
export function shelfFromZipEntries(entries) {
  const pages = [], images = new Map(), others = [];
  for (const e of entries) {
    const name = e.name.replace(/^\.\//, '');
    if (PAGE_RE.test(name)) {
      const html = dec.decode(e.data);
      pages.push({ name, title: titleOf(html), html });
    } else if (PREVIEW_IMAGE_TYPES[extOf(name)]) {
      images.set(name, { data: e.data, type: PREVIEW_IMAGE_TYPES[extOf(name)] });
    } else {
      others.push(name);
    }
  }
  const start = pages.some(p => p.name === 'index.html') ? 'index.html' : (pages[0] ? pages[0].name : null);
  return { kind: 'multipage', start, pages, images, others };
}

/**
 * The shelf for single-page HTML: one page, named as the download, plus the
 * images it points to, taken from the files the conversion gave Pandoc
 * (lastOutput.files: project path -> Blob). Same rule as index.html's
 * collectPageImages, already used for SCORM: paths relative to the page, which
 * sits at the top of the project. Only the images the page uses are kept.
 */
export async function shelfFromPage({ name, html, files }) {
  const images = new Map();
  for (const ref of imageRefs(html)) {
    const path = resolvePath(name, ref);
    const type = path && PREVIEW_IMAGE_TYPES[extOf(path)];
    if (!type || images.has(path) || !files || !files[path]) continue;
    const f = files[path];
    const data = f instanceof Uint8Array ? f : new Uint8Array(await f.arrayBuffer());
    images.set(path, { data, type });
  }
  return { kind: 'single', start: name, pages: [{ name, title: titleOf(html), html }], images, others: [] };
}

export function getPage(shelf, name) {
  return (shelf && shelf.pages.find(p => p.name === name)) || null;
}

/**
 * The pages as the Page drop-down lists them: { name, title, label, position, count }.
 * The title page reads "Contents" when it holds Pandoc's table of contents; a title
 * two pages share gets the file name added.
 */
export function pageList(shelf) {
  const count = shelf.pages.length;
  const base = shelf.pages.map(p =>
    (shelf.kind === 'multipage' && p.name === shelf.start && /<nav\b[^>]*\bid="TOC"/i.test(p.html))
      ? 'Contents' : (p.title || p.name));
  return shelf.pages.map((p, i) => ({
    name: p.name, title: p.title, position: i + 1, count,
    label: base.filter(b => b === base[i]).length > 1 ? `${base[i]} (${p.name})` : base[i],
  }));
}

// ---- paths and links ------------------------------------------------------------

/**
 * A reference written in a page, as a path inside the output, or null when it
 * climbs out of the output. Relative to the page's own folder; "./" and
 * %-escapes tidied; anything after ? or # dropped.
 */
export function resolvePath(fromPage, ref) {
  const base = String(ref).split(/[?#]/)[0];
  const folder = fromPage.includes('/') ? fromPage.slice(0, fromPage.lastIndexOf('/') + 1) : '';
  const parts = [];
  for (const seg of (folder + safeDecode(base)).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * What a link in the preview leads to, read from the address as WRITTEN in the
 * page (the browser would resolve it against the platform's own address):
 *   { kind: 'same', fragment }          a section of this page (or its top)
 *   { kind: 'page', page, fragment }    another page of this output
 *   { kind: 'web', url }                http or https: opened in a new tab
 *   { kind: 'other', reason, href }     'scheme' (mailto: ...), 'not-a-page',
 *                                        'not-in-output': nothing happens (D5)
 * The shelf is checked first: Pandoc names pages after LaTeX labels, and a name
 * such as "sec:limits.html" would otherwise look like a web address.
 */
export function classifyLink(shelf, fromPage, href) {
  const h = String(href == null ? '' : href).trim();
  const hashAt = h.indexOf('#');
  const fragment = hashAt < 0 ? '' : safeDecode(h.slice(hashAt + 1));
  const addr = hashAt < 0 ? h : h.slice(0, hashAt);
  if (addr === '') return { kind: 'same', fragment };
  if (!addr.startsWith('/')) {
    const path = resolvePath(fromPage, addr);
    if (path !== null && getPage(shelf, path)) {
      return path === fromPage ? { kind: 'same', fragment } : { kind: 'page', page: path, fragment };
    }
  }
  if (/^https?:/i.test(h)) return { kind: 'web', url: h };
  if (h.startsWith('//')) return { kind: 'web', url: 'https:' + h };
  if (SCHEME_RE.test(h)) return { kind: 'other', reason: 'scheme', href: h };
  if (!addr.startsWith('/')) {
    const path = resolvePath(fromPage, addr);
    if (path !== null && (shelf.images.has(path) || shelf.others.includes(path))) {
      return { kind: 'other', reason: 'not-a-page', href: h };
    }
  }
  return { kind: 'other', reason: 'not-in-output', href: h };
}

// ---- images in the preview copy ----------------------------------------------------

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /(\s)src\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function imageRefs(html) {
  const out = [];
  for (const m of html.matchAll(IMG_TAG_RE)) {
    const a = SRC_ATTR_RE.exec(m[0]);
    if (!a) continue;
    const src = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    if (src && !SCHEME_RE.test(src) && !src.startsWith('//') && !src.startsWith('#')) out.push(src);
  }
  return out;
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The preview copy of a page with every image that points at a file moved off
 * `src`, so the frame never asks GitHub for it, onto two marker attributes:
 *   data-astem-preview-src="<path in the output>"
 *   data-astem-preview-state="wanted" | "missing" | "unsupported"
 * The link helper asks the platform for the "wanted" ones and draws them. Images
 * already inside the page (data:) and full web addresses are left alone; alt text
 * and every other attribute stay where they are.
 * Returns { html, wanted, missing, unsupported } (paths; missing ones as written
 * when they climb out of the output).
 */
export function markImages(html, pagePath, shelf) {
  const wanted = [], missing = [], unsupported = [];
  const out = html.replace(IMG_TAG_RE, (tag) => {
    const a = SRC_ATTR_RE.exec(tag);
    if (!a) return tag;
    const src = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    if (!src || SCHEME_RE.test(src) || src.startsWith('//') || src.startsWith('#')) return tag;
    const path = resolvePath(pagePath, src);
    let state;
    if (path === null) { state = 'missing'; missing.push(src); }
    else if (!PREVIEW_IMAGE_TYPES[extOf(path)]) { state = 'unsupported'; unsupported.push(path); }
    else if (!shelf.images.has(path)) { state = 'missing'; missing.push(path); }
    else { state = 'wanted'; if (!wanted.includes(path)) wanted.push(path); }
    return tag.replace(a[0], `${a[1]}data-astem-preview-src="${attr(path === null ? src : path)}" data-astem-preview-state="${state}"`);
  });
  return { html: out, wanted, missing, unsupported };
}

/**
 * Image problems across the whole output, found once per conversion (D4: reported
 * in the Log): { missing: [{ page, path }], unsupported: [{ page, path }] }.
 */
export function findImageProblems(shelf) {
  const missing = [], unsupported = [];
  for (const p of shelf.pages) {
    const r = markImages(p.html, p.name, shelf);
    for (const path of new Set(r.missing)) missing.push({ page: p.name, path });
    for (const path of new Set(r.unsupported)) unsupported.push({ page: p.name, path });
  }
  return { missing, unsupported };
}

/** `tags` placed just before the last </body> (any case), or at the end if there is none. */
export function insertBeforeBodyEnd(html, tags) {
  let at = -1;
  for (const m of html.matchAll(/<\/body\s*>/gi)) at = m.index;
  return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at);
}

// ---- same-page links in the preview copy (2026-10-10) ------------------------------
// The preview copy starts its <head> with this <base>, so the browser reads a "#..." link as a
// place in the same page and follows it itself, as on any website, and screen readers follow
// that jump (NVDA did not follow one made by the helper's script). Without it, a "#..." link in
// a srcdoc frame would leave for about:blank.
export const PREVIEW_BASE_TAG = '<base href="about:srcdoc">';

const A_TAG_RE = /<a\b[^>]*>/gi;
const HREF_ATTR_RE = /(\s)href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * The preview copy of a page with each link that names the page it is on (Pandoc writes
 * "1-sec:limits.html#sec:limits" on 1-sec:limits.html) written "#sec:limits", or "#" for
 * the page alone, so the browser follows it itself. Which links: classifyLink's 'same',
 * other than "" and "#..." (already same-page). Everything else is left as written.
 */
export function rewriteSelfLinks(html, pagePath, shelf) {
  return html.replace(A_TAG_RE, (tag) => {
    const a = HREF_ATTR_RE.exec(tag);
    if (!a) return tag;
    const href = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '').trim();
    if (href === '' || href.startsWith('#')) return tag;
    if (classifyLink(shelf, pagePath, href).kind !== 'same') return tag;
    const at = href.indexOf('#');
    return tag.replace(a[0], `${a[1]}href="${attr(at < 0 ? '#' : href.slice(at))}"`);
  });
}

/** `tags` placed just after the first <head> (any case); with none, after a leading doctype and <html>. */
export function insertAtHeadStart(html, tags) {
  const m = /<head\b[^>]*>/i.exec(html) || /^\s*(?:<!doctype\b[^>]*>)?\s*(?:<html\b[^>]*>)?/i.exec(html);
  const at = m.index + m[0].length;
  return html.slice(0, at) + tags + html.slice(at);
}
