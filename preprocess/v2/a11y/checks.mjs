// v2/a11y/checks.mjs — session a11y-04. The accessibility checker's checks
// (accessibility-checker/BUILD-PLAN-a11y03.md §2, adjusted to the decisions of
// 2026-10-26 and to what Pandoc 3.11 was seen to do, _work/_a11y04-observe*.txt).
//
// Plain terms: each check reads the document's inventory (v2/a11y/inventory.mjs,
// every file's, in reading order) and says where an accessibility need is not
// met, which way of meeting it was used, and that way's rank (v2/findings.mjs
// HIERARCHY). It says nothing in words: the wording table
// (v2/a11y/wording.mjs) does that, so the two stay apart.
//
// A finding: { id, variant, file, start, end, head, rank, data }; head: the
// construct's first token as the inventory gives it ({ cw } or { env }); id one of
// H1 H1p H2 H3 H4 I1 I2 I3 T1 T2 T3 T4, variant a key of that check's wording.
//
// runChecks(doc, options)
//   doc.headings / bold / images / tables   inventory items, each with `file`;
//                                           headings in the document's reading order
//   doc.cls        the document class (exam, article, book ...)
//   doc.tagging    { metadata, on, headerRows } over the whole document
//   doc.mode       "pp" (the -pp text, with the preprocessor) or "original" (alone)
//   doc.isAuthorCommand(name)   true for a command the author defined (alone only)
//   doc.partFixed  the preprocessor writes this document's heading \part as
//                  \chapter (v2/transforms/part-chapter.mjs; alone only)
//   options.encourage   also report the rank-2 notes (good for the platform,
//                       not for Overleaf's PDF); off by default (DECISIONS
//                       2026-10-26, D5: the tagged-PDF "encourage" checks)
import { LEVEL, ENV_TABLE, ENV_NOT } from "./inventory.mjs";

const NAME_AT = Object.keys(LEVEL);                 // level -> name
// Classes with \chapter (where \part -> \section misses a level in the PDF too).
const CHAPTER_CLASSES = new Set(["book", "report", "memoir", "scrbook", "scrreprt", "amsbook", "jsbook", "jreport", "tufte-book", "extbook", "extreport", "octavo", "ctexbook", "ctexrep"]);
// Placeholder alt texts: the first build plan's list (Nicholas's "A": ALT TEXT NEEDED) and a11y-01's additions.
const PLACEHOLDER = new Set(["alt text needed", "image", "figure", "picture", "graph", "diagram", "photo", "img", "plot", "chart"]);
// Pandoc 3.11 makes row 1 the header only when one of these follows it (a11y-02: A01 A04 B01 B02 X01 X09 X41);
// these look the same in the PDF and are ignored (X02-X06).
const HEAD_YES = new Set(["hline", "cline", "midrule", "cmidrule", "toprule", "endhead"]);
const HEAD_NO = new Set(["hhline", "Xhline", "specialrule", "hdashline", "noalign"]);
// Box commands a table vanishes inside (X11 X25 X26 X29-X31 X34 X35), or Pandoc stops at (X33; the preprocessor wraps it).
const BOX_VANISH = ["resizebox", "scalebox", "fbox", "framebox", "makebox", "raisebox", "rotatebox", "adjustbox"];
const CELL_BREAK_LOSS = ["makecell", "shortstack"];

const base = (file) => { const s = String(file || "").split("/").pop().split("\\").pop(); return s.toLowerCase(); };
const noExt = (s) => { const k = s.lastIndexOf("."); return k > 0 ? s.slice(0, k) : s; };
const isPandocTable = (t) => !t.nested && !t.inDrawing && ENV_TABLE.has(t.env) && !t.S && !t.boxes.some((b) => BOX_VANISH.includes(b) || b === "mbox");

