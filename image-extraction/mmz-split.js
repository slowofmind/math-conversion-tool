// mmz-split.js — extern extraction using MuPDF. No DOM; takes bytes + parsed
// manifest, returns per-figure PDFs (and optionally SVG). Mirrors the main
// tool's MuPDF idioms (index.html SECTION 5C) so this ports cleanly.

import { ptToBp } from './mmz-parser.js';

let mupdfModule = null;
export async function loadMuPDF() {
  if (!mupdfModule) mupdfModule = await import('../image-processing/mupdf.js');
  return mupdfModule;
}

/** Tolerance (bp) for comparing extracted page size to the .mmz record. */
const SIZE_TOL_BP = 0.5;

/**
 * Extract one extern page as a standalone single-page PDF.
 * `page1` is 1-based (as .mmz records it).
 * Returns { bytes, boundsBp:{w,h} }.
 */
export async function extractPage(srcBytes, page1) {
  const mupdf = await loadMuPDF();
  let src = null, out = null, page = null, buf = null;
  try {
    src = new mupdf.PDFDocument(srcBytes);
    const idx = page1 - 1;
    if (idx < 0 || idx >= src.countPages())
      throw new Error(`page ${page1} out of range (doc has ${src.countPages()})`);

    // measure before grafting, from the source page
    page = src.loadPage(idx);
    const b = page.getBounds();          // [x0,y0,x1,y1] in bp
    const boundsBp = { w: b[2] - b[0], h: b[3] - b[1] };
    page.destroy(); page = null;

    out = new mupdf.PDFDocument();       // blank doc
    out.graftPage(0, src, idx);          // copy page in at index 0
    buf = out.saveToBuffer('compress');
    const bytes = buf.asUint8Array().slice();  // copy off the WASM heap

    return { bytes, boundsBp };
  } finally {
    try { if (buf) buf.destroy(); } catch (_) {}
    try { if (page) page.destroy(); } catch (_) {}
    try { if (out) out.destroy(); } catch (_) {}
    try { if (src) src.destroy(); } catch (_) {}
  }
}

/**
 * Convert a single-page PDF to SVG with text preserved.
 * Copied deliberately from the main tool's convertPdfToSvg (index.html 5C) so
 * that proving it here proves the downstream junction.
 */
export async function pdfToSvg(pdfBytes) {
  const mupdf = await loadMuPDF();
  let doc = null, page = null, list = null, buffer = null, writer = null;
  try {
    doc = new mupdf.PDFDocument(pdfBytes);
    page = doc.loadPage(0);
    const bounds = page.getBounds();
    list = page.toDisplayList();
    buffer = new mupdf.Buffer();
    writer = new mupdf.DocumentWriter(buffer, 'svg', 'text=text');
    const device = writer.beginPage(bounds);
    list.run(device, mupdf.Matrix.identity);
    writer.endPage();
    writer.close(); writer = null;
    return buffer.asString();
  } finally {
    try { if (writer) writer.close(); } catch (_) {}
    try { if (buffer) buffer.destroy(); } catch (_) {}
    try { if (list) list.destroy(); } catch (_) {}
    try { if (page) page.destroy(); } catch (_) {}
    try { if (doc) doc.destroy(); } catch (_) {}
  }
}

/**
 * Split every extern listed in a parsed manifest.
 * opts: { renderSvg:boolean, onProgress:(i,total,extern)=>void }
 * Returns array of result records — flag-don't-fail: a failure on one extern
 * is recorded and the run continues.
 */
export async function splitExterns(srcBytes, manifest, opts = {}) {
  const { renderSvg = false, onProgress = null } = opts;
  const results = [];
  const total = manifest.externs.length;

  for (let i = 0; i < total; i++) {
    const ex = manifest.externs[i];
    const rec = {
      index: i, id: `dc-fig-${String(i + 1).padStart(3, '0')}`,
      file: ex.file, page: ex.page, hash: ex.hash,
      expectedBp: { w: ex.wBp, h: ex.hBp },
      actualBp: null, sizeCheck: 'unknown', bytes: null, svg: null, error: null,
    };
    try {
      const { bytes, boundsBp } = await extractPage(srcBytes, ex.page);
      rec.bytes = bytes;
      rec.actualBp = boundsBp;
      const dw = Math.abs(boundsBp.w - ex.wBp);
      const dh = Math.abs(boundsBp.h - ex.hBp);
      rec.sizeCheck = (dw <= SIZE_TOL_BP && dh <= SIZE_TOL_BP) ? 'match' : 'MISMATCH';
      rec.delta = { w: dw, h: dh };
      if (renderSvg) rec.svg = await pdfToSvg(bytes);
    } catch (err) {
      rec.error = String(err && err.message ? err.message : err);
      rec.sizeCheck = 'error';
    }
    results.push(rec);
    if (onProgress) onProgress(i + 1, total, rec);
  }
  return results;
}

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.0.0';
