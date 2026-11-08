// v2/a11y/wording.mjs — session a11y-04. The accessibility checker's WORDING
// TABLE, kept apart from the checks (the first build plan: "Its wording ...
// lives in one wording table, separate from its rule"), so it can join the
// platform's help messages later without touching a check.
//
// Each check is written as an accessibility NEED with the accepted ways of
// meeting it, and each way names the outputs it serves (DECISIONS 2026-10-26,
// "keeping the hierarchy of preferred fixes clear"; v2/findings.mjs HIERARCHY):
// rank 1 the PDF, the web page and Word; rank 2 the web page and Word (the
// platform) - good, with a note that Overleaf's PDF does not get it; rank 3 the
// PDF only - reported as missing for the web page and Word, with the fix that
// serves every output; rank 4 none. A message names the need first, then what
// reaches each output, then the best fix; the fixes list goes best first.
//
// Every claim below about what an output gets was observed:
//   headings, images (web page)  _work/_a11y04-observe.txt (cases H01-H10, I01-I10)
//   images (Word)                _work/_a11y04-observe2.txt
//   images (PDF)                 _work/_a11y04-observe3.txt: alt, artifact,
//                                actualtext, tagging-setup alt and alt on a
//                                drawing reach the PDF only with tagging on;
//                                tagging-setup does not compile without it
//   tables (web page)            _work/_a11y02-observations.txt (case ids)
//   tables (PDF)                 _work/_a11y04-observe4.txt: header cells only
//                                from table/header-rows with tagging on
//
// Pure data and small functions; no file is read or written.

const ALL = Object.freeze(["pdf", "html", "word"]), PLATFORM = Object.freeze(["html", "word"]), PDF = Object.freeze(["pdf"]), NONE = Object.freeze([]);
const way = (w, serves, rank) => Object.freeze({ way: w, serves, rank });

const HEADING_WAYS = [way("sectioning commands, each one level below the heading above it (\\section, then \\subsection, then \\subsubsection)", ALL, 1)];
const IMAGE_WAYS = [
  way("alt={..} on the image, with tagging switched on (\\DocumentMetadata{tagging=on})", ALL, 1),
  way("alt={..} on the image (alt={} for a decorative image)", PLATFORM, 2),
  way("artifact or actualtext=.. (tagged PDF; the platform's preprocessor carries them to the web page and Word, plain Pandoc does not)", PDF, 3),
  way("tagging-setup={alt=..}", PDF, 3),
];
const DRAWING_WAYS = [
  way("the drawing saved as an image file and included with \\includegraphics[alt={..}] (with tagging on for the PDF)", ALL, 1),
  way("alt={..} in the drawing's options (tagged PDF only: the platform's image step drops it today)", PDF, 3),
];
const TABLE_WAYS = [
  way("a plain tabular: no box command around it, ordinary columns (l, c, r, p{..})", ALL, 1),
  way("the table as written (the PDF only)", PDF, 3),
];
const HEADER_WAYS = [
  way("a rule (\\hline or \\midrule) right after the heading row, and \\tagpdfsetup{table/header-rows=1} with tagging on", ALL, 1),
  way("a rule (\\hline or \\midrule) right after the heading row", PLATFORM, 2),
  way("\\tagpdfsetup{table/header-rows=1} with tagging on", PDF, 3),
];

// the place an entry is, for a message: "line 12 of ch1.tex"
const at = (d) => (d && d.line ? "line " + d.line + (d.file ? " of " + d.file : "") : "");

export const CHECK_IDS = Object.freeze(["H1", "H1p", "H2", "H3", "H4", "I1", "I2", "I3", "T1", "T2", "T3", "T4"]);

