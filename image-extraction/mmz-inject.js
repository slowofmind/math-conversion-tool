// mmz-inject.mjs — build the injected (compile-time) source AND the offset map
// back to the user's original text.
//
// *** WHY THIS EXISTS ***
// Everything we measure — SyncTeX line numbers, claim spans — is measured
// against the INJECTED text, which is longer than the user's file by the
// memoize lines we add. On PS16: original 648 lines, injected 654, every
// figure shifted by exactly 6 lines / 157 characters. Applying injected
// offsets to the original file silently comments out the WRONG BLOCK and
// leaves the real figure live — which Pandoc then drops in silence.
// Returning the map WITH the text makes that mistake structurally hard.
import * as S from './latex-scanner.js';

/**
 * @returns {{ injected:string, insertions:Array<{at:number,len:number,text:string}> }}
 *          `at` is an offset into the ORIGINAL text; `len` the inserted length.
 */
export function buildInjected(src, early, late) {
  const split = S.splitDocument(src);
  if (!split.documentClass) throw new Error('No \\documentclass found.');
  const masked = S.maskComments(src);
  const bd = /\\begin\s*\{document\}/.exec(masked);
  if (!bd) throw new Error('No \\begin{document} found.');

  const dcEnd = split.documentClass.end;
  const textA = '\n' + early.trim() + '\n';
  const textB = late.trim() + '\n';

  const injected = src.slice(0, dcEnd) + textA + src.slice(dcEnd, bd.index) +
                   textB + src.slice(bd.index);
  return {
    injected,
    insertions: [
      { at: dcEnd, len: textA.length, text: textA },
      { at: bd.index, len: textB.length, text: textB },
    ],
  };
}

/**
 * Translate an offset in the INJECTED text back to the ORIGINAL text.
 * Returns null if the offset lands INSIDE inserted material (which would mean
 * we are trying to rewrite our own injection — always a bug, never guessed at).
 */
export function toOriginal(injectedOffset, insertions) {
  let shift = 0;
  for (const ins of insertions) {
    const injStart = ins.at + shift;          // where this insertion begins in injected coords
    if (injectedOffset < injStart) return injectedOffset - shift;
    if (injectedOffset < injStart + ins.len) return null;   // inside inserted text
    shift += ins.len;
  }
  return injectedOffset - shift;
}

/** Inverse: an ORIGINAL offset expressed in INJECTED coordinates. */
export function toInjected(originalOffset, insertions) {
  let shift = 0;
  for (const ins of insertions) {
    if (originalOffset < ins.at) break;
    shift += ins.len;
  }
  return originalOffset + shift;
}

/**
 * Recover the original text from an injected text, given the same early/late
 * strings. Used to test against runs where only injected.tex was kept.
 * Verifies the removed material matches what injection would have added.
 */
export function stripInjection(injected, early, late) {
  const textA = '\n' + early.trim() + '\n';
  const textB = late.trim() + '\n';
  const iA = injected.indexOf(textA);
  if (iA === -1) throw new Error('early injection block not found');
  let out = injected.slice(0, iA) + injected.slice(iA + textA.length);
  const iB = out.indexOf(textB);
  if (iB === -1) throw new Error('late injection block not found');
  out = out.slice(0, iB) + out.slice(iB + textB.length);
  return out;
}

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.0.0';
