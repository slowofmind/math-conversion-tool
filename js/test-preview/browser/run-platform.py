# run-platform.py — the REAL platform (index.html with the wiring patch applied), in
# headless Chromium: converts samples/13-workbook-demo.zip to HTML (multipage) and to
# HTML (one page), then uses the Output view.
#   python run-platform.py [path-to-chromium] [--npm-cdn]        (cwd: js/test-preview/browser)
# --npm-cdn: only where jsDelivr can't be reached (the claude.ai sandbox); see cdn() below.
import asyncio, functools, http.server, mimetypes, os, re, subprocess, sys, tarfile, tempfile, threading
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[3]
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8767), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
# jsDelivr's /npm/<package>@<version>/<file> is the npm package's own file. Where the CDN can't be
# reached (this sandbox), the same file is served from the package fetched from the npm registry.
CACHE = Path(tempfile.gettempdir()) / 'npm-cdn'   # used only with --npm-cdn
def npm_file(pkg, ver, path):
    CACHE.mkdir(exist_ok=True)
    d = CACHE / (pkg.replace('/', '__') + '@' + ver)
    if not d.exists():
        out = subprocess.run([('npm.cmd' if os.name == 'nt' else 'npm'), 'pack', f'{pkg}@{ver}', '--silent', '--pack-destination', str(CACHE)], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
        with tarfile.open(CACHE / out) as t: t.extractall(d)
    f = d / 'package' / path
    return f if f.is_file() else None
async def cdn(route):
    m = re.match(r'https://cdn\.jsdelivr\.net/npm/((?:@[^/]+/)?[^@/]+)@([^/]+)/(.+)$', route.request.url.split('?')[0])
    f = m and npm_file(m.group(1), m.group(2), m.group(3))
    if not f: return await route.abort()
    await route.fulfill(path=str(f), content_type=mimetypes.guess_type(str(f))[0] or 'application/javascript')

passed = failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print('  FAIL', name, ('\n       ' + str(detail)) if detail != '' else '')

async def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    exe = args[0] if args else None
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': exe} if exe else {}))
        pg = await b.new_page(viewport={'width': 1400, 'height': 900})
        if '--npm-cdn' in sys.argv:
            await pg.route('https://cdn.jsdelivr.net/npm/**', cdn)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        # E7: record each fetch() and the cache mode it asks for (in every frame; read in the platform's)
        await pg.add_init_script('''(() => {
          const real = window.fetch; window.__astemFetches = [];
          window.fetch = function (input, init) {
            try {
              window.__astemFetches.push({ url: String((input && input.url) || input),
                cache: (init && init.cache) || (input && typeof input === 'object' && input.cache) || 'default' });
            } catch (e) { /* recording only */ }
            return real.apply(this, arguments);
          };
        })()''')
        await pg.goto('http://127.0.0.1:8767/index.html')
        await pg.wait_for_function('!document.getElementById("btnConvert").disabled', timeout=180000)
        fr = lambda: [f for f in pg.frames if f.parent_frame == pg.main_frame and f.name != 'x'][0]
        def preview(): return [f for f in pg.frames if f.parent_frame == pg.main_frame][0]
        await pg.evaluate('document.querySelector(\'[data-sample="samples/13-workbook-demo.zip"]\').click()')
        await pg.wait_for_timeout(4000)

        # ---- HTML (multipage) ----
        await pg.select_option('#selTo', 'chunkedhtml')
        await pg.click('#btnConvert')
        # No Page drop-down (removed 2026-10-10, Nicholas: "I agree with removing the "page" dropdown"):
        # the frame's spoken name gives the position; the pages' own links move between pages.
        await pg.wait_for_function('/, page 1 of \\d+$/.test(document.getElementById("previewFrame").title)', timeout=180000)
        await pg.wait_for_timeout(1500)
        title = await pg.evaluate('document.getElementById("previewFrame").title')
        n = int(re.search(r'of (\d+)$', title).group(1))
        check('E1 the output has its pages', n > 5, title)
        check('E1 frame name: the title page, page 1 of n', title.startswith('HTML output: ') and title.endswith(f'page 1 of {n}'), title)
        check('E1 no Page drop-down', await pg.evaluate('!document.getElementById("selPreviewPage") && !document.getElementById("previewPageBox") && !document.getElementById("selPreviewPageWhy")'))
        dl = await pg.evaluate('document.getElementById("btnDownloadOutput").dataset.titleAvailable')
        check('E1 Download still offers Pandoc\'s zip', '.zip (' in dl and await pg.get_attribute('#btnDownloadOutput', 'aria-disabled') is None, dl)
        lbl = await pg.evaluate('document.getElementById("sourceViewerLabel").textContent')
        check('E1 Code view label', lbl == f'Page 1 of {n}: index.html', lbl)
        check('E1 Math subtitles available', await pg.get_attribute('#selMathSubtitles', 'aria-disabled') is None)
        nxt = await preview().evaluate('document.querySelector("a[rel=next]")?.getAttribute("href") || null')
        check('E2 the title page has a Next link', bool(nxt), nxt)
        if nxt:
            await pg.frame_locator('#previewFrame').locator('a[rel="next"]').first.click(); await pg.wait_for_timeout(2000)
            lbl = await pg.evaluate('document.getElementById("sourceViewerLabel").textContent')
            check('E2 Code view follows', lbl.endswith(': ' + nxt) and lbl.startswith('Page 2 of'), lbl)
            code = await pg.evaluate('document.querySelector("#outputSource .cm-content")?.textContent || ""')
            check('E2 Code view shows the untouched page (no helper)', 'astem-preview' not in code and len(code) > 100, len(code))
            check('E2 frame name follows', (await pg.evaluate('document.getElementById("previewFrame").title')).endswith(f'page 2 of {n}'))
        # links that stay on the page, as this sample writes them (no cross-page section links here;
        # those are covered by run-browser.py): "#fig-..." and the page's own name with a section
        # page 2's Next link leads to 1-unit-derivative.html (the drop-down's job until 2026-10-10)
        await pg.frame_locator('#previewFrame').locator('a[rel="next"]').first.click(); await pg.wait_for_timeout(2000)
        lbl = await pg.evaluate('document.getElementById("sourceViewerLabel").textContent')
        check('E3 Next again: on 1-unit-derivative.html', lbl.endswith(': 1-unit-derivative.html'), lbl)
        f = preview()
        # Same-page links are the browser's own in the preview copy (2026-10-10): <base href="about:srcdoc">
        # first in <head>, links naming their own page written "#…", and the helper leaves them alone.
        base_first = 'document.head.firstElementChild?.tagName === "BASE" && document.head.firstElementChild.getAttribute("href") === "about:srcdoc"'
        record = 'window.__sameDocument = "yes"; window.__prevented = []; addEventListener("click", (e) => { if (e.target.closest && e.target.closest("a[href]")) window.__prevented.push(e.defaultPrevented); })'
        async def mathjax_drawn(fr):
            n = 0
            for _ in range(80):
                n = await fr.evaluate('document.querySelectorAll("mjx-container").length')
                if n: break
                await pg.wait_for_timeout(250)
            return n
        check('E3 the preview copy starts its head with <base href="about:srcdoc">', await f.evaluate(base_first))
        own = 'document.querySelectorAll(\'a[href^="1-unit-derivative.html"]\').length'
        check('E3 no link in the preview copy names its own page', await f.evaluate(own) == 0, await f.evaluate(own))
        await f.evaluate(record)
        # found by its "#…" href or, before 2026-10-10, as Pandoc wrote it
        await pg.frame_locator('#previewFrame').locator('a[href="#lesson-related-rates"], a[href="1-unit-derivative.html#lesson-related-rates"]').first.click(); await pg.wait_for_timeout(800)
        check('E3 own page by name: same document, jumped', await f.evaluate('window.__sameDocument') == 'yes' and await f.evaluate('location.hash') == '#lesson-related-rates', await f.evaluate('location.hash'))
        check('E3 ... the section is :target', await f.evaluate('document.querySelector(":target")?.id') == 'lesson-related-rates')
        await pg.frame_locator('#previewFrame').locator('a[href="#fig-tangent-line"]').first.click(); await pg.wait_for_timeout(800)
        check('E3 figure link: same document, jumped', await f.evaluate('window.__sameDocument') == 'yes' and await f.evaluate('location.hash') == '#fig-tangent-line', await f.evaluate('location.hash'))
        check('E3 the platform never loads inside the frame', await f.evaluate('!document.querySelector("#btnConvert")'))
        check('E3 the browser followed both itself (not caught)', await f.evaluate('JSON.stringify(window.__prevented)') == '[false,false]', await f.evaluate('JSON.stringify(window.__prevented)'))
        mj = await mathjax_drawn(f)
        check('E3 MathJax drew the math in the preview copy', mj > 0, mj)
        log = await pg.evaluate('document.getElementById("logContainer").textContent')
        check('E3 no preview image problems in the Log for this sample', 'not in the output' not in log, log[:300])

        # ---- HTML, one page, Canvas style ----
        await pg.select_option('#selTo', 'html5')
        await pg.select_option('#opt-style', 'canvas')
        await pg.click('#btnConvert')
        await pg.wait_for_function('document.getElementById("previewFrame").title === "HTML output"', timeout=180000)
        await pg.wait_for_timeout(1500)
        check('E4 one page: plain frame name', await pg.evaluate('document.getElementById("previewFrame").title') == 'HTML output')
        check('E4 one page: Code view label hidden', await pg.evaluate('document.getElementById("sourceViewerLabel").hidden'))
        f = preview()
        check('E5 one page: the preview copy has the <base> too', await f.evaluate(base_first))
        await f.evaluate(record)
        same = await f.evaluate('[...document.querySelectorAll("a[href^=\'#\']")].map(a => a.getAttribute("href")).filter(h => h.length > 1)[0] || null')
        if same:
            await pg.frame_locator('#previewFrame').locator(f'a[href="{same}"]').first.click(); await pg.wait_for_timeout(800)
            check('E5 a same-page link jumps, and the platform does not load inside', await f.evaluate('window.__sameDocument') == 'yes' and await f.evaluate('location.hash') == same, [same, await f.evaluate('location.hash')])
            check('E5 ... the browser\'s own (not caught)', await f.evaluate('JSON.stringify(window.__prevented)') == '[false]', await f.evaluate('JSON.stringify(window.__prevented)'))
        else:
            print('  (no same-page link in this output; E5 skipped)')
        mj = await mathjax_drawn(f)
        check('E5 MathJax drew the math in the one page\'s preview copy', mj > 0, mj)
        # E7: the platform's small text files ask the browser to check with the server each time
        # (cache 'no-cache'), so an old copy can't stand in for an updated one (2026-10-10: a stray
        # "false" came back from Chrome's cached copy of the old filter). Large binaries are left alone.
        seen = await pg.evaluate('window.__astemFetches')
        for want in ('filters/mathjax-intent-toggle.lua', 'filters/styling.lua', 'styles/canvas.css',
                     'js/preview-helper.js', 'js/mathcat-proof-agent.js'):
            mine = [s for s in seen if s['url'].split('?')[0].endswith('/' + want)]
            check('E7 fetched: ' + want, bool(mine), len(seen))
            check('E7 no-cache: ' + want, bool(mine) and all(s['cache'] == 'no-cache' for s in mine), mine)
        check('E6 no script errors on the platform page', not errors, errors)
        await b.close()
    print(f'run-platform: {passed} passed, {failed} failed')
    srv.shutdown(); sys.exit(1 if failed else 0)
asyncio.run(main())
