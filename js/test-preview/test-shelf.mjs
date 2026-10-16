// test-shelf.mjs — js/preview-shelf.js: the shelf, paths, links, image marking.
//   node test-shelf.mjs          (cwd: js/test-preview)
// Plan: multipage-preview/PLAN-MULTIPAGE-PREVIEW.md, "How it works" 1 to 4.
// Written before preview-shelf.js and seen to fail against an empty stand-in.
// Fixtures come from Pandoc 3.11 (make-fixtures.sh); nothing here needs Pandoc.
import { readFileSync } from 'node:fs';
import { check, eq, done } from '../../mathcat-wasm/test/lib.mjs';
import { readZipEntries } from './zip-node.mjs';
import * as S from '../preview-shelf.js';

const dec = new TextDecoder();
const fixture = (p) => readFileSync(new URL('./fixtures/' + p, import.meta.url));
const wb = await readZipEntries('./fixtures/workbook.zip');
const wbNum = await readZipEntries('./fixtures/workbook-numbered.zip');

// ---- 1. the shelf from Pandoc's zip -------------------------------------------
const shelf = S.shelfFromZipEntries(wb);
eq('S1 kind', shelf.kind, 'multipage');
eq('S1 start page', shelf.start, 'index.html');
eq('S1 pages in reading order (the zip order)', shelf.pages.map(p => p.name).join(' | '),
   'index.html | 0-workbook-sample-1.html | 1-sec:limits.html | 2-sec:deriv.html');
eq('S1 titles from <title>', shelf.pages.map(p => p.title).join(' | '),
   'Workbook Sample | Workbook Sample | Limits | Derivatives');
check('S1 page html is the untouched text', shelf.pages[2].html === dec.decode(wb.find(e => e.name === '1-sec:limits.html').data));
eq('S1 images shown: png, jpg, svg', [...shelf.images.keys()].sort().join(' | '),
   'figures/curve.svg | figures/photo.jpg | figures/plot.png');
eq('S1 svg labelled with its type', shelf.images.get('figures/curve.svg').type, 'image/svg+xml');
eq('S1 jpg labelled with its type', shelf.images.get('figures/photo.jpg').type, 'image/jpeg');
check('S1 image bytes kept', shelf.images.get('figures/plot.png').data instanceof Uint8Array);
eq('S1 other files', shelf.others.join(' | '), 'sitemap.json | figures/anim.gif');
check('S1 page lookup', S.getPage(shelf, '2-sec:deriv.html')?.title === 'Derivatives');
check('S1 page lookup: not a page', S.getPage(shelf, 'figures/plot.png') === null);

// ---- 2. the page list (Page drop-down) ----------------------------------------
const list = S.pageList(shelf);
eq('S2 labels, title page with a table of contents reads Contents', list.map(p => p.label).join(' | '),
   'Contents | Workbook Sample | Limits | Derivatives');
eq('S2 positions', list.map(p => p.position + '/' + p.count).join(' '), '1/4 2/4 3/4 4/4');
const listNum = S.pageList(S.shelfFromZipEntries(wbNum));
eq('S2 no table of contents: a shared title gets the file name', listNum.slice(0, 2).map(p => p.label).join(' | '),
   'Workbook Sample (index.html) | Workbook Sample (001.html)');

// ---- 3. paths ---------------------------------------------------------------
eq('S3 plain', S.resolvePath('1-sec:limits.html', 'figures/plot.png'), 'figures/plot.png');
eq('S3 ./', S.resolvePath('index.html', './figures/curve.svg'), 'figures/curve.svg');
eq('S3 from a folder', S.resolvePath('ch1/page.html', 'img/a.png'), 'ch1/img/a.png');
eq('S3 ../ inside the output', S.resolvePath('ch1/page.html', '../img/a.png'), 'img/a.png');
eq('S3 ../ out of the output', S.resolvePath('page.html', '../a.png'), null);
eq('S3 %20 decoded', S.resolvePath('p.html', 'my%20fig.png'), 'my fig.png');
eq('S3 query and fragment dropped', S.resolvePath('p.html', 'a.png?v=2#x'), 'a.png');
eq('S3 bad escape kept as written', S.resolvePath('p.html', 'a%zz.png'), 'a%zz.png');

