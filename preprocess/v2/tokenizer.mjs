// v2/tokenizer.mjs — Stage 1 of the v2 rebuild. DESIGN-V2 §4.2 and §5.1.
//
// Plain terms: chop a LaTeX file into its smallest meaningful pieces — a
// command name, a brace, a comment, a space, a plain character — and
// remember exactly where each piece came from. Every later layer reads
// these pieces, never raw text. Gluing the pieces back together (reprint)
// must give back the file exactly: invariant T1. Nothing here ever stops
// on odd input; anything odd becomes a Finding (§5.4) and the pieces stay
// exact ("flag, don't fail").
//
// Zero dependencies and no regular expressions, so the algorithm carries
// to Rust or Haskell unchanged (DESIGN-V2 §6). Offsets are JavaScript
// string indices (UTF-16 code units); a byte-indexed port keeps the same
// algorithm with its own unit. The input is decoded text — reading and
// decoding a file is the intake layer's job (§4.1), not this one's.
//
// Reference shapes read before writing (worklog, Stage 1):
//   Pandoc  Readers/LaTeX/Parsing.hs `totoks` — character scan, a case
//           per character class, and its own round-trip property.
//   LaTeXML Core/Mouth.pm — a category table and one handler per category.
//   KaTeX   Lexer.ts — \verb runs to the next delimiter on the same line.
//
// Token (§5.1):  kind, start, end, text  — always
//                name      ControlWord: the name without the backslash
//                          ControlSymbol: the one character after the backslash
//                          Region: environment name, \verb delimiter, or
//                          "ExplSyntaxOn"; url: the command (url, href)
//                absorbed  Space only: follows a ControlWord or a control
//                          space; the expander drops it (rule 47)
//                parbreak  Newline only: second of a blank-line pair
//                region    Region only: verb | verbatim-env | expl3 | url
// Finding (§5.4): rule, channel, level, kind, file, line, span, message,
//                 detail — all rules here start "tokenizer/".

// ---- character categories -------------------------------------------
// Only the categories this layer needs, not TeX's sixteen. Every code
// above 127 is OTHER. Letters are A–Z a–z, plus @ under the style profile.
const ESCAPE = 1, BEGIN = 2, END = 3, MATH = 4, ALIGN = 5, PARAM = 6,
      COMMENT = 7, SPACE = 8, NEWLINE = 9, LETTER = 10, OTHER = 11;

function buildTable(atIsLetter) {
  const t = new Uint8Array(128).fill(OTHER);
  t[0x5c] = ESCAPE;   // backslash
  t[0x7b] = BEGIN;    // {
  t[0x7d] = END;      // }
  t[0x24] = MATH;     // $
  t[0x26] = ALIGN;    // &
  t[0x23] = PARAM;    // #
  t[0x25] = COMMENT;  // %
  t[0x20] = SPACE;    // space
  t[0x09] = SPACE;    // tab
  t[0x0a] = NEWLINE;  // \n
  t[0x0d] = NEWLINE;  // \r  (a bare \r is handled as OTHER in the loop)
  for (let c = 0x41; c <= 0x5a; c++) t[c] = LETTER;   // A–Z
  for (let c = 0x61; c <= 0x7a; c++) t[c] = LETTER;   // a–z
  if (atIsLetter) t[0x40] = LETTER;                    // @
  return t;
}
const TABLE_STANDARD = buildTable(false);
const TABLE_STYLE = buildTable(true);

const isAsciiLetter = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isBlank = (c) => c === 0x20 || c === 0x09;
const isLineEnd = (c) => c === 0x0a || c === 0x0d;
const isLowerHex = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66);

// ---- public constants ----------------------------------------------

export const KINDS = ["ControlWord", "ControlSymbol", "BeginGroup", "EndGroup",
  "MathShift", "AlignTab", "Parameter", "Comment", "Space", "Newline", "Other",
  "Region"];

// Environments whose body is opaque text (§4.2). A package description may
// add names through options.verbatimEnvs. tikzpicture is deliberately NOT
// here: its body is real LaTeX.
export const DEFAULT_VERBATIM_ENVS = ["verbatim", "verbatim*", "comment",
  "lstlisting", "minted", "Verbatim", "alltt"];

// Commands whose {...} argument is a web address, read with % as an ordinary
// character: \url, \nolinkurl and the first argument of \href (Pandoc
// bracedUrl, Readers/LaTeX.hs, 3.11). A description may add names through
// options.urlCommands. Amendment to Stage 1 made in Stage 2 (2026-09-12):
// 39 of the corpus's 46 brace imbalances were a % inside an \href address.
export const DEFAULT_URL_COMMANDS = ["url", "nolinkurl", "href"];

// ---- small public helpers ------------------------------------------

