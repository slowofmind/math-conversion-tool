// test-pages.mjs — js/preview-pages.js (platform side) and js/preview-helper.js's text.
//   node test-pages.mjs          (cwd: js/test-preview)
// Plan: PLAN-MULTIPAGE-PREVIEW.md. Fakes as in mathcat-wasm/test/test-t4-messaging.mjs:
// the frame is a stand-in, so this checks what the platform writes and answers. What
// happens INSIDE a real sandboxed frame is browser/run-browser.py's job.
import { readFileSync } from 'node:fs';
import { check, eq, done } from '../../mathcat-wasm/test/lib.mjs';
import { readZipEntries } from './zip-node.mjs';
import { initPreviewPages } from '../preview-pages.js';

const HELPER = readFileSync(new URL('../preview-helper.js', import.meta.url), 'utf8');
const fixture = (p) => readFileSync(new URL('./fixtures/' + p, import.meta.url));
function fakeWin() {
  const listeners = [];
  return { listeners, opened: [], open(u) { this.opened.push(u); return null; },
           addEventListener: (t, f) => t === 'message' && listeners.push(f),
           removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
}
function setup(extra = {}) {
  const win = fakeWin();
  const frameWin = { got: [], postMessage(m) { this.got.push(m); } };
  const frame = { contentWindow: frameWin, title: 'HTML output' };
  const writes = [], statuses = [], changes = [];
  const pp = initPreviewPages({ win, getPreviewFrame: () => frame, loadHelperSource: async () => HELPER,
    writePreview: async (html, opts) => { writes.push({ html, opts }); },
    status: (l, t) => statuses.push(t), ...extra });
  pp.onPageChange(i => changes.push(i));
  const fromPage = async (data, source = frameWin) => { for (const l of win.listeners) await l({ source, data }); };
  const config = () => JSON.parse(/window\.__ASTEM_PREVIEW = (\{.*?\});<\/script>/.exec(writes.at(-1).html)[1]);
  return { pp, win, frame, frameWin, writes, statuses, changes, fromPage, config };
}
const entries = await readZipEntries('./fixtures/workbook.zip');
const untouched = new Map(entries.map(e => [e.name, Buffer.from(e.data).toString('base64')]));

// ---- P1: the helper's own text -------------------------------------------------
check('P1 helper never ends a script tag or opens a comment', !/<\/script|<!--/i.test(HELPER));
let parses = true; try { new Function(HELPER); } catch (e) { parses = e.message; }
eq('P1 helper parses', parses, true);
check('P1 helper uses no module syntax', !/^\s*(import|export)\s/m.test(HELPER));

// ---- P2: a multipage output ----------------------------------------------------
{
  const t = setup();
  const problems = await t.pp.showMultipage({ entries });
  eq('P2 one write', t.writes.length, 1);
  eq('P2 a new output, not a page swap', t.writes[0].opts.pageSwap, false);
  check('P2 index.html shown', t.writes[0].html.includes('<title>Workbook Sample</title>') && t.writes[0].html.includes('id="TOC"'));
  check('P2 settings, then the helper, before </body>', /<script data-astem-preview-config>[\s\S]*<script data-astem-preview-helper>[\s\S]*<\/script><\/body>/.test(t.writes[0].html));
  eq('P2 settings: page, no section, no focus move (a new output)', JSON.stringify(t.config()), '{"token":1,"page":"index.html","fragment":"","focus":"none"}');
  eq('P2 frame name', t.frame.title, 'HTML output: Contents, page 1 of 4');
  // native same-page links (2026-10-10): the browser follows "#…" links itself in the preview copy
  check('P2 preview copy: <base href="about:srcdoc"> first in <head>', t.writes[0].html.includes('<head><base href="about:srcdoc">'));
  eq('P2 ... exactly one <base>', (t.writes[0].html.match(/<base\b/gi) || []).length, 1);
  eq('P2 page change told: Contents, 1 of 4, output', [t.changes.at(-1).label, t.changes.at(-1).position, t.changes.at(-1).count, t.changes.at(-1).cause].join(), 'Contents,1,4,output');
  eq('P2 no image problems in a complete output', problems.missing.length, 0);
  eq('P2 the gif is reported as not shown', JSON.stringify(problems.unsupported), '[{"page":"2-sec:deriv.html","path":"figures/anim.gif"}]');

  // a link in the preview to another page and section
  await t.fromPage({ type: 'astem-preview:link', token: 1, page: 'index.html', href: '2-sec:deriv.html#sec:deriv' });
  eq('P2 link: a page swap', t.writes.at(-1).opts.pageSwap, true);
  eq('P2 link: the new page lands on the section and moves focus', JSON.stringify(t.config()), '{"token":2,"page":"2-sec:deriv.html","fragment":"sec:deriv","focus":"auto"}');
  check('P2 link: its images marked, none left pointing at a file', t.writes.at(-1).html.includes('data-astem-preview-src="figures/curve.svg" data-astem-preview-state="wanted"') && !/<img[^>]*\ssrc="figures/.test(t.writes.at(-1).html));
  eq('P2 frame name follows', t.frame.title, 'HTML output: Derivatives, page 4 of 4');

  // the page asks for its images
  t.frameWin.got.length = 0;
  await t.fromPage({ type: 'astem-preview:ready', token: 2, page: '2-sec:deriv.html', images: ['figures/curve.svg', 'figures/anim.gif', 'figures/nope.png'] });
  const sent = t.frameWin.got.at(-1);
  eq('P2 images answered with this page\'s token', sent.type + ' ' + sent.token, 'astem-preview:images 2');
  eq('P2 only files the shelf has, PNG/JPG/SVG', Object.keys(sent.files).join(), 'figures/curve.svg');
  eq('P2 each labelled with its type', sent.files['figures/curve.svg'].type, 'image/svg+xml');

  // stale and foreign messages
  t.frameWin.got.length = 0; const before = t.writes.length;
  await t.fromPage({ type: 'astem-preview:ready', token: 1, images: ['figures/curve.svg'] });
  await t.fromPage({ type: 'astem-preview:link', token: 1, href: '1-sec:limits.html' });
  eq('P2 an old page\'s messages are ignored', t.frameWin.got.length + (t.writes.length - before), 0);
  await t.fromPage({ type: 'astem-preview:link', token: 2, href: '1-sec:limits.html' }, { postMessage() {} });
  eq('P2 messages from anywhere but the preview are ignored', t.writes.length - before, 0);
  await t.fromPage({ subject: 'lti.frameResize', height: 500 });
  await t.fromPage(JSON.stringify({ subject: 'lti.frameResize', height: 500 }));
  eq('P2 the Canvas script\'s height messages are ignored', t.writes.length - before, 0);

  // a page the platform shows itself, not from a link (the Page drop-down did this until 2026-10-10)
  await t.pp.showPage('1-sec:limits.html', '', { cause: 'picker' });
  eq('P2 picker: a page swap that keeps focus where the user is', JSON.stringify([t.writes.at(-1).opts.pageSwap, t.config().focus]), '[true,"none"]');
  eq('P2 picker: told as picker', t.changes.at(-1).cause, 'picker');
  check('P2 preview copy: the link naming its own page is "#sec:limits"', t.writes.at(-1).html.includes('href="#sec:limits"') && !t.writes.at(-1).html.includes('href="1-sec:limits.html#sec:limits"'));

  // links that stay on the page
  t.frameWin.got.length = 0;
  await t.fromPage({ type: 'astem-preview:link', token: 3, href: '1-sec:limits.html#sec:limits' });
  eq('P2 this page by name: answered with a jump, no swap', JSON.stringify(t.frameWin.got.at(-1)), '{"type":"astem-preview:jump","token":3,"fragment":"sec:limits"}');
  eq('P2 ... and nothing rewritten', t.writes.length, 3);

  // web and other links (D5)
  await t.fromPage({ type: 'astem-preview:link', token: 3, href: 'https://example.org/page' });
  eq('P2 web link opened in a new tab', t.win.opened.join(), 'https://example.org/page');
  eq('P2 ... and said', t.statuses.at(-1), 'Opened in a new tab: https://example.org/page');
  await t.fromPage({ type: 'astem-preview:link', token: 3, href: 'mailto:someone@example.org' });
  eq('P2 mailto: not followed, with a message', t.statuses.at(-1), "This link isn't followed in the preview: mailto:someone@example.org");
  eq('P2 mailto: nothing opened', t.win.opened.length, 1);
  await t.fromPage({ type: 'astem-preview:link', token: 3, href: 'figures/plot.png' });
  eq('P2 a file, not a page', t.statuses.at(-1), 'This link points to a file, not a page. The preview shows pages only: figures/plot.png');
  eq('P2 still 3 writes', t.writes.length, 3);

  // landing report
  await t.fromPage({ type: 'astem-preview:landed', token: 3, page: '1-sec:limits.html', fragment: '', found: true, focused: null });
  eq('P2 landing kept for checks', JSON.stringify(t.pp.lastLanding()), '{"page":"1-sec:limits.html","fragment":"","found":true,"focused":null}');

  // the shelf is never changed: what Download saves stays byte for byte
  eq('P2 Pandoc\'s files untouched', entries.every(e => Buffer.from(e.data).toString('base64') === untouched.get(e.name)), true);
  check('P2 pages on the shelf carry no helper', t.pp.shelf().pages.every(p => !p.html.includes('astem-preview')));
  check('P2 ... no <base>, and their links as Pandoc wrote them', t.pp.shelf().pages.every(p => !/<base\b/i.test(p.html)) && t.pp.shelf().pages[2].html.includes('href="1-sec:limits.html#sec:limits"'));
  eq('P2 Code view text is the untouched page', t.pp.pageHtml(), new TextDecoder().decode(entries.find(e => e.name === '1-sec:limits.html').data));

  // not HTML any more
  t.pp.clear();
  eq('P2 cleared: frame name back to plain', t.frame.title, 'HTML output');
  const n = t.writes.length;
  await t.fromPage({ type: 'astem-preview:link', token: 3, href: '2-sec:deriv.html' });
  eq('P2 cleared: late messages ignored', t.writes.length, n);
}

// ---- P3: a single page with separate images (Canvas style) ---------------------
{
  const t = setup();
  const files = {};
  for (const f of ['figures/plot.png', 'figures/curve.svg', 'figures/photo.jpg']) files[f] = new Blob([fixture('src/' + f)]);
  const html = new TextDecoder().decode(fixture('single.html'));
  const problems = await t.pp.showSinglePage({ name: 'single.html', html, files });
  eq('P3 frame name for one page', t.frame.title, 'HTML output');
  check('P3 the one page\'s preview copy has the <base> too', t.writes[0].html.includes('<head><base href="about:srcdoc">'));
  eq('P3 the missing image reported once (D4)', JSON.stringify(problems.missing), '[{"page":"single.html","path":"figures/missing.png"}]');
  check('P3 ./figures/curve.svg marked as figures/curve.svg', t.writes[0].html.includes('data-astem-preview-src="figures/curve.svg" data-astem-preview-state="wanted"'));
  check('P3 missing image marked, so the frame never asks GitHub for it', t.writes[0].html.includes('data-astem-preview-src="figures/missing.png" data-astem-preview-state="missing"'));
  await t.fromPage({ type: 'astem-preview:ready', token: 1, images: ['figures/plot.png', 'figures/curve.svg', 'figures/photo.jpg'] });
  eq('P3 all three handed over', Object.keys(t.frameWin.got.at(-1).files).sort().join(), 'figures/curve.svg,figures/photo.jpg,figures/plot.png');
  eq('P3 jpg labelled', t.frameWin.got.at(-1).files['figures/photo.jpg'].type, 'image/jpeg');
  await t.fromPage({ type: 'astem-preview:link', token: 1, href: 'single.html#p2' });
  eq('P3 a link to itself by name: a jump', t.frameWin.got.at(-1).type, 'astem-preview:jump');
}

// ---- P4: D6 switch and a refused helper ----------------------------------------
{
  const t = setup({ focusMode: 'none' });
  await t.pp.showMultipage({ entries });
  await t.fromPage({ type: 'astem-preview:link', token: 1, href: '1-sec:limits.html' });
  eq('P4 focusMode none: a link does not move focus', t.config().focus, 'none');
  const bad = setup({ loadHelperSource: async () => 'x = "</' + 'script>"' });
  let err = null; try { await bad.pp.showMultipage({ entries }); } catch (e) { err = e.message; }
  eq('P4 a helper that cannot be inlined is refused', err, 'preview-helper.js contains text that cannot be inlined in a <script>');
}

done('test-pages');
