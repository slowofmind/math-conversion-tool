// mmz-match.mjs — correlate memoize externs to source locations using SyncTeX
// position, verified against \mmzSource content.
//
// PRIMARY KEY = position. SyncTeX records \inputlineno when the box is BUILT.
// *** That is the end of the ENCLOSING box-building group, which may be an
// OUTER WRAPPER (center / \probonly{ } / \scalebox), not the figure env. ***
// So matching is GRADED: containment -> trailing-within-tolerance -> unmatched.
// flag-don't-fail throughout; confidence is always reported, never hidden.
//
// SECONDARY = content: \mmzSource is a VERIFY signal, never the key.
// No top-level node: import — this module must load in a browser.
// gunzip is resolved at call time; see gunzipUniversal below.
import * as S from './latex-scanner.js';
import * as FE from './figure-extractor.js';

/** Parse SyncTeX: page -> {tag -> Map(line->count)} plus the Input: file table. */
/**
 * Decompress gzip bytes in either runtime.
 * DecompressionStream is available in browsers and in Node 18+; the
 * node:zlib fallback is imported LAZILY so bundlers and browsers never see
 * a bare node: specifier at module scope.
 */
export async function gunzipUniversal(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let out = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return out;                                   // latin1, as before
  }
  const { gunzipSync } = await import('node:zlib');
  return gunzipSync(u8).toString('latin1');
}

/** Async: takes the raw .synctex.gz bytes. */
export async function parseSynctex(gzBytes) {
  return parseSynctexText(await gunzipUniversal(gzBytes));
}

/** Sync: takes already-decompressed SyncTeX text. */
export function parseSynctexText(raw) {
  const text = raw.split('\n');
  const files = new Map();
  for (const l of text) {
    const m = /^Input:(\d+):(.*)$/.exec(l);
    if (m) files.set(m[1], m[2].trim());
  }
  const pages = new Map();
  const rec = /^[\[\(hvxkgs$]\s*(\d+),(\d+)/;
  let page = null;
  for (const l of text) {
    const p = /^\{(\d+)$/.exec(l);
    if (p) { page = +p[1]; pages.set(page, new Map()); continue; }
    if (/^\}\d+$/.test(l)) { page = null; continue; }
    if (page === null) continue;
    const m = rec.exec(l);
    if (!m) continue;
    const byTag = pages.get(page);
    if (!byTag.has(m[1])) byTag.set(m[1], new Map());
    const lines = byTag.get(m[1]);
    lines.set(+m[2], (lines.get(+m[2]) || 0) + 1);
  }
  return { files, pages };
}

/** The main-file tag in the SyncTeX Input: table. */
export function mainTag(files, hint = 'main.tex') {
  for (const [tag, path] of files) if (path.endsWith(hint)) return tag;
  return null;
}

/** Read a bracket group starting at `i` (must be '['); returns index AFTER ']'. */
function readBracketGroup(s, i) {
  if (s[i] !== '[') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '[') depth++;
    else if (s[j] === ']') { depth--; if (depth === 0) return j + 1; }
    else if (s[j] === '{') { const g = S.readBalancedGroup(s, j); if (g) j = g.endIndex; }
  }
  return null;
}

/**
 * Build claim ranges.
 *  src         — the (injected) main document text
 *  extraEnvs   — extra figure environment names to treat as claimable
 *  styTexts    — [{name,text}] of .sty/.cls sources. *** REQUIRED for any
 *                corpus where figure macros are defined in style files:
 *                Mb's \axes lives in plotstyle.sty and is invisible to a
 *                main-file-only scan. Discovered 2026-08-14 on Exam 2 Prac 2.
 * Definition heads AND definition bodies are excluded — commenting either
 * out would break every call site.
 */
export function buildClaims(src, extraEnvs = [], styTexts = []) {
  const masked = S.maskComments(src);
  const envNames = Array.from(new Set(
    [...S.discoverFigureEnvironments(src).map(e => e.name || e), ...extraEnvs,
     'tikzpicture']));
  const defRanges = FE.findDefinitionRanges(masked) || [];
  const inDef = i => defRanges.some(r => i >= r.start && i < r.end);

  const claims = [];
  for (const e of S.findEnvironments(src, envNames, masked)) {
    claims.push({
      kind: 'env', name: e.name, start: e.start, end: e.end,
      startLine: S.lineOfIndex(src, e.start),
      endLine: S.lineOfIndex(src, e.end),
      inDefinition: inDef(e.start), definedIn: null,
      text: src.slice(e.start, e.end),
    });
  }

  // figure-drawing macros: from the main file AND from every style file
  const macroNames = new Map();
  for (const c of S.findCommandCandidates(src)) macroNames.set(c.name, '(main)');
  for (const { name, text } of styTexts)
    for (const c of S.findCommandCandidates(text))
      if (!macroNames.has(c.name)) macroNames.set(c.name, name);

  for (const [mname, origin] of macroNames) {
    const re = new RegExp('\\\\' + mname + '(?![a-zA-Z])', 'g');
    let m;
    while ((m = re.exec(masked)) !== null) {
      if (inDef(m.index)) continue;
      const before = masked.slice(Math.max(0, m.index - 40), m.index);
      if (/\\(new|renew|provide)command\s*\*?\s*\{?\s*$/.test(before)) continue;
      // consume [optional] then {braced}, in either presence combination
      let j = m.index + m[0].length;
      while (j < masked.length && /\s/.test(masked[j])) j++;
      let end = m.index + m[0].length;
      if (masked[j] === '[') { const k = readBracketGroup(masked, j); if (k) { end = k; j = k; } }
      while (j < masked.length && /\s/.test(masked[j])) j++;
      if (masked[j] === '{') { const g = S.readBalancedGroup(masked, j); if (g) end = g.endIndex + 1; }
      claims.push({
        kind: 'macro', name: mname, start: m.index, end,
        startLine: S.lineOfIndex(src, m.index),
        endLine: S.lineOfIndex(src, end),
        inDefinition: false, definedIn: origin,
        text: src.slice(m.index, end),
      });
    }
  }
  // inline \tikz[...]{...} — a figure that is not an environment and not a
  // macro call. Only the BRACED form is claimed; the semicolon-terminated
  // path form is left unclaimed on purpose (see patch note).
  {
    const re = /\\tikz(?![a-zA-Z])/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      if (inDef(m.index)) continue;
      let j = m.index + m[0].length;
      while (j < masked.length && /\s/.test(masked[j])) j++;
      if (masked[j] === '[') {
        const k = readBracketGroup(masked, j);
        if (!k) continue;
        j = k;
        while (j < masked.length && /\s/.test(masked[j])) j++;
      }
      if (masked[j] !== '{') continue;          // semicolon form: not claimed
      const g = S.readBalancedGroup(masked, j);
      if (!g) continue;
      const end = g.endIndex + 1;
      claims.push({
        kind: 'inline', name: 'tikz', start: m.index, end,
        startLine: S.lineOfIndex(src, m.index),
        endLine: S.lineOfIndex(src, end),
        inDefinition: false, definedIn: null,
        text: src.slice(m.index, end),
      });
    }
  }

  claims.sort((a, b) => a.start - b.start);
  return claims;
}

