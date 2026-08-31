// test-asset-urls.mjs — every relative URL inside an extracted module must
// resolve to a file that exists.
//
// This suite exists because of a bug the other suites could not see: when
// the intent code moved from index.html into intent/intent-review.js, its
// './math-conversion/intent-scan.js' started resolving against the MODULE's
// url instead of the page's, producing /intent/math-conversion/... and a
// 404 at runtime. Node's jsdom tests never fetch, so nothing caught it.
//
// Resolve each URL exactly as a browser would and stat the result.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const PLAT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('   ok   ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? ' :: ' + d : '')); } };

/** Every .js file in the module folders index.html imports from. */
function modules(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) modules(p, out);
    else if (e.name.endsWith('.js') && !e.name.includes('.bak')) out.push(p);
  }
  return out;
}

const FOLDERS = ['intent', 'cleanup', 'js'];
const files = FOLDERS.flatMap(f => existsSync(join(PLAT, f))
  ? modules(join(PLAT, f)) : []);
ok('found the extracted modules', files.length >= 6, String(files.length));

// import.meta.url-relative form: new URL('...', import.meta.url)
const META = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
// ANY bare relative path literal. The bug that prompted this suite was
// `const BUNDLE_URL = './math-conversion/intent-scan.js';` — a plain
// constant, nowhere near the import() that later consumed it — so checking
// only the call sites would have missed it. Check every literal instead.
const BARE = /['"](\.{1,2}\/[^'"\s]*\.[A-Za-z0-9]{2,5})['"]/g;

let checked = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const base = pathToFileURL(f);

  for (const m of src.matchAll(META)) {
    const resolved = fileURLToPath(new URL(m[1], base));
    checked++;
    ok(`${f.slice(PLAT.length + 1)} -> ${m[1]}`, existsSync(resolved),
       'resolves to ' + resolved);
  }

  // A bare './x' inside a module is a latent trap: import() resolves it
  // against the MODULE url and fetch() against the DOCUMENT base url, so
  // the same string means two different things in the same file.
  for (const m of src.matchAll(BARE)) {
    const around = src.slice(Math.max(0, m.index - 120), m.index + 120);
    if (around.includes('import.meta.url')) continue;   // already pinned
    checked++;
    ok(`${f.slice(PLAT.length + 1)}: bare relative URL ${m[1]}`, false,
       'use new URL(..., import.meta.url) — import() and fetch() resolve '
       + 'this differently from inside a module');
  }
}
ok('at least one asset URL was checked', checked > 0, String(checked));

// The two intent assets specifically, since they are the ones that broke.
for (const rel of ['math-conversion/intent-scan.js',
                   'math-conversion/intent-vocabulary.json']) {
  const p = join(PLAT, ...rel.split('/'));
  ok('asset present: ' + rel, existsSync(p),
     existsSync(p) ? '' : 'missing');
  if (existsSync(p)) {
    ok('asset non-empty: ' + rel, statSync(p).size > 1000,
       String(statSync(p).size));
  }
}

console.log(`\nasset urls: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