export const WORDING = Object.freeze({
  H1: {
    group: "headings", kind: "fix-by-hand", level: "warning", label: "Heading level skipped",
    need: "Headings form an outline with no level missing, so a screen reader user can move through the page by heading level.",
    why: "A missing level makes the outline look as if part of the document were lost, and makes navigating by level unreliable.",
    ways: HEADING_WAYS,
    variants: {
      skip: {
        message: (d) => "Heading level skipped: \\" + d.to + " comes right after \\" + d.from + ", with no \\" + d.missing + " between them. The outline has a level missing in the PDF, the web page and Word.",
        fixes: (d) => ["Use \\" + d.missing + " here, or add the missing \\" + d.missing + " above it."] },
      "part-section": {
        message: () => "Heading level skipped in the web page and Word: \\section comes right after \\part. Your PDF is fine (this class has no chapters, so \\part sits directly above \\section), but Pandoc always places \\chapter between \\part and \\section, so the web page goes from a level-1 heading to a level-3 heading.",
        fixes: () => ["If the parts are the document's top level, use \\section for each part and \\subsection below it: right in every output.",
                      "Or keep \\part and accept the gap in the web page and Word (the PDF stays right)."],
        ways: [...HEADING_WAYS, way("\\part directly above \\section, in a class without chapters", PDF, 3)] },
      // session 274: the checker alone, on a document the preprocessor fixes (v2/transforms/part-chapter.mjs)
      "part-section-fixed": {
        level: "note",
        message: () => "Heading level skipped in the web page and Word when this file is converted without the platform's preprocessor: \\section comes right after \\part. Your PDF is fine (this class has no chapters), but Pandoc always places \\chapter between \\part and \\section. The preprocessor fixes this for the web page and Word: in the copy Pandoc reads it writes each \\part heading as \\chapter, and the PDF stays as it is.",
        fixes: () => ["Nothing to do when converting with the platform.",
                      "Without it: if the parts are the document's top level, use \\section for each part and \\subsection below it."],
        ways: [...HEADING_WAYS, way("\\part directly above \\section, in a class without chapters", PDF, 3)] },
    },
  },
  H1p: {
    group: "headings", kind: "fix-by-hand", level: "note", label: "\\paragraph used as a label?",
    need: "Headings form an outline with no level missing; a label inside a paragraph is not a heading.",
    why: "Pandoc turns \\paragraph into a heading (level 4 or deeper), so after a \\section the outline jumps several levels. Authors often use \\paragraph for a bold run-in label, not a heading.",
    ways: [...HEADING_WAYS, way("a bold run-in label (\\textbf{Label.} followed by the text), when it is a label and not a heading", ALL, 1)],
    variants: {
      label: {
        message: (d) => "\\" + d.to + " comes right after \\" + d.from + ". In the web page and Word it becomes a heading several levels down, so the outline skips levels. If it is a label, it should not be a heading; if it is a heading, it is too deep.",
        fixes: (d) => ["If it is a label for the text that follows: write \\textbf{" + (d.title || "Label.") + "} instead.",
                       "If it is a heading: use \\" + d.missing + "."] },
    },
  },
  H2: {
    group: "headings", kind: "fix-by-hand", level: "warning", label: "First heading too deep",
    need: "The document's outline starts at its top level.",
    why: "When the first heading is deeper than the document's top level, the outline starts in the middle; a screen reader user may think the start of the document is missing.",
    ways: HEADING_WAYS,
    variants: {
      first: {
        message: (d) => "The document's first heading is \\" + d.first + ", deeper than its top level (\\" + d.top + ", used later). The outline of the PDF, the web page and Word starts in the middle.",
        fixes: (d) => ["Use \\" + d.top + " for this first heading (\\" + d.top + "* if it should not be numbered)."] },
    },
  },
  H3: {
    group: "headings", kind: "fix-by-hand", level: "warning", label: "Empty heading",
    need: "Every heading has text.",
    why: "An empty heading is announced as a heading with nothing in it, and shows as a blank entry in the outline.",
    ways: HEADING_WAYS,
    variants: {
      empty: {
        message: (d) => "Empty heading: \\" + d.name + " has no text" + (d.title ? " (only spacing: \"" + d.title + "\")" : "") + ". The web page and Word get a heading with nothing in it.",
        fixes: () => ["Add the heading's text.", "If it is only there for spacing or numbering, use spacing commands instead of a heading."] },
    },
  },
  H4: {
    group: "headings", kind: "fix-by-hand", level: "note", label: "Bold text may be a heading",
    need: "Text that works as a heading is marked as a heading.",
    why: "Bold text looks like a heading but is read as an ordinary paragraph: a screen reader user cannot jump to it or find it in the outline.",
    ways: [...HEADING_WAYS, way("bold text alone in its paragraph (looks like a heading in every output, is a heading in none)", NONE, 4)],
    variants: {
      bold: {
        message: (d) => "Bold text alone in its paragraph: \"" + d.text + "\". If it starts a new part of the document, it should be a heading.",
        fixes: (d) => ["If it starts a new part: make it a heading, e.g. \\subsection*{" + d.text + "}.", "If it is not a heading, nothing to do."] },
    },
  },
  I1: {
    group: "images", kind: "fix-by-hand", level: "warning", label: "No alt text",
    need: "Every image has a text alternative (or is marked as decoration).",
    why: "Without a description, a screen reader user gets nothing from the image, or just the word \"image\".",
    ways: IMAGE_WAYS,
    variants: {
      image: {
        message: () => "No alt text: this image has no description. The web page and Word say only \"image\"; the PDF has none.",
        fixes: () => ["Add alt={..} with a short description: \\includegraphics[alt={..}]{..}. With \\DocumentMetadata{tagging=on} it also reaches the PDF.",
                      "If the image is decoration only: alt={} (the web page and Word skip it)."] },
      figure: {
        message: () => "No alt text: this image has no description. Its figure caption is read, but the image itself has none (in the web page it has no alt at all).",
        fixes: () => ["Add alt={..} describing what the image shows (the caption names it; the alt text describes it). With \\DocumentMetadata{tagging=on} it also reaches the PDF."] },
      drawing: {
        message: () => "No alt text: this drawing has no description. The platform turns the drawing into an image, and the image has none.",
        fixes: () => ["Best for every output: save the drawing as an image file and include it with \\includegraphics[alt={..}].",
                      "Or add alt={..} to the drawing's options: today that reaches only a tagged PDF (the platform's image step drops it)."],
        ways: DRAWING_WAYS },
      "good-platform": {
        level: "note",
        message: () => "Alt text present: the web page and Word get it. It will not reach the PDF from Overleaf unless the document switches tagging on.",
        fixes: () => ["Add \\DocumentMetadata{tagging=on} (before \\documentclass, compiled with LuaLaTeX) so the PDF carries it too."] },
    },
  },
  I2: {
    group: "images", kind: "fix-by-hand", level: "warning", label: "Placeholder alt text",
    need: "Every image has a text alternative that describes it.",
    why: "A placeholder or a file name is read out as if it were a description, and tells the reader nothing.",
    ways: IMAGE_WAYS,
    variants: {
      placeholder: {
        message: (d) => "Placeholder alt text: \"" + d.alt + "\" is not a description. It is what the web page and Word will read out.",
        fixes: () => ["Replace it with a short description of what the image shows."] },
    },
  },
  I3: {
    group: "images", kind: "not-reaching-reader", level: "note", label: "Alt text won't convert",
    need: "Every image has a text alternative in every output.",
    why: "This description reaches only a tagged PDF; the web page and Word do not get it.",
    ways: IMAGE_WAYS,
    variants: {
      "tagging-setup": {
        message: (d) => "Alt text in tagging-setup ({" + d.alt + "}) reaches only a tagged PDF. The web page and Word say \"image\".",
        fixes: (d) => ["Write it as alt={" + d.alt + "} instead: the web page and Word get it, and so does the PDF with tagging on."] },
      "drawing-alt": {
        message: () => "Alt text on a drawing reaches only a tagged PDF: Pandoc drops the drawing with its description, and the platform's image step does not carry it.",
        fixes: () => ["Best for every output: save the drawing as an image file and include it with \\includegraphics[alt={..}].",
                      "Keep the alt text on the drawing for the PDF; the platform should carry it later (a known gap)."],
        ways: DRAWING_WAYS },
      "artifact-alone": {
        message: () => "Checked without the preprocessor: [artifact] (decoration) reaches only a tagged PDF; plain Pandoc says \"image\" in the web page and Word. With the platform's preprocessor it is carried as alt={} (the web page and Word skip the image).",
        fixes: () => ["Nothing to do in the platform. For every converter: add alt={} beside it."] },
      "actualtext-alone": {
        message: (d) => "Checked without the preprocessor: actualtext={" + d.actualtext + "} reaches only a tagged PDF; plain Pandoc says \"image\" in the web page and Word. With the platform's preprocessor it is carried as alt={" + d.actualtext + "}.",
        fixes: (d) => ["Nothing to do in the platform. For every converter: alt={" + d.actualtext + "}."] },
      "artifact-not-carried": {
        message: () => "[artifact] (decoration) was not carried by the preprocessor here, so the web page and Word say \"image\".",
        fixes: () => ["Add alt={} beside it."] },
      "actualtext-not-carried": {
        message: (d) => "actualtext={" + d.actualtext + "} was not carried by the preprocessor here, so the web page and Word say \"image\".",
        fixes: (d) => ["Write alt={" + d.actualtext + "} as well."] },
    },
  },
  T1: {
    group: "tables", kind: "not-reaching-reader", level: "warning", label: "Table will be lost",
    need: "A table reaches the reader as a table.",
    why: "The PDF shows the table, but the web page and Word lose it, or show its source with & signs.",
    ways: TABLE_WAYS,
    variants: {
      box: {
        message: (d) => "Table will be lost: it sits inside \\" + d.box + ", and the web page and Word drop the whole table (the PDF shows it).",
        fixes: (d) => ["Remove the \\" + d.box + " around the table" + (d.box === "resizebox" || d.box === "scalebox" ? "; to make it narrower, use smaller column widths or \\small" : "") + ".",
                       "Or use the adjustbox environment, which keeps the table."] },
      env: {
        message: (d) => "Table will be lost: the web page and Word do not read a " + d.env + " as a table; it shows as text with & signs, and a cell is lost (the PDF shows it).",
        fixes: () => ["Write it as a tabular (or longtable)."] },
      S: {
        message: () => "Table will be lost: the siunitx S column makes the web page and Word show the table as text with & signs, and the first number is lost (the PDF shows it).",
        fixes: () => ["Use an ordinary column (r or c) instead of S."] },
    },
  },
  T2: {
    group: "tables", kind: "not-reaching-reader", level: "warning", label: "Cell text will be lost",
    need: "Every cell's text reaches the reader.",
    why: "The PDF shows every cell, but in the web page and Word some words or numbers are silently missing, or a row is split in the wrong place.",
    ways: TABLE_WAYS,
    variants: {
      makecell: {
        message: (d) => "Cell text will be lost: a line break \\\\ inside \\" + d.owner + " ends the row in the web page and Word; the cell's first line is lost and the rest moves to a new row.",
        fixes: () => ["For a two-line cell, use a small nested tabular: \\begin{tabular}{c}first\\\\second\\end{tabular}, or a p{..} column."] },
      dash: {
        message: (d) => "Cell text will be lost: after \\" + d.rule + " the web page and Word lose the next cell.",
        fixes: (d) => ["Use \\hline instead of \\" + d.rule + "."] },
      tagpdf: {
        message: () => "Cell text will be lost: \\tagpdfsetup before \\multirow makes the web page and Word lose the cell's text.",
        fixes: () => ["Keep the \\tagpdfsetup outside the table, or check the web page after converting."] },
      captionof: {
        message: () => "The table's caption will be lost: \\captionof{table} does not reach the web page or Word.",
        fixes: () => ["Put the table in a table environment and use \\caption."] },
    },
  },
  T3: {
    group: "tables", kind: "fix-by-hand", level: "warning", label: "No header row",
    need: "A data table has header cells, so a screen reader can say which column each value is in.",
    why: "Without header cells, every row is read as data and a screen reader user cannot ask which column a value belongs to.",
    ways: HEADER_WAYS,
    variants: {
      none: {
        message: () => "No header row: nothing marks row 1 as the table's headings, so the web page and Word have no header cells (nor has the PDF).",
        fixes: () => ["If row 1 holds the column headings: put \\hline (or \\midrule) right after it. The web page and Word then get header cells; with \\tagpdfsetup{table/header-rows=1} and tagging on, the PDF too.",
                      "If it is not a data table (a layout), nothing to do here."] },
      "ignored-rule": {
        message: (d) => "No header row: the rule after row 1 is \\" + d.rule + ", which looks the same in the PDF but which Pandoc ignores, so the web page and Word have no header cells.",
        fixes: (d) => ["Use \\hline (or \\midrule) instead of \\" + d.rule + " after the heading row."] },
      "tagged-header-rows": {
        message: () => "No header row in the web page and Word: the document declares table/header-rows for the tagged PDF, which Pandoc does not read; without a rule right after row 1 the web page and Word get no header cells.",
        fixes: () => ["Put \\hline (or \\midrule) right after the heading row as well: then every output has header cells."] },
      "author-command": {
        message: (d) => "No header row (checked without the preprocessor): row 1 is followed by \\" + d.command + ", an author command. If it draws a rule, the preprocessor writes it out as one and the web page and Word get a header row; plain Pandoc does not.",
        fixes: () => ["Nothing to do in the platform if the command draws \\hline. For every converter: write \\hline after the heading row."] },
      "good-platform": {
        level: "note",
        message: () => "Header row present: the web page and Word get header cells. The PDF from Overleaf gets them only with tagging on and table/header-rows declared.",
        fixes: () => ["Add \\DocumentMetadata{tagging=on} and \\tagpdfsetup{table/header-rows=1} so the PDF has header cells too."] },
    },
  },
  T4: {
    group: "tables", kind: "fix-by-hand", level: "warning", label: "Title used as the header",
    need: "A table's header cells are its column headings; its title is a caption.",
    why: "A title row across the table becomes the only heading in the web page and Word; the real column headings are read as data.",
    ways: HEADER_WAYS,
    variants: {
      title: {
        message: (d) => "Title used as the header: row 1 (\"" + d.title + "\") spans every column and is followed by a rule, so the web page and Word make it the table's only heading and read the real column headings as data.",
        fixes: () => ["Put the title in \\caption{..} (in a table environment) and the rule right after the column headings."] },
    },
  },
});

// The sentence added when a finding sits inside an author's command (with the
// preprocessor, the command is written out: Nicholas 2026-10-26, "marking a
// problem inside an author's command at both the call and the definition").
export function inCommand(name, role, other) {
  return role === "call"
    ? " This comes from the command " + name + " (its definition" + (other ? ", " + at(other) : "") + "): fix it there, and every use is fixed."
    : " This is inside the definition of " + name + ", so it shows wherever " + name + " is used.";
}