/** Dominant main-tag line for a page. */
export function externLine(pages, page, tag) {
  const byTag = pages.get(page);
  if (!byTag || !byTag.has(tag)) return { line: null, distinct: 0, all: [] };
  const lines = byTag.get(tag);
  const all = [...lines.entries()].sort((a, b) => b[1] - a[1]);
  return { line: all[0][0], distinct: lines.size, all };
}

/**
 * Match externs to claims. Graded confidence:
 *   'contained' — syncLine falls inside the claim's own span (highest)
 *   'trailing'  — syncLine falls just past the claim's end with nothing else
 *                 starting in between (the wrapper-close case)
 *   'no-claim' / 'no-syncline' / 'ambiguous' — flagged, never guessed
 */
const normTx = t => (t || '').replace(/\s+/g, ' ')
  .replace(/(\\[a-zA-Z]+)\s+/g, '$1').trim();

/** Does the recorded \mmzSource plausibly come from this claim's text? */
function contentAgrees(fig, claim) {
  const rec = normTx(fig && (fig.mmzSourceNormalised || fig.mmzSource));
  const txt = normTx(claim.text);
  if (!rec || !txt) return true;               // nothing to check with — allow
  if (rec === txt) return true;
  const inner = txt.replace(/^\\[a-zA-Z]+\s*(?:\[[^\]]*\])?\s*\{/, '').replace(/\}$/, '');
  const probe = inner.slice(0, 50);
  if (probe.length > 20 && rec.includes(probe)) return true;
  if (txt.includes(rec.slice(0, 50)) && rec.length > 20) return true;
  return false;
}

export function matchExterns(figures, claims, pages, tag, tolerance = 20) {
  const usable = claims.filter(c => !c.inDefinition);
  const used = new Map();
  const out = [];

  for (const f of figures) {
    const sl = externLine(pages, f.sourcePage, tag);
    const row = { id: f.id, page: f.sourcePage, syncLine: sl.line,
                  syncDistinct: sl.distinct, claim: null,
                  status: '', confidence: '', delta: null, note: '' };
    if (sl.line === null) { row.status = 'no-syncline'; out.push(row); continue; }

    const inside = usable.filter(c => sl.line >= c.startLine && sl.line <= c.endLine);
    if (inside.length) {
      inside.sort((a, b) => (a.end - a.start) - (b.end - b.start));
      row.claim = inside[0]; row.status = 'matched';
      row.confidence = 'contained'; row.delta = 0;
      if (inside.length > 1) row.note = `${inside.length} nested claims; chose innermost`;
    } else {
      const before = usable.filter(c => c.startLine <= sl.line)
                           .sort((a, b) => b.startLine - a.startLine);
      const cand = before[0];
      if (cand) {
        const d = sl.line - cand.endLine;
        if (d >= 0 && d <= tolerance && contentAgrees(f, cand)) {
          row.claim = cand; row.status = 'matched'; row.confidence = 'trailing';
          row.delta = d;
          row.note = `syncLine ${d} line(s) past \\end — enclosing wrapper ` +
                     `(center/\\probonly/\\scalebox) closed the box`;
        } else {
          row.status = 'no-claim';
          row.note = `nearest ${cand.kind} ${cand.name} @${cand.startLine}-` +
            `${cand.endLine} (Δ${d}` +
            (d >= 0 && d <= tolerance ? ', within tolerance but CONTENT DISAGREES'
                                      : `, beyond tolerance ${tolerance}`) + ')';
        }
      } else { row.status = 'no-claim'; row.note = 'no claim starts before this line'; }
    }

    if (row.claim) {
      const key = row.claim.start;
      if (used.has(key)) {
        row.status = 'ambiguous';
        row.note += ` COLLISION with ${used.get(key)} (same claim claimed twice)`;
      } else used.set(key, f.id);
    }
    out.push(row);
  }

  const matchedStarts = new Set(out.filter(r => r.claim).map(r => r.claim.start));
  const unmatchedClaims = usable.filter(c => !matchedStarts.has(c.start));
  return { rows: out, unmatchedClaims, usableClaims: usable };
}

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.1.0';