// ---- 4. links, sorted from the page they are on -------------------------------
const L = (href, from = '1-sec:limits.html', sh = shelf) => JSON.stringify(S.classifyLink(sh, from, href));
eq('S4 #id', L('#fn1'), '{"kind":"same","fragment":"fn1"}');
eq('S4 this page by name (Pandoc writes these)', L('1-sec:limits.html#sec:limits'), '{"kind":"same","fragment":"sec:limits"}');
eq('S4 another page, a section', L('2-sec:deriv.html#sec:deriv'), '{"kind":"page","page":"2-sec:deriv.html","fragment":"sec:deriv"}');
eq('S4 another page, no section', L('0-workbook-sample-1.html'), '{"kind":"page","page":"0-workbook-sample-1.html","fragment":""}');
eq('S4 web link', L('https://example.org/page'), '{"kind":"web","url":"https://example.org/page"}');
eq('S4 web link without a scheme', L('//example.org/x'), '{"kind":"web","url":"https://example.org/x"}');
eq('S4 mailto', L('mailto:someone@example.org'), '{"kind":"other","reason":"scheme","href":"mailto:someone@example.org"}');
eq('S4 javascript', L('javascript:alert(1)'), '{"kind":"other","reason":"scheme","href":"javascript:alert(1)"}');
eq('S4 a file that is not a page', L('figures/plot.png'), '{"kind":"other","reason":"not-a-page","href":"figures/plot.png"}');
eq('S4 a page not in the output', L('nothere.html'), '{"kind":"other","reason":"not-in-output","href":"nothere.html"}');
eq('S4 a site-root address', L('/abs.html'), '{"kind":"other","reason":"not-in-output","href":"/abs.html"}');
eq('S4 empty', L(''), '{"kind":"same","fragment":""}');
eq('S4 %-escaped fragment', L('#a%20b'), '{"kind":"same","fragment":"a b"}');
const colonShelf = { kind: 'multipage', start: 'sec:intro.html', pages: [{ name: 'sec:intro.html', title: 'I', html: '' }, { name: 'sec:limits.html', title: 'L', html: '' }], images: new Map(), others: [] };
eq('S4 a page name that looks like a web address: the shelf is checked first', L('sec:limits.html#x', 'sec:intro.html', colonShelf), '{"kind":"page","page":"sec:limits.html","fragment":"x"}');

