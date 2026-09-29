// pdf-refs.js — plan and apply source-reference rewrites, .pdf -> .svg.
//
// WHY THIS EXISTS: the project now KEEPS the .pdf after converting it to .svg.
// resolve-image-paths.lua only repairs an extension when the original path
// does NOT resolve, so a kept .pdf makes it bail and the image reaches HTML as
// <img src="*.pdf">, which no browser renders. Keeping the PDF therefore
// REQUIRES rewriting the reference. See pdf-conversion-design/DESIGN.md §2.
//
// SCOPE: extension only. A folder-prefix mismatch (source says
// images/tikz/d.pdf, upload arrived flat as d.svg) is a PATH problem on a file
// we neither created nor placed; that stays with the Lua filter, which then
// only ever fires on genuine path mismatches.
//
// EDITS ARE SURGICAL: only the final ".pdf" of a reference is replaced, so
// everything else in the braces survives byte-identical. That also means two
// differing occurrences of the same file are each individually correct, so the
// "duplicate occurrences differ" refusal contemplated in the design does not
// arise.
//
// SHARED DEPENDENCY, DELIBERATE: latex-scanner.js lives under
// image-extraction/ but is a general LaTeX utility, not memoize-specific.
// *** Removing the image-extraction module must NOT delete latex-scanner.js
// while this module exists. Recorded here and in the design note. ***
import { maskComments, readBalancedGroup, skipSpacesAndOptionalGroups,
         lineOfIndex } from '../image-extraction/latex-scanner.js';

export const MODULE_VERSION = '0.1.0';

/** Every .pdf entry in a list of project paths. */
export function findPdfPaths(paths) {
  return (paths || []).filter(p => /\.pdf$/i.test(p));
}

const baseOf = (p) => (String(p).match(/([^/\\]+)$/) || [, p])[1];

/**
 * Plan the rewrites for one file's text.
 * @param {string} text      the file's source
 * @param {string[]} pdfPaths every .pdf entry in the project
 * @returns {{edits:Array, refusals:Array, skipped:Array}}
 *   edits:    { from, to, ref, newRef, line }  surgical, extension only
 *   refusals: { ref, line, reason }            reported, never guessed at
 *   skipped:  { ref, line, reason }            legitimately none of our business
 */
export function planReferenceRewrites(text, pdfPaths) {
  const masked = maskComments(text);
  const pdfs = findPdfPaths(pdfPaths);
  const exact = new Set(pdfs);
  // basename -> paths, so an ambiguous basename can be refused rather than guessed
  const byBase = new Map();
  for (const p of pdfs) {
    const b = baseOf(p).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p);
  }

  const edits = [], refusals = [], skipped = [];
  const RE = /\\includegraphics\b\*?/g;
  let m;
  while ((m = RE.exec(masked)) !== null) {
    const line = lineOfIndex(text, m.index);
    let i = skipSpacesAndOptionalGroups(masked, m.index + m[0].length);
    if (masked[i] !== '{') {
      refusals.push({ ref: null, line, reason: 'no braced argument found' });
      continue;
    }
    const grp = readBalancedGroup(masked, i);
    if (!grp) {
      refusals.push({ ref: null, line, reason: 'braces never balance' });
      continue;
    }
    RE.lastIndex = grp.endIndex + 1;
    // read from the ORIGINAL text: masking replaces comment bytes
    const raw = text.slice(i + 1, grp.endIndex);
    const ref = raw.trim();

    // --- refuse, do not guess ------------------------------------------
    if (/[\\#]/.test(ref)) {
      refusals.push({ ref, line,
        reason: 'not a literal path (built from a macro or an argument)' });
      continue;
    }
    if (!/\.[A-Za-z0-9]+$/.test(ref)) {
      // \includegraphics{diagram} is legal and common; the extension is
      // supplied by graphicx at build time, so we cannot know the target.
      refusals.push({ ref, line, reason: 'no file extension in the reference' });
      continue;
    }
    if (!/\.pdf$/i.test(ref)) { skipped.push({ ref, line, reason: 'not a PDF reference' }); continue; }

    // --- does it correspond to a PDF we actually hold? -----------------
    let target = exact.has(ref) ? ref : null;
    if (!target) {
      const cands = byBase.get(baseOf(ref).toLowerCase()) || [];
      if (cands.length === 1) target = cands[0];
      else if (cands.length > 1) {
        refusals.push({ ref, line,
          reason: `ambiguous: ${cands.length} project PDFs share this filename` });
        continue;
      }
    }
    if (!target) { skipped.push({ ref, line, reason: 'no matching PDF in the project' }); continue; }

    // --- surgical: replace ONLY the trailing ".pdf" --------------------
    const rel = raw.toLowerCase().lastIndexOf('.pdf');
    if (rel === -1) { refusals.push({ ref, line, reason: 'extension not locatable' }); continue; }
    const from = i + 1 + rel;
    edits.push({ from, to: from + 4, ref, newRef: ref.replace(/\.pdf$/i, '.svg'),
                 line, pdfPath: target });
  }
  return { edits, refusals, skipped };
}

/** Apply planned edits. Descending order, so earlier offsets stay valid. */
export function applyReferenceRewrites(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from))
    out = out.slice(0, e.from) + '.svg' + out.slice(e.to);
  return out;
}
