// v2/a11y/inventory.mjs — session a11y-04. The accessibility checker's reader:
// one file's tokens into an INVENTORY of what a reader of the page will meet -
// headings, bold lines, images and drawings, tables - plus the file's includes
// (for the document's reading order) and its tagged-PDF switches
// (accessibility-checker/BUILD-PLAN-a11y03.md §1-2; the first build plan's rule
// that the checks read only this inventory, never the file).
//
// Plain terms: the checks need to know "there is a \section with an empty title
// here", "this image has no alt text", "this table has no rule after row 1".
// This file finds those things, by tokens and structure (never a text pattern
// deciding where something begins or ends), and skips what never reaches the
// reader: \iffalse .. \fi, comments and verbatim (the tokenizer already keeps
// them apart), the bodies of command definitions, maths, an environment the
// document hides (an author's alias of comment, named by the reader), and the
// exam class's \part (part (a) of a question, not a heading). Tables and bold
// text inside a drawing go with the drawing: Pandoc drops it, and the platform
// turns it into one image.
//
// The table reading is a11y-02's (_work/_a11y02_count.mjs), whose rules were
// observed with pdflatex and Pandoc 3.11 (_work/_a11y02-observations.txt; case
// ids in the comments). Positions are offsets in the text the tokens came from.
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).
import { readGroup, readBracket, skipSpaces, skipSp, findMath, matchEnvironment, isPictureEnv } from "../structure.mjs";
import { readDefinition, isDefinitionForm } from "../definition.mjs";
import { INCLUDE_ONE, INCLUDE_TWO } from "../reader.mjs";

// The sectioning commands in Pandoc's order (_a11y04-observe.txt H01-H03:
// Pandoc 3.11 places \part above \chapter above \section whatever the class).
export const LEVEL = Object.freeze({ part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 });

// ---- token helpers ----
const isO = (t, ch) => !!t && t.kind === "Other" && t.text === ch;
const isCW = (t, n) => !!t && t.kind === "ControlWord" && (n === undefined || t.name === n);
const isBlank = (t) => t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment";
const textOf = (ts, a, b) => ts.slice(a, b + 1).filter((t) => t.kind !== "Comment").map((t) => t.text).join("");
const inner = (ts, g) => (g ? textOf(ts, g.open + 1, g.close - 1) : "");
const squash = (s) => s.split(/\s+/).filter(Boolean).join(" ");        // display only: runs of blanks to one space
function envAt(ts, i) {                        // \begin or \end at i: { name, close } of its {name} group
  const g = readGroup(ts, i + 1);
  return g ? { name: inner(ts, g).trim(), close: g.close } : null;
}

// ---- what is switched off ----
// \iffalse .. its \fi (counting the \if.. words between), every definition
// statement (v2/definition.mjs reads it, the tool's own reader), and the body
// of an environment the document hides.
function deadMask(ts, hidden) {
  const dead = new Uint8Array(ts.length);
  const mark = (a, b) => { for (let k = a; k <= b && k < ts.length; k++) dead[k] = 1; };
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind !== "ControlWord") continue;
    if (t.name === "iffalse") {
      let d = 1, k = i + 1;
      for (; k < ts.length; k++) {
        const u = ts[k];
        if (u.kind !== "ControlWord") continue;
        if (u.name.startsWith("if") && u.name !== "ifthenelse" && u.name !== "iff") d++;
        else if (u.name === "fi" && --d === 0) break;
      }
      mark(i, k); i = k; continue;
    }
    if (isDefinitionForm(t.name) || t.name === "global" || t.name === "long") {
      const d = readDefinition(ts, i);
      if (d && d.close > i) { mark(i, d.close); i = d.close; }
      continue;
    }
    if (t.name === "begin" && hidden.size) {
      const e = envAt(ts, i);
      if (e && hidden.has(e.name)) { const m = matchEnvironment(ts, i); if (m) { mark(i, m.close); i = m.close; } }
    }
  }
  return dead;
}

