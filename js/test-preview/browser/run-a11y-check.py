# run-a11y-check.py — the accessibility check (Sa11y in the preview) in the REAL platform, headless.
#   python run-a11y-check.py [path-to-chromium] [--index PATH] [--npm-cdn]   (cwd: js/test-preview/browser)
# --index PATH: serve PATH as index.html (to test a patched copy before it goes into the repo).
# --npm-cdn: only where jsDelivr can't be reached (the claude.ai sandbox), as in run-platform.py.
# Plan: accessibility-checker\PLAN-ACCESSIBILITY-CHECKER.md. Nicholas, 2026-10-18 (verbatim in the plan):
# "On/off should be as you describe...off by default (for now)". Written before the wiring and seen to fail.
import asyncio, functools, http.server, mimetypes, os, re, subprocess, sys, tarfile, tempfile, threading
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[3]
FIX = ROOT / 'js' / 'test-preview' / 'fixtures' / 'src'
INDEX = None
if '--index' in sys.argv:
    INDEX = Path(sys.argv[sys.argv.index('--index') + 1]).resolve()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        if INDEX and path.split('?')[0] in ('/', '/index.html'): return str(INDEX)
        return super().translate_path(path)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8768), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
CACHE = Path(tempfile.gettempdir()) / 'npm-cdn'
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

HAS_SA11Y = '!!document.querySelector("script[data-astem-a11y-agent], script[data-astem-a11y], sa11y-control-panel")'
RESULTS = '''(() => (window.sa11yCheckComplete && window.sa11yCheckComplete.results || [])
  .filter(r => r.type !== 'good')
  .map(r => { const el = r.element && r.element.nodeType === 1 ? r.element : (r.element && r.element.parentElement) || null;
    return { test: r.test, type: r.type,
             inMath: !!(el && el.closest && el.closest('mjx-container')),
             where: el ? (el.textContent || '').replace(/\\s+/g, ' ').slice(0, 80) : '',
             text: (r.content && r.content.textContent || String(r.content || '')).replace(/\\s+/g, ' ') }; }))()'''

