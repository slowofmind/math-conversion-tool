# run-browser.py — the multipage preview in a real browser (headless Chromium), through
# mock-platform.html: what happens INSIDE the strictly sandboxed frame.
#   python run-browser.py [path-to-chromium]        (cwd: js/test-preview/browser)
# Needs Python Playwright. Serves the platform folder itself and logs every request,
# so it can show that no image is ever asked of the server.
import asyncio, functools, http.server, json, sys, threading
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]          # the platform folder
requests = []
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *a): requests.append(self.path)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8766/js/test-preview/browser/mock-platform.html?engine=fake'

passed = failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print('  FAIL', name, ('\n       ' + str(detail)) if detail != '' else '')

async def main():
    exe = sys.argv[1] if len(sys.argv) > 1 else None
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': exe} if exe else {}))
        ctx = await b.new_context()
        pg = await ctx.new_page()
        errors = []
        asked = []
        ctx.on('request', lambda r: asked.append(r.url))
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(URL); await pg.wait_for_function('window.harness && window.harness.ready')
        fl = pg.frame_locator('#previewFrame')
        def fr(): return [f for f in pg.frames if f.parent_frame == pg.main_frame][0]
        async def until_title(t):
            for _ in range(60):
                try:
                    if await fr().evaluate('document.title') == t: return True
                except Exception: pass
                await pg.wait_for_timeout(50)
            return False
        async def settle(): await pg.wait_for_timeout(400)
        frame_title = lambda: pg.evaluate('document.getElementById("previewFrame").title')
        status = lambda: pg.inner_text('#status')

        # ---- B1: a multipage output opens on its title page ----
        await pg.click('#btnMulti'); await until_title('Workbook Sample'); await settle()
        check('B1 index.html shown', await fr().evaluate('!!document.getElementById("TOC")'))
        check('B1 frame name', await frame_title() == 'HTML output: Contents, page 1 of 4', await frame_title())
        opts = await pg.evaluate('harness.pp.pages().map(p => `${p.label} (${p.position} of ${p.count})`)')
        check('B1 the pages, in reading order', opts == ['Contents (1 of 4)', 'Workbook Sample (2 of 4)', 'Limits (3 of 4)', 'Derivatives (4 of 4)'], opts)
        check('B1 no Page drop-down (removed 2026-10-10, as in index.html)', await pg.evaluate('!document.getElementById("selPreviewPage")'))
        check('B1 the Canvas script ran in the preview, harmlessly', await fr().evaluate('document.documentElement.style.height') == 'auto')

        # ---- B2: a table-of-contents link to another page's section ----
        await fl.locator('#TOC a[href="1-sec:limits.html#sec:one-sided"]').click(); await until_title('Limits'); await settle()
        f = fr()
        check('B2 swapped to Limits', await f.evaluate('document.title') == 'Limits')
        check('B2 landed on the section', await f.evaluate('location.hash') == '#sec:one-sided', await f.evaluate('location.hash'))
        check('B2 the section is :target', await f.evaluate('document.querySelector(":target")?.id') == 'sec:one-sided')
        check('B2 focus moved to the section (D6 start: auto)', await f.evaluate('document.activeElement.id') == 'sec:one-sided', await f.evaluate('document.activeElement.outerHTML.slice(0,80)'))
        box = await f.evaluate('(() => { const r = document.getElementById("sec:one-sided").getBoundingClientRect(); return [Math.round(r.top), innerHeight]; })()')
        check('B2 the section is in view', 0 <= box[0] < box[1], box)
        check('B2 the platform side follows', await pg.evaluate('harness.pp.current().name') == '1-sec:limits.html')
        check('B2 frame name follows', await frame_title() == 'HTML output: Limits, page 3 of 4', await frame_title())
        check('B2 platform told where it landed', (await pg.evaluate('JSON.stringify(harness.pp.lastLanding())')) == json.dumps({"page": "1-sec:limits.html", "fragment": "sec:one-sided", "found": True, "focused": "sec:one-sided"}, separators=(',', ':')), await pg.evaluate('JSON.stringify(harness.pp.lastLanding())'))

        # ---- B3, B4: links that stay on the page: the browser's own, as on any website (2026-10-10) ----
        base_first = 'document.head.firstElementChild?.tagName === "BASE" && document.head.firstElementChild.getAttribute("href") === "about:srcdoc"'
        check('B3 the preview copy starts its head with <base href="about:srcdoc">', await f.evaluate(base_first))
        # a listener after the helper's: was the click caught (defaultPrevented) or left to the browser?
        record = 'window.__sameDocument = "yes"; window.__prevented = []; addEventListener("click", (e) => { if (e.target.closest && e.target.closest("a[href]")) window.__prevented.push(e.defaultPrevented); })'
        await f.evaluate(record)
        await fl.locator('a[href="#fn1"]').click(); await settle()
        check('B3 footnote: same document, no reload', await f.evaluate('window.__sameDocument') == 'yes')
        check('B3 footnote: :target is the note', await f.evaluate('document.querySelector(":target")?.id') == 'fn1')
        check('B3 the platform never loads inside the frame', await f.evaluate('!document.getElementById("platform-marker")'))
        await fl.locator('a[href="#fnref1"]').click(); await settle()
        check('B3 back-link: :target is the marker', await f.evaluate('document.querySelector(":target")?.id') == 'fnref1')
        check('B3 the browser followed both itself (not caught)', await f.evaluate('JSON.stringify(window.__prevented)') == '[false,false]', await f.evaluate('JSON.stringify(window.__prevented)'))
        byname = fl.locator('a', has_text='the start of this')
        check('B4 this page by name is "#sec:limits" in the preview copy', await byname.get_attribute('href') == '#sec:limits', await byname.get_attribute('href'))
        await byname.click(); await settle()
        check('B4 this page by name: same document', await f.evaluate('window.__sameDocument') == 'yes')
        check('B4 ... jumped to the section', await f.evaluate('location.hash') == '#sec:limits')
        # The same links again after scrolling away: each time the browser's own jump, as on any
        # website (NVDA did not move on a repeat while the helper made the jump; 2026-10-10). A
        # spacer, added by this test only, makes the page tall enough to scroll away.
        await f.evaluate('document.body.insertAdjacentHTML("beforeend", "<div style=height:4000px></div>"); window.__prevented = []')
        for link, target in ((byname, 'sec:limits'), (fl.locator('a[href="#fn1"]'), 'fn1'), (fl.locator('a[href="#fn1"]'), 'fn1')):
            await f.evaluate('scrollTo(0, document.body.scrollHeight)'); await pg.wait_for_timeout(150)
            await link.click(); await settle()
            top = await f.evaluate('(id) => Math.round(document.getElementById(id).getBoundingClientRect().top)', target)
            check('B4 again after scrolling away: back at ' + target, -2 <= top < 50, top)
        check('B4 ... each time the browser\'s own jump (not caught)', await f.evaluate('JSON.stringify(window.__prevented)') == '[false,false,false]', await f.evaluate('JSON.stringify(window.__prevented)'))
        check('B4 ... same document, on the note', await f.evaluate('window.__sameDocument') == 'yes' and await f.evaluate('document.querySelector(":target")?.id') == 'fn1')

        # ---- B5, B6: web and mailto links (D5) ----
        popup = None
        try:
            async with ctx.expect_page(timeout=3000) as pinfo:
                await fl.locator('a[href="https://example.org/page"]').click()
            popup = await pinfo.value
        except Exception as e: popup = None
        await pg.wait_for_timeout(300)
        check('B5 web link opened a new tab for it (this sandbox has no internet, so the tab shows an error page)',
              popup is not None and 'https://example.org/page' in asked, [popup and popup.url, [u for u in asked if 'example' in u]])
        if popup: await popup.close()
        check('B5 ... the preview stayed put', await f.evaluate('window.__sameDocument') == 'yes')
        check('B5 ... and said so', (await status()).startswith('Opened in a new tab'), await status())
        await fl.locator('a[href^="mailto:"]').click(); await settle()
        check('B6 mailto: not followed, with a message', "isn't followed" in (await status()), await status())
        check('B6 ... the preview stayed put', await f.evaluate('window.__sameDocument') == 'yes')

        # ---- B7: separate images drawn from the shelf ----
        imgs = await f.evaluate('[...document.images].map(i => [i.dataset.astemPreviewSrc, i.dataset.astemPreviewState, i.naturalWidth > 0])')
        check('B7 PNG and JPG drawn', imgs == [['figures/plot.png', 'shown', True], ['figures/photo.jpg', 'shown', True]], imgs)

        # ---- B8: Next link, SVG drawn, GIF not ----
        await fl.locator('a[rel="next"]').first.click(); await until_title('Derivatives'); await settle()
        imgs = await fr().evaluate('[...document.images].map(i => [i.dataset.astemPreviewSrc, i.dataset.astemPreviewState, i.naturalWidth > 0, i.alt])')
        check('B8 SVG drawn, GIF not shown but its alt text kept', imgs == [['figures/curve.svg', 'shown', True, 'image'], ['figures/anim.gif', 'unsupported', False, 'image']], imgs)
        check('B8 no image ever asked of the server', not [r for r in requests if 'figures/' in r and 'fixtures/' not in r], [r for r in requests if 'figures' in r])

        # ---- B9: a page the platform shows itself (not from a link) leaves focus where it is ----
        # (the Page drop-down did this until 2026-10-10; showPage's default cause is still 'picker')
        await pg.focus('#btnMulti')
        await pg.evaluate('harness.pp.showPage("0-workbook-sample-1.html")'); await until_title('Workbook Sample'); await settle()
        check('B9 swapped to page 2', await fr().evaluate('document.body.textContent.includes("Opening paragraph")'))
        check('B9 focus stays where it was', await pg.evaluate('document.activeElement.id') == 'btnMulti', await pg.evaluate('document.activeElement.id'))
        check('B9 nothing focused inside the page', await fr().evaluate('document.activeElement === document.body'))

        # ---- B10: Math subtitles across swaps, reset by a new output (D1 a) ----
        await pg.select_option('#selMathSubtitles', 'mathcat'); await pg.wait_for_timeout(400)
        check('B10 MathCat chosen', await pg.evaluate('harness.proof.choice()') == 'mathcat')
        await fl.locator('a[rel="next"]').first.click(); await until_title('Limits'); await settle()
        await fl.locator('a[href="2-sec:deriv.html"]').first.click(); await until_title('Derivatives'); await settle()
        check('B10 two swaps later: still MathCat', await pg.evaluate('harness.proof.choice()') == 'mathcat')
        check('B10 drop-down still MathCat', await pg.eval_on_selector('#selMathSubtitles', 's => s.value') == 'mathcat')
        check('B10 the new page\'s helper has MathCat on', await fr().evaluate('!!document.querySelector("[data-astem-mathcat-agent]")') and await pg.evaluate('harness.proof.isEnabled()'))
        await pg.click('#btnMulti'); await until_title('Workbook Sample'); await settle()
        check('B10 a new output: back to Hidden', await pg.evaluate('harness.proof.choice()') == 'hide')
        check('B10 drop-down Hidden', await pg.eval_on_selector('#selMathSubtitles', 's => s.value') == 'hide')

        # ---- B11: a single page with separate images (Canvas style) ----
        requests.clear()
        await pg.click('#btnSingle'); await until_title('Problem Set 3'); await settle()
        imgs = await fr().evaluate('[...document.images].map(i => [i.dataset.astemPreviewSrc, i.dataset.astemPreviewState, i.naturalWidth > 0])')
        check('B11 PNG, ./SVG and JPG drawn; the missing one marked', imgs == [['figures/plot.png', 'shown', True], ['figures/curve.svg', 'shown', True], ['figures/missing.png', 'missing', False], ['figures/photo.jpg', 'shown', True]], imgs)
        check('B11 the missing image reported once', await pg.evaluate('JSON.stringify(window.lastProblems.missing)') == '[{"page":"single.html","path":"figures/missing.png"}]')
        check('B11 no image asked of the server', not [r for r in requests if r.startswith('/figures') or '/browser/figures' in r], requests)
        check('B11 one page: plain frame name', await frame_title() == 'HTML output')
        check('B11 the one page has the <base> too', await fr().evaluate(base_first))
        await fr().evaluate(record)
        await fl.locator('a[href="#p2"]').click(); await settle()
        check('B11 same-page link works on a single page', await fr().evaluate('window.__sameDocument') == 'yes' and await fr().evaluate('location.hash') == '#p2')
        check('B11 ... the browser\'s own (not caught)', await fr().evaluate('JSON.stringify(window.__prevented)') == '[false]', await fr().evaluate('JSON.stringify(window.__prevented)'))

        check('no script errors on the platform page', not errors, errors)
        await b.close()
    print(f'run-browser: {passed} passed, {failed} failed')
    srv.shutdown()
    sys.exit(1 if failed else 0)

asyncio.run(main())