// ---- options [key=value, ...], by tokens ----
// The entries between token indices open and close (exclusive), split at
// commas outside braces; a key is the text before its first = outside braces;
// a value that is one brace group is unwrapped. { key, value, open, close }:
// value null for a key alone (artifact); open..close the value's tokens.
function keysOf(ts, open, close) {
  const out = [];
  let from = open + 1, depth = 0;
  const flush = (to) => {
    let a = from, b = to - 1;
    while (a <= b && isBlank(ts[a])) a++;
    while (b >= a && isBlank(ts[b])) b--;
    if (a > b) return;
    let eq = -1, d = 0;
    for (let k = a; k <= b; k++) {
      if (ts[k].kind === "BeginGroup") d++;
      else if (ts[k].kind === "EndGroup") d--;
      else if (d === 0 && isO(ts[k], "=")) { eq = k; break; }
    }
    if (eq < 0) { out.push({ key: textOf(ts, a, b).trim().toLowerCase(), value: null, open: -1, close: -1 }); return; }
    let va = eq + 1, vb = b;
    while (va <= vb && isBlank(ts[va])) va++;
    let value = textOf(ts, va, vb).trim(), vOpen = va, vClose = vb;
    const g = va <= vb ? readGroup(ts, va) : null;
    if (g && g.close === vb) { value = inner(ts, g).trim(); vOpen = g.open; vClose = g.close; }
    out.push({ key: textOf(ts, a, eq - 1).trim().toLowerCase(), value, open: vOpen, close: vClose });
  };
  for (let k = open + 1; k < close; k++) {
    const t = ts[k];
    if (t.kind === "BeginGroup") depth++;
    else if (t.kind === "EndGroup") depth--;
    else if (depth === 0 && isO(t, ",")) { flush(k); from = k + 1; }
  }
  flush(close);
  return out;
}
// what an image's options carry: alt (null when absent, "" for alt={}),
// artifact, actualtext, and alt inside tagging-setup={..}
function altOf(ts, brackets) {
  const r = { alt: null, artifact: false, actualtext: null, taggingAlt: null };
  for (const br of brackets) for (const e of keysOf(ts, br.open, br.close)) {
    if (e.key === "alt" && e.value !== null) r.alt = e.value;
    else if (e.key === "artifact") r.artifact = true;
    else if (e.key === "actualtext" && e.value !== null) r.actualtext = e.value;
    else if (e.key === "tagging-setup" && e.value !== null && e.open >= 0 && ts[e.open].kind === "BeginGroup")
      for (const s of keysOf(ts, e.open, e.close)) {
        if (s.key === "alt" && s.value !== null) r.taggingAlt = s.value;
        else if (s.key === "artifact") r.artifact = true;
        else if (s.key === "actualtext" && s.value !== null) r.actualtext = s.value;
      }
  }
  return r;
}

// ---- headings: an empty title (BUILD-PLAN-a11y03 H3; a11y-01's 1,725 false
// alarms were titles made of one command, which are NOT empty) ----
const SPACE_SYMBOLS = new Set([" ", ",", ";", ":", "!", "/", "\\", "-"]);
const SPACE_WORDS = new Set(["quad", "qquad", "enspace", "thinspace", "medspace", "thickspace", "negthinspace", "hfill", "hfil", "vfill",
  "space", "nobreakspace", "relax", "noindent", "indent", "strut", "newline", "linebreak", "par", "smallskip", "medskip", "bigskip", "null"]);
const SPACE_WITH_ARG = new Set(["hspace", "vspace", "hskip", "vskip", "kern"]);
function emptyTitle(ts, g) {
  for (let k = g.open + 1; k < g.close; k++) {
    const t = ts[k];
    if (isBlank(t) || t.kind === "BeginGroup" || t.kind === "EndGroup" || isO(t, "~")) continue;
    if (t.kind === "ControlSymbol" && SPACE_SYMBOLS.has(t.name)) continue;
    if (t.kind === "ControlWord" && SPACE_WORDS.has(t.name)) continue;
    if (t.kind === "ControlWord" && SPACE_WITH_ARG.has(t.name)) {
      let j = k + 1; const s = skipSp(ts, j); if (isO(ts[s], "*")) j = s + 1;
      const a = readGroup(ts, j); if (a) { k = a.close; continue; }
      return false;
    }
    return false;
  }
  return true;
}

