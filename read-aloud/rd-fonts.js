// read-aloud/rd-fonts.js: MathJax's fonts cut down to the characters a page uses.
//   usedCharacters(doc, css)  which characters each MathJax font family draws (needs a document to
//                             compute styles in; no layout or font files needed)
//   cutFonts(css, used)       rewrites MathJax's @font-face rules: fonts the page never uses are
//                             dropped; the others point at copies cut with HarfBuzz, embedded as data
// Fonts come from ./fonts-otf/<name>.otf.gz: MathJax's woff2 fonts converted once to plain OpenType
// (HarfBuzz can't read woff2) and gzipped for storage (tools/make-fonts-otf.py).
// Always keep the space: MathJax's tiny "ZERO" font holds only a space and sets every formula's line
// height; cut to nothing, browsers reject it and formulas grow taller.
const here = (p) => new URL(p, import.meta.url).href;
let subsetter = null;

async function loadSubsetter() {
  if (subsetter) return subsetter;
  const bytes = await (await fetch(here('./vendor/harfbuzz/harfbuzz-subset.wasm'))).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const x = instance.exports;
  subsetter = (fontBytes, codepoints) => {
    const ptr = x.malloc(fontBytes.length);
    new Uint8Array(x.memory.buffer).set(fontBytes, ptr);
    const blob = x.hb_blob_create(ptr, fontBytes.length, 2 /* writable */, 0, 0);
    const face = x.hb_face_create(blob, 0);
    x.hb_blob_destroy(blob);
    const input = x.hb_subset_input_create_or_fail();
    const uni = x.hb_subset_input_unicode_set(input);
    for (const c of codepoints) x.hb_set_add(uni, c);
    const out = x.hb_subset_or_fail(face, input);
    x.hb_subset_input_destroy(input);
    if (!out) { x.hb_face_destroy(face); x.free(ptr); throw new Error('HarfBuzz could not cut the font'); }
    const outBlob = x.hb_face_reference_blob(out);
    const at = x.hb_blob_get_data(outBlob, 0), len = x.hb_blob_get_length(outBlob);
    const result = new Uint8Array(x.memory.buffer).slice(at, at + len);
    x.hb_blob_destroy(outBlob); x.hb_face_destroy(out); x.hb_face_destroy(face); x.free(ptr);
    return result;
  };
  return subsetter;
}

async function fetchGunzip(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' not found (HTTP ' + r.status + ')');
  return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// containers: the drawn formulas (HTML). Puts them, with MathJax's styles, into a hidden box in
// `doc` and reads each text node's computed font-family.
export function usedCharacters(doc, css, containersHtml) {
  const style = doc.createElement('style');
  style.textContent = css.replace(/@font-face[^{]*\{[^}]*\}/g, '');   // styles only: no font files are needed to know which family a character uses
  const box = doc.createElement('div');
  box.style.cssText = 'position:absolute;left:-10000px;top:0;width:2000px';
  box.innerHTML = containersHtml;
  doc.head.appendChild(style); doc.body.appendChild(box);
  const byFamily = {};
  const walker = doc.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!el || el.closest('mjx-assistive-mml')) continue;
    const fams = doc.defaultView.getComputedStyle(el).fontFamily.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter((f) => /^MJX/i.test(f));
    for (const fam of fams) { byFamily[fam] = byFamily[fam] || new Set(); for (const ch of t.data) byFamily[fam].add(ch.codePointAt(0)); }
  }
  box.remove(); style.remove();
  return byFamily;
}

export async function cutFonts(css, used) {
  const cut = await loadSubsetter();
  const report = [];
  let total = 0;
  const rules = [...css.matchAll(/@font-face[^{]*\{[^}]*font-family:\s*([^;]+);[^}]*url\("FONTFILE:\/?([^"]+)"\)[^}]*\}/g)];
  for (const m of rules) {
    const family = m[1].trim(), file = m[2];
    const cps = used[family];
    if (!cps || !cps.size) { css = css.replace(m[0], ''); continue; }          // never used: drop it
    const otf = await fetchGunzip(here('./fonts-otf/' + file.replace(/\.woff2$/, '.otf.gz')));
    const bytes = cut(otf, new Set([32, ...cps]));
    total += bytes.length;
    report.push(family + ': ' + cps.size + ' characters, ' + (bytes.length / 1024).toFixed(1) + ' KB');
    css = css.replace(m[0], m[0].replace(/url\("FONTFILE:\/?[^"]+"\)\s*format\("woff2"\)/, 'url(data:font/otf;base64,' + base64(bytes) + ') format("opentype")'));
  }
  return { css, report, bytes: total };
}
