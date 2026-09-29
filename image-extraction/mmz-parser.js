// mmz-parser.js — pure parsing of memoize's .mmz manifest and .memo files.
// NO DOM, NO MuPDF, no I/O. Text in, plain data out. This is the piece that
// eventually ports into the main tool unchanged.
//
// Built 2026-08-10 against real PS09 output (padding=2pt injection).
// Reference: memoize manual 4.3.1 (.mmz), 4.5.1 (memos).

/** TeX points -> PostScript "big" points. PDF pages are in bp. */
export const PT_PER_BP = 72.27 / 72;
export function ptToBp(pt) { return pt * 72 / 72.27; }

/** Parse a TeX dimension like "103.93979pt" -> 103.93979 (number, in pt). */
function dim(s) {
  const m = /^\s*(-?[\d.]+)\s*pt\s*$/.exec(s);
  return m ? parseFloat(m[1]) : NaN;
}

/**
 * Parse a .mmz manifest.
 * Returns { prefix, externs: [{ file, page, wPt, hPt, wBp, hBp, hash, ccHash }] }
 * `page` is 1-BASED as memoize records it. Callers must subtract 1 for MuPDF.
 */
export function parseMmz(text) {
  const prefixM = /\\mmzPrefix\s*\{([^}]*)\}/.exec(text);
  const prefix = prefixM ? prefixM[1] : '';

  const externs = [];
  // \mmzNewExtern {name.pdf}{page}{width}{height}
  const re = /\\mmzNewExtern\s*\{([^}]*)\}\{(\d+)\}\{([^}]*)\}\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const file = m[1];
    const wPt = dim(m[3]);
    const hPt = dim(m[4]);
    // extern filenames are "<prefix><cHash>-<ccHash>.pdf"
    const stem = file.replace(/\.pdf$/i, '');
    const bare = prefix && stem.startsWith(prefix) ? stem.slice(prefix.length) : stem;
    const parts = bare.split('-');
    externs.push({
      file,
      page: parseInt(m[2], 10),
      wPt, hPt,
      wBp: ptToBp(wPt), hBp: ptToBp(hPt),
      hash: parts[0] || null,
      ccHash: parts[1] || null,
    });
  }
  return { prefix, externs };
}

/**
 * Parse a cc-memo (double-hash .memo) for exact crop geometry.
 * Shape observed:
 *   \mmzIncludeExtern {0}\hbox {W}{H}{D}{padL}{padR}{padT}{padB}
 * Returns { widthPt, heightPt, depthPt, padPt:{l,r,t,b} } or null.
 * NOTE the recorded page size = width + padL + padR (and height+depth+padT+padB),
 * so this is a CROSS-CHECK, not a required crop input, when padding is small.
 */
export function parseCcMemo(text) {
  const re = /\\mmzIncludeExtern\s*\{[^}]*\}\\hbox\s*((?:\{[^}]*\}\s*){7})/;
  const m = re.exec(text);
  if (!m) return null;
  const vals = [...m[1].matchAll(/\{([^}]*)\}/g)].map(x => dim(x[1]));
  if (vals.length < 7 || vals.some(Number.isNaN)) return null;
  return {
    widthPt: vals[0], heightPt: vals[1], depthPt: vals[2],
    padPt: { l: vals[3], r: vals[4], t: vals[5], b: vals[6] },
  };
}

/**
 * Parse a c-memo (single-hash .memo) for \mmzSource — the verbatim source of
 * the captured snippet. This is the correlation key for step 2; captured here
 * so the prototype already surfaces it.
 * Returns the raw source string, or null.
 */
export function parseCMemo(text) {
  const i = text.indexOf('\\mmzSource');
  if (i === -1) return null;
  let s = text.slice(i + '\\mmzSource'.length);
  const end = s.indexOf('\\mmzEndMemo');
  if (end !== -1) s = s.slice(0, end);
  return s.trim() || null;
}

/**
 * Normalise a source snippet for matching against static-extractor claims.
 * Memoize records automemoized environments as "\begin {name}" (space after
 * \begin) and collapses the body, so raw string equality will not work.
 * Conservative: collapse whitespace, drop space after control words.
 */
export function normaliseSource(src) {
  if (!src) return '';
  return src
    .replace(/\s+/g, ' ')
    .replace(/(\\[a-zA-Z]+)\s+(?=[{[])/g, '$1')
    .trim();
}

/** Route a filename to its memo kind. */
export function memoKind(filename) {
  const stem = filename.replace(/\.memo$/i, '');
  const bare = stem.slice(stem.lastIndexOf('.') + 1);
  return bare.includes('-') ? 'cc' : 'c';
}

/** Hash key for a memo filename (the leading hash, prefix stripped). */
export function memoHash(filename) {
  const stem = filename.replace(/\.memo$/i, '');
  const bare = stem.slice(stem.lastIndexOf('.') + 1);
  return bare.split('-')[0];
}

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.0.0';