// ---- bold text alone in its paragraph (a11y-01's rule, checked by hand there) ----
const FORMAT_WORDS = new Set(["bf", "bfseries", "textbf", "large", "Large", "LARGE", "huge", "Huge", "small", "normalsize", "centering",
  "noindent", "par", "hfill", "quad", "qquad", "sffamily", "rmfamily", "itshape", "upshape", "scshape", "em", "it", "sc", "sf"]);
function hasText(ts, a, b) {
  for (let k = a; k <= b; k++) {
    const t = ts[k];
    if (isBlank(t) || t.kind === "BeginGroup" || t.kind === "EndGroup" || isO(t, "~")) continue;
    if (t.kind === "ControlWord" && FORMAT_WORDS.has(t.name)) continue;
    if (t.kind === "ControlSymbol" && SPACE_SYMBOLS.has(t.name)) continue;
    return true;
  }
  return false;
}
const softBlank = (t) => t.kind === "Space" || t.kind === "Comment" || (t.kind === "Newline" && !t.parbreak);
function aloneInParagraph(ts, a, b) {
  let k = a - 1;
  while (k >= 0 && softBlank(ts[k])) k--;
  let before = k < 0 || (ts[k].kind === "Newline" && ts[k].parbreak) || isCW(ts[k], "par");
  if (!before && isCW(ts[k], "noindent")) {
    let q = k - 1; while (q >= 0 && softBlank(ts[q])) q--;
    before = q < 0 || (ts[q].kind === "Newline" && ts[q].parbreak);
  }
  if (!before) return false;
  k = b + 1;
  while (k < ts.length && (softBlank(ts[k]) || (ts[k].kind === "ControlSymbol" && ts[k].name === "\\"))) k++;
  return k >= ts.length || (ts[k].kind === "Newline" && ts[k].parbreak) || isCW(ts[k], "par") || isCW(ts[k], "end");
}

// ---- tables (a11y-02, observed) ----
// Pandoc makes a table of these (A01, E02, E06, E07, X38) / not (E03-E05, X23, X24, X36, X37, X39) / untested.
export const ENV_TABLE = new Set(["tabular", "tabular*", "tabularx", "longtable", "supertabular"]);
export const ENV_NOT = new Set(["tblr", "longtblr", "NiceTabular", "tabulary", "xtabular", "tabu"]);
const ENV_OTHER = new Set(["talltblr", "longtabu", "xltabular", "xtabular*", "supertabular*", "mpsupertabular", "NiceTabular*", "NiceTabularX", "longtable*", "tabularew", "ltablex"]);
const TABLE_ENVS = new Set([...ENV_TABLE, ...ENV_NOT, ...ENV_OTHER]);
// Rule-like words that may follow a row, and the arguments each takes (b [..], g {..}, p (..)).
const RULES = { hline: [], cline: ["g"], toprule: ["b"], midrule: ["b"], bottomrule: ["b"], cmidrule: ["b", "p", "g"], hhline: ["g"], Xhline: ["g"], specialrule: ["g", "g", "g"],
  hdashline: ["b"], cdashline: ["g"], noalign: ["g"], endhead: [], endfirsthead: [], endfoot: [], endlastfoot: [], arrayrulecolor: ["g"], addlinespace: ["b"], Hline: ["b"], firsthline: [], lasthline: [], morecmidrules: [] };
// Box commands and their arguments; the last g is the body.
const BOX = { resizebox: ["g", "g", "g"], scalebox: ["g", "b", "g"], fbox: ["g"], framebox: ["b", "b", "g"], makebox: ["b", "b", "g"], raisebox: ["g", "b", "b", "g"],
  rotatebox: ["b", "g", "g"], adjustbox: ["g", "g"], mbox: ["g"], parbox: ["b", "b", "b", "g", "g"], colorbox: ["g", "g"], fcolorbox: ["g", "g", "g"],
  hbox: ["g"], vbox: ["g"], centerline: ["g"], shadowbox: ["g"], ovalbox: ["g"], doublebox: ["g"], savebox: ["g", "b", "b", "g"], sbox: ["g", "g"], reflectbox: ["g"], boxed: ["g"] };