// ---- 5. image marking (preview copy only) -------------------------------------
const p1 = S.markImages(S.getPage(shelf, '1-sec:limits.html').html, '1-sec:limits.html', shelf);
eq('S5 wanted', p1.wanted.join(' | '), 'figures/plot.png | figures/photo.jpg');
check('S5 no image left pointing at a relative address', !/<img[^>]*\ssrc="figures\//.test(p1.html), p1.html.match(/<img[^>]*>/g));
check('S5 marked with the resolved path and state', p1.html.includes('data-astem-preview-src="figures/plot.png" data-astem-preview-state="wanted"'));
check('S5 alt kept', /<img alt="image" data-astem-preview-src="figures\/plot.png"|<img data-astem-preview-src="figures\/plot.png"[^>]*alt="image"/.test(p1.html), p1.html.match(/<img[^>]*>/g));
const p2 = S.markImages(S.getPage(shelf, '2-sec:deriv.html').html, '2-sec:deriv.html', shelf);
eq('S5 svg wanted', p2.wanted.join(' | '), 'figures/curve.svg');
eq('S5 gif not shown', p2.unsupported.join(' | '), 'figures/anim.gif');
check('S5 gif marked, not requested from GitHub', p2.html.includes('data-astem-preview-src="figures/anim.gif" data-astem-preview-state="unsupported"'));
const odd = S.markImages(`<img src='figures/plot.png' alt=x><img data-src="figures/plot.png"><img src="data:image/png;base64,AA"><img src="https://e.org/a.png"><IMG SRC="figures/photo.jpg">`, 'p.html', shelf);
eq('S5 single quotes and upper case found; data-src, data: and web images left alone', odd.wanted.join(' | '), 'figures/plot.png | figures/photo.jpg');
check('S5 data: untouched', odd.html.includes('src="data:image/png;base64,AA"'));
check('S5 web image untouched', odd.html.includes('src="https://e.org/a.png"'));
check('S5 data-src untouched', odd.html.includes('<img data-src="figures/plot.png">'));
const outside = S.markImages('<img src="../x.png">', 'p.html', shelf);
eq('S5 climbing out of the output: missing', outside.missing.join(), '../x.png');
check('S5 missing image marked', outside.html.includes('data-astem-preview-state="missing"'));

// ---- 6. the shelf from a single page -------------------------------------------
const single = dec.decode(fixture('single.html'));
const files = {};   // as lastOutput.files: project path -> Blob (here, Blob from the fixture source folder)
for (const f of ['figures/plot.png', 'figures/curve.svg', 'figures/photo.jpg', 'single.tex'])
  files[f] = new Blob([fixture('src/' + f)]);
const one = await S.shelfFromPage({ name: 'single.html', html: single, files });
eq('S6 kind', one.kind, 'single');
eq('S6 one page, named as the download', one.pages.map(p => p.name).join(), 'single.html');
eq('S6 title', one.pages[0].title, 'Problem Set 3');
eq('S6 images taken from the conversion\'s files', [...one.images.keys()].sort().join(' | '),
   'figures/curve.svg | figures/photo.jpg | figures/plot.png');
eq('S6 only images the page uses', one.images.has('single.tex'), false);
eq('S6 page list for one page', JSON.stringify(S.pageList(one).map(p => [p.label, p.position, p.count])), '[["Problem Set 3",1,1]]');
const noFiles = await S.shelfFromPage({ name: 'x.html', html: '<img src="a.png">', files: null });
eq('S6 no files given', noFiles.images.size, 0);

// ---- 7. image problems, found once per output (D4) -----------------------------
const probs1 = S.findImageProblems(one);
eq('S7 single page: the missing image', JSON.stringify(probs1.missing), '[{"page":"single.html","path":"figures/missing.png"}]');
const wbLess = S.shelfFromZipEntries(wb.filter(e => e.name !== 'figures/plot.png'));
const probs2 = S.findImageProblems(wbLess);
eq('S7 multipage: a missing image, named with its page', JSON.stringify(probs2.missing), '[{"page":"1-sec:limits.html","path":"figures/plot.png"}]');
eq('S7 multipage: an image type the preview does not show', JSON.stringify(probs2.unsupported), '[{"page":"2-sec:deriv.html","path":"figures/anim.gif"}]');
eq('S7 complete output: nothing missing', S.findImageProblems(shelf).missing.length, 0);

// ---- 8. placing the helpers ----------------------------------------------------
eq('S8 before the last </body>', S.insertBeforeBodyEnd('<body>a</body><!-- </body> --></body>', 'X'), '<body>a</body><!-- </body> -->X</body>');
eq('S8 any case', S.insertBeforeBodyEnd('<BODY>a</BODY>', 'X'), '<BODY>aX</BODY>');
eq('S8 no </body>: appended', S.insertBeforeBodyEnd('<p>a</p>', 'X'), '<p>a</p>X');

// ---- 9. links naming the page they are on (preview copy only; 2026-10-10) -------------
// With <base href="about:srcdoc"> in the preview copy the browser follows "#…" links itself,
// as on any website, so screen readers follow them too. A link that names its own page
// (Pandoc writes these) becomes "#…" there. (The guards let these fail, not crash, before
// the functions exist.)
const R = (html, from = '1-sec:limits.html', sh = shelf) => S.rewriteSelfLinks ? S.rewriteSelfLinks(html, from, sh) : html;
const lim = shelf.pages[2].html;   // 1-sec:limits.html
check('S9 this page by name, with a section: "#section"', R(lim).includes('href="#sec:limits"') && !R(lim).includes('href="1-sec:limits.html#sec:limits"'));
eq('S9 nothing else in the page changed', R(lim).replace('href="#sec:limits"', 'href="1-sec:limits.html#sec:limits"'), lim);
eq('S9 the page name alone: "#" (the top)', R('<a href="1-sec:limits.html">top</a>'), '<a href="#">top</a>');
eq('S9 ./name, %-escaped name, single quotes, no quotes, HREF; other attributes kept',
   R(`<a class="x" href="./1-sec:limits.html#a">1</a><a href='1-sec%3Alimits.html#b' id=k>2</a><a href=1-sec:limits.html#c>3</a><A HREF="1-sec:limits.html#d">4</A>`),
   `<a class="x" href="#a">1</a><a href="#b" id=k>2</a><a href="#c">3</a><A href="#d">4</A>`);
eq('S9 a section written with an entity stays written that way', R('<a href="1-sec:limits.html#a&amp;b">e</a>'), '<a href="#a&amp;b">e</a>');
const untouchedLinks = '<a href="">a</a><a href="#">b</a><a href="#fn1">c</a><a href="index.html#z">d</a>'
  + '<a href="2-sec:deriv.html">e</a><a href="https://example.org/1-sec:limits.html#x">f</a><a href="/1-sec:limits.html#y">g</a>'
  + '<a href="mailto:a@b.org">h</a><a id="k">i</a><area href="1-sec:limits.html#z"><abbr title="1-sec:limits.html#q">j</abbr>';
eq('S9 untouched: empty, #…, other pages, web, site-root, mailto, no href, <area>, <abbr>', R(untouchedLinks), untouchedLinks);
const oneShelf = { kind: 'single', start: 'single.html', pages: [{ name: 'single.html', title: '', html: '' }], images: new Map(), others: [] };
eq('S9 a single page by its own name', R('<a href="single.html#p2">x</a>', 'single.html', oneShelf), '<a href="#p2">x</a>');

// ---- 10. tags at the start of <head> (where the preview copy's <base> goes) -----------
const H = (html, tags) => S.insertAtHeadStart ? S.insertAtHeadStart(html, tags) : html;
eq('S10 just after <head>', H('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">', 'X'), '<!DOCTYPE html>\n<html>\n<head>X\n<meta charset="utf-8">');
eq('S10 any case, with attributes; <header> is not <head>', H('<header>h</header><HEAD lang="en"><title>t</title>', 'X'), '<header>h</header><HEAD lang="en">X<title>t</title>');
eq('S10 only the first <head>', H('<head></head><p>&lt;head&gt;</p><head>', 'X'), '<head>X</head><p>&lt;head&gt;</p><head>');
eq('S10 no <head>: after the doctype and <html>', H('<!doctype html>\n<html lang="en"><p>a</p>', 'X'), '<!doctype html>\n<html lang="en">X<p>a</p>');
eq('S10 a bare fragment: at the start', H('<p>a</p>', 'X'), 'X<p>a</p>');

done('test-shelf');