export function runChecks(doc, options = {}) {
  const out = [];
  const add = (id, variant, item, rank, data = {}) => out.push({ id, variant, file: item.file, start: item.start, end: item.end, head: item.head, rank, data });
  const tagging = doc.tagging || { metadata: false, on: false, headerRows: false };

  // ---- headings, over the whole document in reading order ----
  const hs = doc.headings || [];
  const hasChapters = CHAPTER_CLASSES.has(doc.cls) || hs.some((h) => h.name === "chapter");
  if (hs.length) {
    const top = Math.min(...hs.map((h) => h.level));
    if (hs[0].level > top) add("H2", "first", hs[0], 4, { first: hs[0].name, top: NAME_AT[top] });
  }
  for (let k = 0; k < hs.length; k++) {
    const h = hs[k], p = hs[k - 1];
    if (p && h.level > p.level + 1) {
      const d = { from: p.name, to: h.name, missing: NAME_AT[p.level + 1], title: h.title };
      if (h.level >= LEVEL.paragraph) add("H1p", "label", h, 4, d);
      // session 274: alone, where the preprocessor would write \part as \chapter, a note that it does
      else if (p.name === "part" && h.name === "section" && !hasChapters) add("H1", doc.mode === "original" && doc.partFixed ? "part-section-fixed" : "part-section", h, 3, d);
      else add("H1", "skip", h, 4, d);
    }
    if (h.empty) add("H3", "empty", h, 4, { name: h.name + (h.star ? "*" : ""), title: h.title });
  }
  for (const b of doc.bold || []) add("H4", "bold", b, 4, { text: b.text });

  // ---- images ----
  for (const m of doc.images || []) {
    const described = m.alt !== null || m.artifact || m.actualtext !== null || m.taggingAlt !== null;
    if (!described) { add("I1", m.kind === "drawing" ? "drawing" : m.inFigure ? "figure" : "image", m, 4); continue; }
    if (m.alt !== null && m.alt !== "") {
      const v = m.alt.trim().toLowerCase(), f = m.src ? base(m.src) : null;
      if (PLACEHOLDER.has(v) || (f && (v === f || v === noExt(f)))) { add("I2", "placeholder", m, 4, { alt: m.alt }); continue; }
    }
    if (m.kind === "drawing" && m.alt !== null) { add("I3", "drawing-alt", m, 3, { alt: m.alt }); continue; }
    if (m.alt === null && m.taggingAlt !== null) { add("I3", "tagging-setup", m, 3, { alt: m.taggingAlt }); continue; }
    if (m.alt === null && m.artifact) { add("I3", doc.mode === "pp" ? "artifact-not-carried" : "artifact-alone", m, 3); continue; }
    if (m.alt === null && m.actualtext !== null) { add("I3", doc.mode === "pp" ? "actualtext-not-carried" : "actualtext-alone", m, 3, { actualtext: m.actualtext }); continue; }
    if (options.encourage && m.kind === "image" && m.alt !== null && m.alt !== "" && !tagging.on) add("I1", "good-platform", m, 2);
  }

  // ---- tables ----
  for (const t of doc.tables || []) {
    if (t.inDrawing) continue;                       // goes with the drawing (the image checks)
    const vanish = t.boxes.find((b) => BOX_VANISH.includes(b));
    if (vanish) add("T1", "box", t, 3, { box: vanish });
    else if (ENV_NOT.has(t.env)) add("T1", "env", t, 3, { env: t.env });
    else if (t.S) add("T1", "S", t, 3);
    if (!isPandocTable(t)) continue;
    const owner = CELL_BREAK_LOSS.find((o) => t.breaks[o]);
    if (owner) add("T2", "makecell", t, 3, { owner });
    else if (t.hdash || t.noalign) add("T2", "dash", t, 3, { rule: t.hdash ? "hdashline" : "noalign" });
    else if (t.tagpdf && t.multirow) add("T2", "tagpdf", t, 3);
    else if (t.captionof) add("T2", "captionof", t, 3);
    if (t.rows.length < 2 || t.cols < 2) continue;
    if (!HEAD_YES.has(t.firstRule)) {
      if (HEAD_NO.has(t.firstRule)) add("T3", "ignored-rule", t, 4, { rule: t.firstRule });
      else if (doc.mode === "original" && t.afterRow1 && doc.isAuthorCommand && doc.isAuthorCommand(t.afterRow1)) add("T3", "author-command", t, 4, { command: t.afterRow1 });
      else if (tagging.headerRows) add("T3", "tagged-header-rows", t, 3);
      else add("T3", "none", t, 4);
      continue;
    }
    const r1 = t.rows[0];
    if (r1.cells === 1 && r1.mc.length === 1 && t.cols > 1 && r1.mc[0] >= t.cols) add("T4", "title", t, 4, { title: r1.title || "" });
    else if (options.encourage && !(tagging.on && tagging.headerRows)) add("T3", "good-platform", t, 2);
  }
  return out;
}