function readArgs(ts, j, shape) {
  let body = null;
  for (const s of shape) {
    if (s === "b") { const b = readBracket(ts, j); if (b) j = b.close + 1; }
    else if (s === "p") { let q = skipSpaces(ts, j); if (isO(ts[q], "(")) { while (q < ts.length && !isO(ts[q], ")")) q++; j = q + 1; } }
    else { const g = readGroup(ts, j); if (!g) return { end: j, body }; body = g; j = g.close + 1; }
  }
  return { end: j, body };
}
// The column spec, by tokens: columns, rules at each inner boundary, siunitx S.
function parseSpec(ts, open, close) {
  const r = { cols: 0, rules: new Set(), S: false };
  for (let k = open + 1; k < close; k++) {
    const t = ts[k];
    if (isBlank(t)) continue;
    if (t.kind === "BeginGroup") { const g = readGroup(ts, k); if (g) k = g.close; continue; }
    if (t.kind !== "Other") continue;
    const c = t.text;
    if (c === "|" || c === ":" || c === ";") { r.rules.add(r.cols); continue; }
    if (c === "!") { r.rules.add(r.cols); const g = readGroup(ts, k + 1); if (g) k = g.close; continue; }
    if (c === "@" || c === ">" || c === "<") { const g = readGroup(ts, k + 1); if (g) k = g.close; continue; }
    if (c === "*") {
      const n = readGroup(ts, k + 1); if (!n) continue;
      const sub = readGroup(ts, n.close + 1); if (!sub) { k = n.close; continue; }
      const times = parseInt(inner(ts, n), 10) || 1, s = parseSpec(ts, sub.open, sub.close);
      for (let q = 0; q < times; q++) { for (const b of s.rules) r.rules.add(r.cols + b); r.cols += s.cols; }
      r.S = r.S || s.S; k = sub.close; continue;
    }
    if (c === "p" || c === "m" || c === "b") { r.cols++; const g = readGroup(ts, k + 1); if (g) k = g.close; continue; }
    if (c === "w" || c === "W") { r.cols++; const g = readGroup(ts, k + 1); if (g) { const g2 = readGroup(ts, g.close + 1); k = g2 ? g2.close : g.close; } continue; }
    if (c === "S" || c === "s") { r.cols++; r.S = true; const b = readBracket(ts, k + 1); if (b) k = b.close; continue; }
    if (c.length === 1 && ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z"))) r.cols++;   // l c r X ... and a user's column type: one column
  }
  return r;
}
// Every brace group's owning command: the control word before it, over earlier argument groups and brackets.
function groupOwners(ts) {
  const match = new Int32Array(ts.length).fill(-1), st = [];
  for (let k = 0; k < ts.length; k++) {
    if (ts[k].kind === "BeginGroup") st.push(k);
    else if (ts[k].kind === "EndGroup" && st.length) { const o = st.pop(); match[o] = k; match[k] = o; }
  }
  return (open) => {
    let k = open - 1;
    for (let guard = 0; k >= 0 && guard < 40; guard++) {
      const t = ts[k];
      if (isBlank(t)) { k--; continue; }
      if (t.kind === "EndGroup" && match[k] >= 0) { k = match[k] - 1; continue; }
      if (isO(t, "]")) {
        let q = k - 1, d = 0;
        for (; q >= 0; q--) { if (ts[q].kind === "EndGroup") d++; else if (ts[q].kind === "BeginGroup") { if (d === 0) break; d--; } else if (d === 0 && isO(ts[q], "[")) break; }
        if (q >= 0 && isO(ts[q], "[")) { k = q - 1; continue; }
        return null;
      }
      if (t.kind === "ControlWord") return t.name;
      return null;
    }
    return null;
  };
}
function analyseTable(ts, i, e, dead, owner) {
  const m = matchEnvironment(ts, i);
  const info = { env: e.name, start: ts[i].start, end: ts[e.close].end, cols: 0, S: false, rows: [], firstRule: null, afterRow1: null,
    multicolumn: 0, multirow: 0, tagpdf: 0, hdash: 0, noalign: 0, breaks: {}, endhead: 0, endfirsthead: 0, caption: 0 };
  if (!m) return info;
  let j = e.close + 1;
  if (e.name === "tabular*" || e.name === "tabularx" || e.name === "tabulary" || e.name === "xtabular*" || e.name === "NiceTabularX" || e.name === "xltabular") { const w = readGroup(ts, j); if (w) j = w.close + 1; }
  const ob = readBracket(ts, j); if (ob) j = ob.close + 1;
  const spec = readGroup(ts, j);
  if (spec) { j = spec.close + 1; const s = parseSpec(ts, spec.open, spec.close); info.cols = s.cols; info.S = s.S; }
  // rows at the table's own depth; a \\ inside a group is a cell break, owned by a command
  let row = { cells: 1, content: false, mc: [], rulesAfter: [] }, depth = 0, envDepth = 0;
  const groupStack = [];
  const endRow = (k) => {
    let q = k + 1; const br = readBracket(ts, q); if (br) q = br.close + 1;
    const names = [];
    let next = null;
    for (;;) {
      q = skipSpaces(ts, q);
      const u = ts[q];
      if (!u || q >= m.endWord) break;
      if (u.kind !== "ControlWord" || !(u.name in RULES)) { if (u.kind === "ControlWord") next = u.name; break; }
      names.push(u.name);
      if (u.name === "endhead") info.endhead++; if (u.name === "endfirsthead") info.endfirsthead++;
      if (u.name === "hdashline" || u.name === "cdashline") info.hdash++; if (u.name === "noalign") info.noalign++;
      q = readArgs(ts, q + 1, RULES[u.name]).end;
    }
    row.rulesAfter = names;
    if (row.caption && !row.content && row.cells === 1) { /* a longtable caption row: not a row */ }
    else { if (!info.rows.length && !names.length) info.afterRow1 = next; info.rows.push(row); }
    row = { cells: 1, content: false, mc: [], rulesAfter: [] };
    return q - 1;
  };
  for (let k = j; k < m.endWord; k++) {
    const u = ts[k];
    if (dead[k]) continue;
    if (u.kind === "BeginGroup") { depth++; groupStack.push(owner(k)); continue; }
    if (u.kind === "EndGroup") { depth--; groupStack.pop(); continue; }
    if (isCW(u, "begin")) {
      const en = envAt(ts, k);
      if (en && TABLE_ENVS.has(en.name)) { row.content = true; const mm = matchEnvironment(ts, k); if (mm) { k = mm.close; continue; } }
      envDepth++; continue;
    }
    if (isCW(u, "end")) { envDepth = Math.max(0, envDepth - 1); continue; }
    if (u.kind === "AlignTab" && depth === 0 && envDepth === 0) { row.cells++; continue; }
    if ((u.kind === "ControlSymbol" && u.name === "\\") || isCW(u, "tabularnewline")) {
      if (depth === 0 && envDepth === 0) { k = endRow(k); continue; }
      const own = depth > 0 ? (groupStack.filter(Boolean).slice(-1)[0] || "(group)") : "(environment)";
      info.breaks[own] = (info.breaks[own] || 0) + 1;
      continue;
    }
    if (u.kind === "ControlWord") {
      const nm = u.name;
      if (depth === 0 && envDepth === 0 && nm in RULES && !row.content && row.cells === 1) {     // a rule before any content of the row
        if (nm === "hdashline" || nm === "cdashline") info.hdash++; if (nm === "noalign") info.noalign++;
        if (nm === "endhead") info.endhead++; if (nm === "endfirsthead") info.endfirsthead++;
        k = readArgs(ts, k + 1, RULES[nm]).end - 1; continue;
      }
      if (nm === "multicolumn") {
        info.multicolumn++; row.content = true;
        const g = readGroup(ts, k + 1);
        if (g) {
          row.mc.push(parseInt(inner(ts, g), 10) || 1);
          const g2 = readGroup(ts, g.close + 1), g3 = g2 ? readGroup(ts, g2.close + 1) : null;
          if (g3 && row.title === undefined) row.title = squash(inner(ts, g3));          // a title row's text, for the message
        }
        continue;
      }
      if (nm === "multirow") { info.multirow++; row.content = true; continue; }
      if (nm === "tagpdfsetup") { info.tagpdf++; continue; }
      if (nm === "caption") { info.caption++; row.caption = true; k = readArgs(ts, k + 1, ["b", "g"]).end - 1; continue; }
      if (nm === "label") { k = readArgs(ts, k + 1, ["g"]).end - 1; continue; }
      if (nm === "hdashline" || nm === "cdashline") { info.hdash++; continue; }
      if (nm === "noalign") { info.noalign++; continue; }
      if (nm === "hline" || nm === "cline") continue;
      row.content = true; continue;
    }
    if (isBlank(u)) continue;
    row.content = true;
  }
  if (row.content || row.cells > 1) info.rows.push(row);
  info.firstRule = (info.rows[0] && info.rows[0].rulesAfter[0]) || null;
  return info;
}

// ---- the inventory ----
// inventoryOf(tokens, { exam, hidden })
//   exam    the document's class is exam: \part is never a heading
//   hidden  names of environments the document hides (the reader's
//           summary.hiddenEnvironments): their bodies are skipped
export function inventoryOf(ts, options = {}) {
  const exam = !!options.exam, hidden = new Set(options.hidden || []);
  const out = { headings: [], bold: [], images: [], tables: [], includes: [], tagging: { metadata: false, on: false, headerRows: false } };
  const dead = deadMask(ts, hidden);
  const inMath = new Uint8Array(ts.length);
  for (const s of findMath(ts)) for (let k = s.open; k <= s.close; k++) inMath[k] = 1;
  const owner = groupOwners(ts);
  // box bodies, and \captionof{table} (a11y-02)
  const boxes = [], captionofs = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (dead[i] || t.kind !== "ControlWord") continue;
    if (BOX[t.name]) { let j = i + 1; if (isO(ts[skipSpaces(ts, j)], "*")) j = skipSpaces(ts, j) + 1; const a = readArgs(ts, j, BOX[t.name]); if (a.body) boxes.push({ name: t.name, open: a.body.open, close: a.body.close }); }
    if (t.name === "captionof") { const g = readGroup(ts, i + 1); if (g && inner(ts, g).trim() === "table") captionofs.push(i); }
  }
  const envStack = [];                           // { name, i }
  let drawDepth = 0;
  const inEnv = (...names) => envStack.some((x) => names.includes(x.name));
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (dead[i] || t.kind !== "ControlWord") continue;
    const n = t.name;
    if (n === "begin" || n === "end") {
      const e = envAt(ts, i);
      if (!e) continue;
      if (n === "end") {
        for (let k = envStack.length - 1; k >= 0; k--) if (envStack[k].name === e.name) { envStack.length = k; break; }
        if (isPictureEnv(e.name) && drawDepth > 0) drawDepth--;
        i = e.close; continue;
      }
      if (isPictureEnv(e.name) && !inMath[i]) {
        if (drawDepth === 0) {
          const br = readBracket(ts, e.close + 1);
          out.images.push(Object.assign({ kind: "drawing", what: e.name, src: null, head: { env: e.name } }, altOf(ts, br ? [br] : []),
            { inFigure: inEnv("figure", "figure*"), start: t.start, end: ts[e.close].end }));
        }
        drawDepth++;
      }
      if (TABLE_ENVS.has(e.name) && !inMath[i]) {
        const info = analyseTable(ts, i, e, dead, owner);
        info.nested = envStack.some((x) => TABLE_ENVS.has(x.name));
        info.inDrawing = drawDepth > 0;
        info.boxes = boxes.filter((b) => b.open < i && b.close > i).map((b) => b.name);
        const encl = envStack.length ? envStack[envStack.length - 1].i : 0;
        info.captionof = captionofs.some((c) => c > encl && c < i);
        info.head = { env: e.name };                  // its first token, to find it again inside a definition
        out.tables.push(info);
      }
      envStack.push({ name: e.name, i });
      i = e.close; continue;
    }
    if (n in LEVEL && !inMath[i] && drawDepth === 0) {
      if (n === "part" && (exam || inEnv("parts"))) continue;
      let j = i + 1; const sj = skipSp(ts, j);
      let star = false; if (isO(ts[sj], "*")) { star = true; j = sj + 1; }
      const br = readBracket(ts, j); if (br) j = br.close + 1;
      const g = readGroup(ts, j);
      if (!g) continue;                          // no title group: not a sectioning use
      out.headings.push({ name: n, level: LEVEL[n], star, title: squash(inner(ts, g)), empty: emptyTitle(ts, g), start: t.start, end: ts[g.close].end, head: { cw: n } });
      i = g.close; continue;
    }
    if ((n === "textbf" || n === "bf" || n === "bfseries") && !inMath[i] && drawDepth === 0) {
      let a, b, from;                            // a, b: the bold piece's first and last tokens; from: its text's first
      if (n === "textbf") { const g = readGroup(ts, i + 1); if (!g) continue; a = i; b = g.close; from = g.open + 1; }
      else {
        let k = i - 1; while (k >= 0 && (ts[k].kind === "Space" || ts[k].kind === "Comment")) k--;
        if (!ts[k] || ts[k].kind !== "BeginGroup") continue;
        const g = readGroup(ts, k); if (!g) continue; a = k; b = g.close; from = i + 1;
      }
      if (hasText(ts, from, b - 1) && aloneInParagraph(ts, a, b))
        out.bold.push({ name: n, text: squash(textOf(ts, from, b - 1)), start: ts[a].start, end: ts[b].end, head: { cw: n } });
      continue;
    }
    if (n === "includegraphics" && drawDepth === 0) {
      let j = i + 1; const sj = skipSp(ts, j); if (isO(ts[sj], "*")) j = sj + 1;
      const brs = []; for (let k = 0; k < 2; k++) { const br = readBracket(ts, j); if (!br) break; brs.push(br); j = br.close + 1; }
      const g = readGroup(ts, j);
      out.images.push(Object.assign({ kind: "image", what: "includegraphics", src: g ? inner(ts, g).trim() : null, head: { cw: "includegraphics" } }, altOf(ts, brs),
        { inFigure: inEnv("figure", "figure*"), start: t.start, end: g ? ts[g.close].end : t.end }));
      if (g) i = g.close;
      continue;
    }
    if (n === "tikz" && drawDepth === 0 && !inMath[i]) {
      const br = readBracket(ts, i + 1);
      out.images.push(Object.assign({ kind: "drawing", what: "\\tikz", src: null, head: { cw: "tikz" } }, altOf(ts, br ? [br] : []),
        { inFigure: inEnv("figure", "figure*"), start: t.start, end: br ? ts[br.close].end : t.end }));
      continue;
    }
    if (INCLUDE_ONE.has(n) || INCLUDE_TWO.has(n)) {
      const a = readArgs(ts, i + 1, INCLUDE_TWO.has(n) ? ["g", "g"] : ["g"]);
      out.includes.push({ name: n, start: t.start, end: a.body ? ts[a.body.close].end : t.end });
      continue;
    }
    if (n === "DocumentMetadata") {
      const g = readGroup(ts, i + 1);
      out.tagging.metadata = true;
      if (g) for (const e of keysOf(ts, g.open, g.close))
        if ((e.key === "tagging" && e.value === "on") || e.key === "testphase") out.tagging.on = true;
      continue;
    }
    if (n === "tagpdfsetup") {
      const g = readGroup(ts, i + 1);
      if (g) for (const e of keysOf(ts, g.open, g.close)) if (e.key === "table/header-rows" || e.key === "table/header-columns") out.tagging.headerRows = true;
    }
  }
  return out;
}