async def main():
    argv = sys.argv[1:]
    exe = None
    i = 0
    while i < len(argv):
        if argv[i] == '--index': i += 2; continue
        if not argv[i].startswith('--') and exe is None: exe = argv[i]
        i += 1
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': exe} if exe else {}))
        ctx = await b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        if '--npm-cdn' in sys.argv:
            await ctx.route('https://cdn.jsdelivr.net/npm/**', cdn)
        pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto('http://127.0.0.1:8768/index.html')
        await pg.wait_for_function('!document.getElementById("btnConvert").disabled', timeout=180000)

        async def frame():
            return await (await pg.query_selector('#previewFrame')).content_frame()
        async def mark():
            try: await (await frame()).evaluate('window.__astemTestOld = true')
            except Exception: pass
        async def wait_new(cond, timeout=60):
            # a NEW document in the preview (not the one marked), for which cond is true
            for _ in range(timeout * 4):
                try:
                    f = await frame()
                    if await f.evaluate('!window.__astemTestOld && document.readyState === "complete" && (' + cond + ')'): return f
                except Exception: pass
                await pg.wait_for_timeout(250)
            return None
        MATH_DRAWN = 'document.querySelectorAll("mjx-container").length > 0'
        SA11Y_DONE = '!!window.sa11yCheckComplete'
        async def convert(files=None, to='html5', cond=MATH_DRAWN):
            if files:
                await pg.set_input_files('#fileInput', files); await pg.wait_for_timeout(2500)
            await pg.select_option('#selTo', to)
            try: await pg.select_option('#opt-style', 'standalone')
            except Exception: pass
            await mark()
            await pg.click('#btnConvert')
            return await wait_new(cond, 180)

        # ---- B1: the button ----
        btn = '#btnA11yCheck'
        n = await pg.locator(btn).count()
        check('B1 the button is there', n == 1, n)
        if n != 1:
            await b.close(); print(f'run-a11y-check: {passed} passed, {failed} failed'); srv.shutdown(); sys.exit(1)
        check('B1 its name', (await pg.locator(btn).inner_text()).strip() == 'Accessibility check', await pg.locator(btn).inner_text())
        check('B1 off by default', await pg.get_attribute(btn, 'aria-pressed') == 'false', await pg.get_attribute(btn, 'aria-pressed'))
        check('B1 beside Download', await pg.evaluate('document.getElementById("btnA11yCheck").nextElementSibling?.id') == 'btnDownloadOutput')
        check('B1 no title text (help messages to be mapped out later)', await pg.get_attribute(btn, 'title') is None)

        # ---- B2: off: the preview is exactly as before ----
        f = await convert([str(FIX / 'a11y-demo.tex'), str(FIX / 'figures' / 'plot.png')])
        check('B2 converted, maths drawn', f is not None)
        if f: check('B2 off: nothing of Sa11y in the preview', not await f.evaluate(HAS_SA11Y))

        # ---- B3-B7: on: Sa11y runs in the preview, with the platform's settings ----
        await mark()
        await pg.click(btn)
        check('B3 pressed', await pg.get_attribute(btn, 'aria-pressed') == 'true')
        f = await wait_new(SA11Y_DONE)
        check('B3 Sa11y finished in the preview', f is not None)
        res = await f.evaluate(RESULTS) if f else []
        tests = sorted({r['test'] for r in res})
        for t in ('ALT_PLACEHOLDER', 'HEADING_SKIPPED_LEVEL', 'TABLES_MISSING_HEADINGS', 'ASTEM_MATH_UNCONVERTED',
                  'CONTRAST_ERROR', 'QA_FAKE_HEADING', 'LINK_CLICK_HERE', 'META_LANG'):
            check('B3 found ' + t, t in tests, tests)
        inmath = [r for r in res if r['inMath'] and r['test'] != 'ASTEM_MATH_UNCONVERTED']
        check('B4 nothing reported inside an equation except the maths check', not inmath, inmath)
        astem = [r for r in res if r['test'] == 'ASTEM_MATH_UNCONVERTED']
        said = ' | '.join(r['text'] for r in astem)
        check('B5 one message per equation (\\im(T), \\rref(A) twice)', len(astem) == 3, said)
        check('B5 names \\im', '\\im' in said, said)
        check('B5 names \\rref', '\\rref' in said, said)
        alt = next((r for r in res if r['test'] == 'ALT_PLACEHOLDER'), None)
        check('B6 placeholder message points to the LaTeX', bool(alt) and '\\includegraphics[alt=' in alt['text'], alt)
        cc = [r for r in res if r['test'] == 'CONTRAST_ERROR']
        check('B6 contrast: only the light-grey hint', bool(cc) and all('Hint' in r['where'] for r in cc), cc)
        if f: check('B7 Sa11y\'s own panel is there', await f.evaluate('!!document.querySelector("sa11y-control-panel")'))

        # ---- B8: the download and the Code view never carry it ----
        async with pg.expect_download() as dl:
            await pg.click('#btnDownloadOutput')
        d = await dl.value
        data = Path(await d.path()).read_bytes()
        check('B8 download: an HTML file', d.suggested_filename.endswith('.html'), d.suggested_filename)
        check('B8 download: nothing of Sa11y', b'sa11y' not in data.lower() and b'astem-a11y' not in data, len(data))
        code = await pg.evaluate('document.querySelector("#outputSource .cm-content")?.textContent || ""')
        check('B8 Code view: nothing of Sa11y', 'sa11y' not in code.lower() and len(code) > 100, len(code))

        # ---- B9: stays on for the next conversion ----
        f = await convert(cond=SA11Y_DONE)
        check('B9 still on after a new conversion', await pg.get_attribute(btn, 'aria-pressed') == 'true' and f is not None)

        # ---- B10: off again: the preview is rebuilt without it ----
        await mark()
        await pg.click(btn)
        check('B10 not pressed', await pg.get_attribute(btn, 'aria-pressed') == 'false')
        f = await wait_new(MATH_DRAWN)
        check('B10 preview rebuilt', f is not None)
        if f: check('B10 off: nothing of Sa11y in the preview', not await f.evaluate(HAS_SA11Y))

        # ---- B11: multipage: each page is checked, page swaps keep it on ----
        await mark()
        await pg.click(btn)
        await wait_new(SA11Y_DONE)
        await pg.evaluate('document.querySelector(\'[data-sample="samples/13-workbook-demo.zip"]\').click()')
        await pg.wait_for_timeout(4000)
        f = await convert(to='chunkedhtml', cond=SA11Y_DONE)
        title = await pg.evaluate('document.getElementById("previewFrame").title')
        check('B11 multipage page 1 checked', f is not None and title.endswith('page 1 of ' + title.split(' of ')[-1]), title)
        await mark()
        await pg.frame_locator('#previewFrame').locator('a[rel="next"]').first.click()
        f = await wait_new(SA11Y_DONE)
        title = await pg.evaluate('document.getElementById("previewFrame").title')
        check('B11 page 2 checked too', f is not None and ', page 2 of ' in title, title)

        check('B12 no script errors on the platform page', not errors, errors)
        await b.close()
    print(f'run-a11y-check: {passed} passed, {failed} failed')
    srv.shutdown(); sys.exit(1 if failed else 0)
asyncio.run(main())