// The catcode profile is chosen by the file's role, never by its contents
// (rule 87): .sty and .cls files get "style" (@ is a letter throughout).
export function profileFor(filename) {
  const lower = String(filename || "").toLowerCase();
  return lower.endsWith(".sty") || lower.endsWith(".cls") ? "style" : "standard";
}

// Invariant T1 in one line: reprint(tokenize(text).tokens) === text.
export function reprint(tokens) {
  const parts = new Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) parts[i] = tokens[i].text;
  return parts.join("");
}

// ---- the tokenizer --------------------------------------------------

// tokenize(text, options) -> { tokens, findings }
//   options.profile       "standard" (default) | "style"
//   options.file          file name carried into findings (display only)
//   options.verbatimEnvs  extra environment names to treat as opaque
//   options.urlCommands   extra commands whose {...} argument is a web address
export function tokenize(text, options = {}) {
  const profile = options.profile === "style" ? "style" : "standard";
  const file = options.file || "";
  const verbatimEnvs = new Set(DEFAULT_VERBATIM_ENVS);
  for (const name of options.verbatimEnvs || []) verbatimEnvs.add(name);
  const urlCommands = new Set(DEFAULT_URL_COMMANDS);
  for (const name of options.urlCommands || []) urlCommands.add(name);

  const baseTable = profile === "style" ? TABLE_STYLE : TABLE_STANDARD;
  let table = baseTable;          // swapped by \makeatletter/\makeatother
  const n = text.length;
  const tokens = [];
  const findings = [];
  let absorbNext = false;         // the previous token was a ControlWord or a control space
  let urlPending = null;          // name of a \url-family command awaiting its {...}
  let lastKind = "";              // kind of the last non-Space token (for parbreak)
  let lineStarts = null;          // built lazily, only if a finding is made

  // -- token construction and the two carried flags --
  function push(tok, absorbsFollowingBlanks) {
    if (tok.kind === "Space" && absorbNext) tok.absorbed = true;
    if (tok.kind === "Newline" && lastKind === "Newline") tok.parbreak = true;
    tokens.push(tok);
    if (tok.kind !== "Space") { lastKind = tok.kind; urlPending = null; }
    absorbNext = absorbsFollowingBlanks === true;
  }
  function mk(kind, start, end) {
    return { kind, start, end, text: text.slice(start, end) };
  }
  function mkNamed(kind, start, end, name) {
    const t = mk(kind, start, end); t.name = name; return t;
  }
  function mkRegion(start, end, region, name) {
    const t = mk("Region", start, end); t.region = region; t.name = name; return t;
  }

  // -- findings (§5.4); line numbers computed only when needed --
  function lineOf(offset) {
    if (lineStarts === null) {
      lineStarts = [0];
      for (let k = 0; k < n; k++) if (text.charCodeAt(k) === 0x0a) lineStarts.push(k + 1);
    }
    let lo = 0, hi = lineStarts.length - 1;          // binary search: last start <= offset
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }
  function finding(rule, level, start, end, message, detail) {
    findings.push({ rule, channel: "attention", level, kind: "literal", file,
      line: lineOf(start), span: { start, end }, message, detail: detail || {} });
  }

  // -- backslash: a control word, a control symbol, or the start of a region --
  function readEscape(i) {
    if (i + 1 >= n) {
      finding("tokenizer/backslash-at-end", "author-error", i, n,
        "The file ends with a lone backslash.", {});
      push(mkNamed("ControlSymbol", i, n, ""), false);
      return n;
    }
    const d = text.charCodeAt(i + 1);
    if (d < 128 && table[d] === LETTER) {
      let j = i + 2;
      while (j < n) { const e = text.charCodeAt(j); if (!(e < 128 && table[e] === LETTER)) break; j++; }
      const name = text.slice(i + 1, j);
      if (name === "verb") { const r = readVerb(i, j); if (r >= 0) return r; }
      else if (name === "begin") { const r = readVerbatimEnv(i, j); if (r >= 0) return r; }
      else if (name === "ExplSyntaxOn") return readExpl3(i, j);
      else if (name === "makeatletter") { if (profile === "standard") table = TABLE_STYLE; }
      else if (name === "makeatother") { if (profile === "standard") table = TABLE_STANDARD; }
      push(mkNamed("ControlWord", i, j, name), true);          // rule 47: absorbs following blanks
      if (urlCommands.has(name)) urlPending = name;             // its {...} is a url Region
      return j;
    }
    // Control symbol: backslash + one non-letter. A backslash before a line
    // break is TeX's control space (TeXbook ch. 8); Pandoc reads it the same.
    if (d === 0x0d && i + 2 < n && text.charCodeAt(i + 2) === 0x0a) {
      push(mkNamed("ControlSymbol", i, i + 3, "\n"), true); return i + 3;
    }
    if (isLineEnd(d)) { push(mkNamed("ControlSymbol", i, i + 2, "\n"), true); return i + 2; }
    let j = i + 2;
    if (d >= 0xd800 && d <= 0xdbff && j < n) {                    // keep a surrogate pair whole
      const e = text.charCodeAt(j); if (e >= 0xdc00 && e <= 0xdfff) j++;
    }
    push(mkNamed("ControlSymbol", i, j, text.slice(i + 1, j)), isBlank(d));   // "\ " also absorbs
    return j;
  }

  // -- \verb<d>...<d> and \verb*<d>...<d>: opaque to the next <d> on the same line --
  // Returns the offset after the region, or -1 to fall back to an ordinary
  // ControlWord (a finding explains why). Blanks between \verb and the
  // delimiter are skipped, as Pandoc's control-word rule does.
  function readVerb(start, j) {
    let k = j;
    if (k < n && text.charCodeAt(k) === 0x2a) k++;                 // the * of \verb*
    while (k < n && isBlank(text.charCodeAt(k))) k++;
    const d = k < n ? text.charCodeAt(k) : -1;
    if (d < 0 || isAsciiLetter(d) || d === 0x2a || isBlank(d) || isLineEnd(d)) {
      finding("tokenizer/unterminated-verb", "author-error", start, j,
        "\\verb is followed by a letter, a space or the end of the line where its " +
        "quote character should be; it is read as an ordinary command.",
        { reason: "no-delimiter" });
      return -1;
    }
    let m = k + 1;
    while (m < n) { const e = text.charCodeAt(m); if (isLineEnd(e)) { m = -1; break; } if (e === d) break; m++; }
    if (m < 0 || m >= n) {
      finding("tokenizer/unterminated-verb", "author-error", start, k + 1,
        "\\verb opens with the quote character " + text[k] + " but its line has no " +
        "second " + text[k] + "; it is read as an ordinary command.",
        { reason: "no-closing-delimiter", delimiter: text[k] });
      return -1;
    }
    push(mkRegion(start, m + 1, "verb", text[k]), false);
    return m + 1;
  }

  // -- \begin{X} for a verbatim-family X: opaque to the matching \end{X} --
  // The end marker is found by literal search (LaTeX's own delimited-argument
  // match does the same, so "\\end{X}" inside the body ends it too), allowing
  // blanks in "\end {X}", and skipping any \end{X} that sits behind a live %
  // on its line (rule 99: comment.sty reads its body with % still active;
  // Pandoc's Comment token hides it the same way). Text after \end{X} on the
  // same line is NOT part of the region (rule 101; a transform reports it).
  function readVerbatimEnv(start, j) {
    let k = j;
    while (k < n && isBlank(text.charCodeAt(k))) k++;
    if (k >= n || text.charCodeAt(k) !== 0x7b) return -1;
    const close = text.indexOf("}", k + 1);
    if (close < 0) return -1;
    const name = text.slice(k + 1, close);
    if (!verbatimEnvs.has(name)) return -1;
    const endAt = findEnvEnd(close + 1, name);
    if (endAt < 0) {
      finding("tokenizer/unclosed-verbatim", "author-error", start, close + 1,
        "\\begin{" + name + "} has no matching \\end{" + name + "}; everything to the " +
        "end of the file is treated as opaque text.", { environment: name });
      push(mkRegion(start, n, "verbatim-env", name), false);
      return n;
    }
    push(mkRegion(start, endAt, "verbatim-env", name), false);
    return endAt;
  }
  function findEnvEnd(from, name) {
    const closer = "{" + name + "}";
    let pos = from;
    for (;;) {
      const hit = text.indexOf("\\end", pos);
      if (hit < 0) return -1;
      let k = hit + 4;
      while (k < n && isBlank(text.charCodeAt(k))) k++;
      if (text.startsWith(closer, k) && !behindLiveComment(hit)) return k + closer.length;
      pos = hit + 1;
    }
  }

  // Is offset `at` preceded, on its own line, by a % that is a real comment?
  // A % is a comment when an even number of consecutive backslashes precede
  // it (rules 100, 102): "\\%" is a comment, "\%" is not.
  function behindLiveComment(at) {
    let ls = at;
    while (ls > 0 && text.charCodeAt(ls - 1) !== 0x0a) ls--;
    for (let p = ls; p < at; p++) {
      if (text.charCodeAt(p) !== 0x25) continue;
      let bs = 0;
      while (p - 1 - bs >= ls && text.charCodeAt(p - 1 - bs) === 0x5c) bs++;
      if (bs % 2 === 0) return true;
    }
    return false;
  }

  // -- \ExplSyntaxOn ... \ExplSyntaxOff: quarantined as one region (FINDINGS 7) --
  function readExpl3(start, j) {
    const marker = "\\ExplSyntaxOff";
    let pos = j;
    for (;;) {
      const hit = text.indexOf(marker, pos);
      if (hit < 0) {
        finding("tokenizer/unclosed-expl3", "author-error", start, j,
          "\\ExplSyntaxOn has no matching \\ExplSyntaxOff; everything to the end of " +
          "the file is treated as expl3 code.", {});
        push(mkRegion(start, n, "expl3", "ExplSyntaxOn"), false);
        return n;
      }
      const after = hit + marker.length;
      const e = after < n ? text.charCodeAt(after) : -1;
      // expl3 letters include @ _ : — so \ExplSyntaxOff_x would be another name
      if (!(isAsciiLetter(e) || e === 0x40 || e === 0x5f || e === 0x3a)) {
        push(mkRegion(start, after, "expl3", "ExplSyntaxOn"), false);
        return after;
      }
      pos = hit + 1;
    }
  }

  // -- ^^ notation: left as Other tokens, but noted (Pandoc reads it itself) --
  function noteHatNotation(i) {
    if (i > 0 && text.charCodeAt(i - 1) === 0x5e) return;          // already noted at i-1
    if (i + 2 >= n) return;                                          // "^^" then nothing
    const a = text.charCodeAt(i + 2);
    const b = i + 3 < n ? text.charCodeAt(i + 3) : -1;
    const len = (isLowerHex(a) && isLowerHex(b)) ? 4 : (a < 128 ? 3 : 0);
    if (len === 0) return;
    finding("tokenizer/hat-notation", "unsupported", i, i + len,
      "A ^^ character code is left as written; Pandoc interprets it itself, the " +
      "preprocessor does not.", { notation: text.slice(i, i + len) });
  }

  // -- the {...} argument of \url, \href, ...: opaque, with % an ordinary character --
  // Only braces are counted (an address may contain balanced braces); nothing
  // else is interpreted. Blanks between the command and the { have already been
  // read as an absorbed Space; a line break cancels the expectation, as it
  // does for Pandoc. Returns the offset after the region, or -1 when the group
  // never closes (a finding explains; the { is then an ordinary brace).
  function readUrlArg(start) {
    let depth = 0;
    for (let k = start; k < n; k++) {
      const e = text.charCodeAt(k);
      if (e === 0x7b) depth++;
      else if (e === 0x7d && --depth === 0) { push(mkRegion(start, k + 1, "url", urlPending), false); return k + 1; }
    }
    finding("tokenizer/unclosed-url", "author-error", start, n,
      "The web address opened here has no closing brace; it is read as ordinary text.", { command: urlPending });
    return -1;
  }

  // -- the main loop: one piece per pass --
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    const cat = c < 128 ? table[c] : OTHER;
    switch (cat) {
      case ESCAPE: i = readEscape(i); break;
      case BEGIN: {
        if (urlPending !== null) { const r = readUrlArg(i); if (r >= 0) { i = r; break; } }
        push(mk("BeginGroup", i, i + 1), false); i++; break;
      }
      case END:    push(mk("EndGroup", i, i + 1), false); i++; break;
      case MATH:   push(mk("MathShift", i, i + 1), false); i++; break;   // $$ is two tokens
      case ALIGN:  push(mk("AlignTab", i, i + 1), false); i++; break;
      case PARAM:  push(mk("Parameter", i, i + 1), false); i++; break;   // digit read by definition parser
      case COMMENT: {                                                    // % to end of line, break excluded
        let j = i + 1;
        while (j < n && !isLineEnd(text.charCodeAt(j))) j++;
        push(mk("Comment", i, j), false); i = j; break;
      }
      case SPACE: {                                                      // one or more spaces/tabs
        let j = i + 1;
        while (j < n && isBlank(text.charCodeAt(j))) j++;
        push(mk("Space", i, j), false); i = j; break;
      }
      case NEWLINE: {                                                    // \n or \r\n; never normalised
        if (c === 0x0a) { push(mk("Newline", i, i + 1), false); i++; break; }
        if (i + 1 < n && text.charCodeAt(i + 1) === 0x0a) { push(mk("Newline", i, i + 2), false); i += 2; break; }
        finding("tokenizer/bare-carriage-return", "unsupported", i, i + 1,
          "A carriage return with no line feed after it; kept as an ordinary character.", {});
        push(mk("Other", i, i + 1), false); i++; break;
      }
      default: {                                                         // LETTER outside a command, or OTHER
        if (c === 0x5e && i + 1 < n && text.charCodeAt(i + 1) === 0x5e) noteHatNotation(i);
        let j = i + 1;
        if (c >= 0xd800 && c <= 0xdbff && j < n) {                       // keep a surrogate pair whole
          const e = text.charCodeAt(j); if (e >= 0xdc00 && e <= 0xdfff) j++;
        }
        push(mk("Other", i, j), false); i = j; break;
      }
    }
  }
  return { tokens, findings };
}
