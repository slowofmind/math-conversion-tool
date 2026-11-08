// v2/combined.mjs — session 277. One combined report: the preprocessor,
// Pandoc and the checker in one list (sessions/PLAN-COMBINED-REPORT-s275.md,
// signed off 2026-10-26: "I also sign off on the combined report plan"; the
// default order: "Position should be the default"; click to the line in the
// first platform version, main file first).
//
// Plain terms: three steps report on the same document, each in the shared
// entry shape (v2/findings.mjs): the preprocessor (runEntries), Pandoc's log
// (read here) and the checker (checkRun). This puts them in one list, ordered
// by place in the author's ORIGINAL files - the main file first, then the
// files in the order the document reads them, package files last - tells a
// problem two steps both report once, and says what the default view shows.
//
//   pandocRows(log, { output, error, stdin })    Pandoc's JSON log (--log, or the
//       platform's warnings: the same messages) -> rows { level, file, line,
//       column, type, message, contents, name, path, pandocLine,
//       pandocColumn } at places in the -pp text. Measured (s275, s277):
//       Pandoc places a skipped command just AFTER it, and a skipped
//       environment just after its \begin{..}; the row is moved back to where
//       the skipped text starts. Pandoc counts a tab to the next stop of 4;
//       the row's column counts characters. Pandoc names a subfolder's file
//       with "/"; the row uses the run's own name for it. When Pandoc stops
//       there is no log, only its error text (stderr): give it as `error`.
//   pandocEntries(rows, run, originals)   rows -> entries in the ORIGINAL files
//   unreadParts(run, originals)           the parts of files the run reported
//       on that the document itself does not read (call 2, s281):
//       [{ file, from, line, why }], from the character offset `from` on
//   openingsOf(run, originals)            where each file is opened, in the
//       original files (s286): [{ file, line, column, target }]
//   packageUsesOf(run, originals)         the commands and environments the
//       local .sty/.cls files define, and where the author's files use them
//       (s287): { definitions: [{ file, name, from, to }], uses: [{ file, line,
//       column, name, via }] }; `via` is the package command the author wrote
//       when `name` is reached only through it
//   combineEntries({ preprocessor, pandoc, checker }, { main, order, show, unread, opens, packages, arrange })
//       -> { entries, again, uses, sections, counts, told, options }, plain data (JSON).
//       Since s286 the order is "nested" by default (down the main file, each
//       file's entries where it is opened); "flat" is the order before it.
//       Since s287 a package file's set-up entries sit at the line that loads
//       it, and those inside a command's definition at each use (`uses`).
//       Any list may be missing: each step also runs alone.
//       Since s291 (PLAN-REPORT-ORDER-s284 step 7) each category sits in one
//       level, Fix this / Check / Everything (LEVELS, SORTING, CATEGORIES); the
//       option `level` sets the ticks (showFor), options.level says which level
//       the ticks are or "Custom" (levelOf), counts.levels the count line.
//   marks(combined, show)                 the places to highlight: shown entries only
//   positionLines(combined, show)         the default view's lines: three or
//       more of the same message in a row fold into one line
//   renderCombined(combined, { view: "position" | "kind", show })  plain text
//
// Each entry keeps every field it had; the combine step only ADDS:
//   id          stable within a run: "p<n>", "c<n>", "d<n>" (preprocessor,
//               checker, Pandoc; n its index in the list given)
//   category    the settings panel's category (CATEGORIES)
//   section     the by-kind layout's section (SECTIONS)
//   shown       in the default view (its category is on)
//   reportLevel the level its category sits in (s291); null for the checker's
//   fold        the key it folds under in the by-kind layout
//   also        the other steps' entries telling the same problem (PAIRS)
//   opens       "main": clicking it opens the main file at its line and marks
//               its range (the first platform version); "file": listed with
//               its file and line (a subfile or package file, later); null:
//               no place
//   need        for a drawing inside an author's command: what the reader
//               loses (call 4 A); else null
//   calls       for a checker definition entry: the ids of its calls; else null
//   definition  for a checker call entry: the id of its definition; else null
//   categoryIfRead  for an entry in a part the document does not read (category
//               "unread"): the category it would have had; else absent
//   inDefinition  for an entry inside a command's definition in a package file
//               (s287): { name, file, line, used }; else null
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).
import { pandocEntry, BOX_LABEL } from "./findings.mjs";
import { buildSourceMap } from "./source-map.mjs";
import { tokenize, profileFor } from "./tokenizer.mjs";
import { readGroup } from "./structure.mjs";
import { groupText, readDefinition } from "./definition.mjs";

// The report's levels (PLAN-REPORT-ORDER-s284 step 7, s291; his sorting A, DECISIONS 2026-10-31): the default view
// shows "Fix this"; "Check" adds what may matter; "Everything" the rest. A level ticks its own categories and those of
// the levels before it; a tick by hand makes the level read "Custom" (levelOf).
export const LEVELS = Object.freeze(["Fix this", "Check", "Everything"]);
const FIX = "Fix this", CHECK = "Check", ALL = "Everything";
// The settings panel's categories (tick boxes), each in exactly one level, in the levels' order. `on`: in the default
// view. The checker's two (level null) keep today's ticks, outside the levels, until the checker work (plan step 7).
// The placements marked * in the plan's table are the tool's reading, for his look with step 8's counts.
export const CATEGORIES = Object.freeze([
  // ---- Fix this ----
  // s289 (step 5, v2/unknown-calls.mjs): Pandoc drops the command, often with its words
  ["unknown", "Commands nobody understands", FIX, "a command in your running text that no file the document reads, no package and not Pandoc defines: Pandoc drops it"],
  ["drawing", "Drawings and boxes not carried", FIX, "a drawing or a box inside one of your commands: no description or frame reaches the reader"],
  ["rejected", "Definitions that make Pandoc reject the document", FIX, "\\global\\long ...: fixed in the -pp copy only; fix your file so every converter reads it"],   // *
  // s280 (plan section 8, his call 5 "A: six groups"): Pandoc's three levels, then its INFO lines by kind
  // (sessions/PANDOC-KINDS-s280.md); a kind is shown only while "pandoc-info", its parent, is on too
  ["pandoc-stop", "Pandoc: stopped", FIX, "Pandoc gave up on the document; nothing after this place was converted"],
  ["pandoc-missing", "Pandoc: a needed file not found", FIX, "a file the document reads (\\input, \\include ...) Pandoc could not find: its text is missing"],   // *
  ["unplaced", "Not recognised", FIX, "an entry of a kind the report does not know (never hidden by a level)"],
  // ---- Check ----
  ["unsettled", "Versions the tool could not settle", CHECK, "a conditional the tool could not decide: the output may show the other version than the print"],
  ["dropped", "LaTeX commands Pandoc drops", CHECK, "\\maketitle ...: LaTeX's own commands Pandoc does not carry (spacing and layout are under Everything)"],
  ["latex", "Problems in your LaTeX", CHECK, "defined twice, closed in the wrong order, redefined before it is defined ..."],   // * (until the checker work)
  ["unknown-env", "Environments Pandoc does not know", CHECK, "the words are kept, the look is lost"],   // *
  ["lists", "List markers and numbers not carried", CHECK, "a list's numbers or marker style that will differ from the print"],   // *
  ["left-alone", "Commands the tool left alone", CHECK, "a command of yours the tool could not write out for Pandoc"],   // *
  ["definitions", "Definitions Pandoc cannot read", CHECK, "a definition Pandoc does not take in: its calls may come out wrong"],   // *
  ["not-reaching", "Other things that will not reach the reader", CHECK, "languages, table headers, package options ..."],
  ["a11y-fix", "Accessibility fixes made for you", CHECK, "the preprocessor improved the output; fix your file to keep it in the PDF too"],   // *
  ["pandoc-warning", "Pandoc: warnings", CHECK, "a command defined twice ..."],   // *
  ["pandoc-info", "Pandoc: information", CHECK, "Pandoc's INFO lines, by the kinds below"],
  ["pandoc-other", "Other skipped commands", CHECK, "unknown environments, boxes, exam and slide commands ...: where words can go missing", "pandoc-info"],   // *
  // ---- Everything ----
  ["pandoc-packages", "Packages", ALL, "package files Pandoc read, packages it does not load, package set-up: usually noise", "pandoc-info"],
  ["pandoc-spacing", "Spacing and page layout", ALL, "\\vspace, \\hspace, \\newpage, \\noindent, margins ... (also the preprocessor's \"dropped by Pandoc\" for them)", "pandoc-info"],
  ["pandoc-fonts", "Fonts and colour", ALL, "\\selectfont, \\large, \\color ...", "pandoc-info"],
  ["pandoc-programming", "TeX programming", ALL, "definitions, counters, grouping", "pandoc-info"],
  ["pandoc-drawings", "Drawings", ALL, "TikZ and PGF pictures (the drawing entries say what the reader loses)", "pandoc-info"],
  // s290 (step 6): \renewcommand of a name LaTeX, the class or a loaded package defines (also the files' own counters'
  // \theX and internal @ names: the tool's reading)
  ["renew-known", "Redefining LaTeX's, the class's or a package's own commands", ALL, "\\renewcommand of a name defined outside your files: fine"],
  // s287 (PLAN-REPORT-ORDER-s284 step 3): was "In package files (.sty / .cls)"; a message inside a package command's
  // definition shows at each use of the command, under its own kind's tick. s291: a conditional not settled is Check
  ["package-setup", "Package set-up messages", ALL, "messages from a package file outside its commands, at the line that loads it: the same in every document that loads it"],
  ["conversion", "Changed so Pandoc can read it", ALL, "invisible fixes in the -pp copy; for testing and troubleshooting"],
  ["note", "Notes", ALL, "things the preprocessor did that you may want to know"],
  // s281, call 2 (DECISIONS 2026-10-27): kept, hidden by default, one count line; they show when that file is converted
  ["unread", "Parts of other files this document does not read", ALL, "a worksheet converted on its own reads the book's preamble, not the rest of the book's main file"],
  // s287: DECISIONS 2026-10-31 ("Yes, same shape"): a command the document never uses brings no line; kept, hidden
  ["unused", "Commands of package files this document never uses", ALL, "messages inside the definition of a package command this document never calls"],
  // ---- the checker's (outside the levels) ----
  ["a11y", "Accessibility problems", null, "the checker: what will hurt a reader of the web page or Word file", null, true],
  ["encourage", "Encouragement (tagged PDF)", null, "good for the web page and Word; a note on what would also reach the PDF", null, false],
].map(([key, label, level, why, parent = null, on = level === FIX]) => Object.freeze({ key, label, level, on, why, parent })));
const CATEGORY = new Map(CATEGORIES.map((c) => [c.key, c]));
// an entry is shown when its category is on, and its category's parent too (a Pandoc INFO kind under "information")
const isOn = (e, show) => { const c = CATEGORY.get(e.category); return show.has(e.category) && (!c || !c.parent || e.source !== "pandoc" || show.has(c.parent)); };
// showFor(level) -> the ticks a level sets: its categories and those of the levels before it, with the checker's as today
export function showFor(level) {
  const n = LEVELS.indexOf(level);
  if (n < 0) throw new Error("no such level: " + level);
  return CATEGORIES.filter((c) => (c.level === null ? c.on : LEVELS.indexOf(c.level) <= n)).map((c) => c.key);
}
// levelOf(show) -> the level these ticks are, or "Custom" (the checker's ticks do not count)
export function levelOf(show) {
  const s = [...new Set(show)].filter((k) => CATEGORY.has(k) && CATEGORY.get(k).level !== null).sort().join(",");
  return LEVELS.find((lv) => showFor(lv).filter((k) => CATEGORY.get(k).level !== null).sort().join(",") === s) || "Custom";
}
const DEFAULT_SHOW = showFor(FIX);

// The by-kind layout (plan 3.2), a second order the data carries.
export const SECTIONS = Object.freeze([
  ["accessibility", "Accessibility", false],
  ["not-reaching", "Will not reach the reader", false],
  ["latex", "Problems in your LaTeX, and Pandoc's messages", false],
  ["package", "In package files", true],
  ["conversion", "Changed so Pandoc can read it", false],
  ["unread", "Parts of other files this document does not read", false],
  ["unplaced", "Not recognised", false],
].map(([key, title, folded]) => Object.freeze({ key, title, folded })));

const isPackage = (f) => /\.(sty|cls)$/i.test(f || "");

// The kind of a Pandoc INFO line (s280; the groups measured in _work/_s280_groups.mjs, whose rules these are).
// The command's NAME decides, and the file the line comes from; a name on no list is "other", so it shows.
const names = (s) => new Set(s.trim().split(/\s+/));
const KIND_PACKAGES = names(`\\RequirePackage \\ProvidesPackage \\ProvidesFile \\ProvidesClass \\NeedsTeXFormat \\DeclareOption
  \\ProcessOptions \\ExecuteOptions \\PassOptionsToPackage \\usetikzlibrary \\usepgfplotslibrary \\tcbuselibrary \\usetheme
  \\usecolortheme \\usefonttheme \\useinnertheme \\useoutertheme \\sisetup \\hypersetup \\geometry \\setlist \\setenumerate
  \\setitemize \\setdescription \\captionsetup \\pgfplotsset \\titleformat \\titlespacing \\titlespacing* \\DeclareSIUnit
  \\AtBeginDocument \\AtEndDocument \\externaldocument \\lstset \\mdfsetup \\tcbset \\setbeamertemplate \\setbeamercolor
  \\setbeamerfont \\SetSymbolFont \\DeclareMicrotypeAlias \\renewfontfamily \\setmainfont \\setsansfont \\setmonofont
  \\setCJKfamilyfont \\checkandfixthelayout \\settrimmedsize \\settypeblocksize \\setulmargins \\setlrmargins \\setheadfoot
  \\setheaderspaces \\makechapterstyle \\chapterstyle \\setsecheadstyle \\makepsmarks \\makepagestyle \\makeevenfoot
  \\makeoddfoot \\makeevenhead \\makeoddhead \\ifSubfilesClassLoaded \\convertcolorsUfalse \\documentclass`);
const KIND_SPACING = names(`\\vspace \\vspace* \\hspace \\hspace* \\vfill \\hfill \\vskip \\hskip \\medskip \\smallskip \\bigskip
  \\newpage \\clearpage \\cleardoublepage \\pagebreak \\linebreak \\nopagebreak \\nolinebreak \\noindent \\indent \\centering
  \\raggedright \\raggedleft \\justifying \\quad \\qquad \\; \\! \\: \\, \\enspace \\thinspace \\pagestyle \\thispagestyle
  \\pagenumbering \\textwidth \\linewidth \\textheight \\columnwidth \\paperwidth \\paperheight \\oddsidemargin
  \\evensidemargin \\topmargin \\voffset \\hoffset \\headheight \\headsep \\footskip \\marginparwidth \\parskip \\parindent
  \\itemsep \\topsep \\baselineskip \\baselinestretch \\linespread \\lhead \\chead \\rhead \\lfoot \\cfoot \\rfoot \\fancyhead
  \\fancyfoot \\fancyhf \\null \\FloatBarrier \\nobreak \\unskip \\hrulefill \\dotfill \\filbreak \\interfootnotelinepenalty
  \\enlargethispage \\strut \\addvspace \\goodbreak \\allowbreak \\par \\newline`);
const KIND_FONTS = names(`\\selectfont \\usefont \\fontshape \\fontseries \\fontfamily \\fontsize \\tiny \\scriptsize \\footnotesize
  \\small \\normalsize \\large \\Large \\LARGE \\huge \\Huge \\normalfont \\rmfamily \\sffamily \\ttfamily \\bfseries \\mdseries
  \\itshape \\upshape \\slshape \\scshape \\boldmath \\unboldmath \\color \\colorlet \\definecolor \\textocolor \\rowcolor
  \\cellcolor \\pagecolor \\sethlcolor \\rowcolors`);
const KIND_PROGRAMMING = names(`\\def \\edef \\gdef \\xdef \\long \\let \\global \\makeatletter \\makeatother \\bgroup \\egroup
  \\begingroup \\endgroup \\relax \\fi \\else \\setcounter \\addtocounter \\stepcounter \\refstepcounter \\advance \\numexpr
  \\dimexpr \\setboolean \\ifbool \\settowidth \\settoheight \\setlength \\addtolength \\expandafter \\noexpand \\protect
  \\csname \\endcsname \\undefined \\StrBefore \\StrBehind \\arabic \\roman \\alph \\Alph \\Roman \\value \\NewEnviron
  \\NewDocumentCommand \\NewDocumentEnvironment \\RenewDocumentCommand \\ProvideDocumentCommand \\tcolorboxenvironment
  \\setcounterpageref \\setcountertoreftemp \\MakeFramed \\endMakeFramed \\cornersize \\framemargin \\aftergroup
  \\afterassignment \\ignorespaces`);
const KIND_DRAWINGS = names(`\\draw \\node \\coordinate \\fill \\path \\filldraw \\clip \\shade \\shadedraw \\foreach \\pic \\chemmove`);
const DRAWING_ENVS = new Set(["tikzpicture", "circuitikz", "tikzangle", "pspicture", "axis", "scope"]);
// pandocKind({ type, contents, path, file }) -> "packages" | "spacing" | "fonts" | "programming" | "drawings" | "other"
export function pandocKind(m) {
  if (isPackage(m.file)) return "packages";
  if (m.type === "CouldNotLoadIncludeFile") return isPackage(m.path) ? "packages" : "other";
  if (m.type !== "SkippedContent") return "other";
  const c = String(m.contents || "");
  const env = /^\\begin\{([^}]*)\}/.exec(c);
  if (env) return DRAWING_ENVS.has(env[1]) ? "drawings" : "other";
  const w = /^\\([A-Za-z@]+\*?|.)/.exec(c);
  if (!w) return "other";
  const name = "\\" + w[1];
  if (KIND_PACKAGES.has(name)) return "packages";
  if (KIND_SPACING.has(name)) return "spacing";
  if (KIND_FONTS.has(name)) return "fonts";
  if (KIND_PROGRAMMING.has(name) || name.includes("@") || /^\\(if|new|renew|provide|Declare)/.test(name)) return "programming";
  if (KIND_DRAWINGS.has(name) || /^\\(pgf|tikz|tz)/.test(name)) return "drawings";
  return "other";
}

// The level table's first half (s291, plan step 7): an entry's rule and its conditions -> its category; the category
// gives the level (CATEGORIES). The first row that holds wins. o.inDefinition: the entry sits inside a package
// command's definition and is told at its uses, so it takes its own kind's category, not "package-setup".
const N = "not-reaching-reader";
const rule = (...rules) => (e) => rules.includes(e.rule);
const pandocLevel = (lv) => (e) => e.source === "pandoc" && e.level === lv;
const SORTING = Object.freeze([
  // Pandoc's messages: by level, and its INFO lines by kind (the six groups)
  ["pandoc-stop", pandocLevel("error")],
  ["pandoc-missing", (e) => pandocLevel("warning")(e) && (e.pandoc || {}).type === "CouldNotLoadIncludeFile" && !isPackage((e.pandoc || {}).path)],
  ["pandoc-warning", pandocLevel("warning")],
  [(e) => "pandoc-" + pandocKind({ type: (e.pandoc || {}).type, contents: (e.pandoc || {}).contents, path: (e.pandoc || {}).path,
    file: e.where && e.where.ppFile }), (e) => e.source === "pandoc"],
  // his call 5: the spacing tick takes the preprocessor's "dropped by Pandoc" spacing lines with it
  ["pandoc-spacing", (e) => e.rule === "pandoc-drops/name" && e.visible && KIND_SPACING.has(commandOf(e.message))],
  ["unplaced", (e) => e.kind === null],
  ["conversion", (e) => !e.visible],
  // a package file's set-up (outside its commands): at the line that loads it; a version not settled stays Check there
  ["unsettled", (e, o) => isPackage(e.where && e.where.file) && !o.inDefinition && rule("ifthen/unknown", "ifthen/unknown-parameter")(e)],
  ["package-setup", (e, o) => isPackage(e.where && e.where.file) && !o.inDefinition],
  ["encourage", (e) => e.source === "checker" && e.rank === 2 && e.level === "note"],
  ["a11y", (e) => e.source === "checker"],
  ["a11y-fix", (e) => e.kind === "accessibility-fix"],
  // every \ppflag: a drawing or box not carried (flag/left, tagged, inside, expanded, site-left); tagged sites are notes
  ["note", (e) => String(e.rule).startsWith("flag/") && e.level === "note"],
  ["drawing", (e) => String(e.rule).startsWith("flag/")],
  ["note", (e) => e.level === "note"],
  ["unknown", rule("unknown/command-dropped", "unknown/command-content-lost")],
  ["unknown-env", rule("unknown/environment-wrapped")],
  ["rejected", rule("definition/global-prefix-rejected")],
  // s290 (step 6) sorted it: LaTeX's, the class's or a package's own name; a real slip stays "latex"
  ["renew-known", (e) => e.rule === "store/renew-undefined" && !!e.detail && e.detail.level === ALL],
  ["unsettled", rule("ifthen/unknown", "ifthen/unknown-parameter")],
  ["dropped", rule("pandoc-drops/name")],
  ["lists", (e) => e.rule === "pandoc-drops/item-marker" || (String(e.rule).startsWith("lists/") && e.kind === N)],
  ["left-alone", (e) => String(e.rule).startsWith("expand/refused-")],
  ["definitions", (e) => String(e.rule).startsWith("definition/") && e.kind === N],
  ["not-reaching", (e) => e.kind === N],
  ["latex", () => true],
]);
// categoryOf(entry, { inDefinition }) -> a CATEGORIES key
export function categoryOf(e, opts = {}) {
  for (const [category, when] of SORTING) if (when(e, opts)) return typeof category === "function" ? category(e) : category;
  return "latex";
}
const SECTION_OF = { a11y: "accessibility", "a11y-fix": "accessibility", drawing: "accessibility", encourage: "accessibility",
  "not-reaching": "not-reaching", unknown: "not-reaching", "unknown-env": "not-reaching", unsettled: "not-reaching", dropped: "not-reaching",
  lists: "not-reaching", "left-alone": "not-reaching", definitions: "not-reaching",
  latex: "latex", rejected: "latex", "renew-known": "latex", "pandoc-stop": "latex", "pandoc-missing": "latex", "pandoc-warning": "latex", "pandoc-info": "latex",
  "pandoc-packages": "latex", "pandoc-spacing": "latex", "pandoc-fonts": "latex", "pandoc-programming": "latex", "pandoc-drawings": "latex",
  "pandoc-other": "latex", "package-setup": "package", unused: "package", conversion: "conversion", unread: "unread", unplaced: "unplaced" };
// a note stays in its own kind's section (plan 3.3), after the warnings
const NOTE_SECTION = { "accessibility-fix": "accessibility", "not-reaching-reader": "not-reaching", "fix-by-hand": "latex" };
function sectionOf(e, category) {
  if (category === "pandoc-spacing" && e.source !== "pandoc") return "not-reaching";   // the preprocessor's "dropped by Pandoc"
  if (category !== "note") return SECTION_OF[category];
  if (String(e.rule).startsWith("flag/")) return "accessibility";
  return NOTE_SECTION[e.kind] || "latex";
}

// What a reader loses when a drawing sits inside an author's command (call 4 A):
// the checker cannot see it, so flagging's entry is the only report of it.
const DRAWING_NEED = "No description of this drawing reaches the web page or Word. Best for every output: save the drawing as an "
  + "image file and include it with \\includegraphics[alt={...}].";
// s278: a box frames words and draws nothing (_work/_s278-boxes.txt); the line above says whether its words reach Pandoc
const BOX_NEED = "This is a box, not a drawing: its frame does not reach the web page or Word; the line above says whether its "
  + "words do. If the box itself means something to the reader (a space for an answer, a word singled out), say that in words too.";

// The pairing table (plan 3.4): two rules telling the SAME need. When both are
// present at the same original place, `keep` stays and the other goes in its
// `also`. A row joins only with a case that shows both firing (v2/test/combined.mjs).
const samePlace = (a, b) => a.where.file === b.where.file && a.where.line === b.where.line && a.where.column === b.where.column;
// the text Pandoc skipped begins with this command name (and not a longer one: \hspace, not \hspacex)
const sameCommand = (contents, cmd) => !!cmd && contents.startsWith(cmd) && !/^[A-Za-z@]/.test(contents.slice(cmd.length));
// the command a message is about, for the by-kind folds ("\vspace dropped by Pandoc")
const commandOf = (message) => { const m = /\\begin\{[^}]*\}|\\[A-Za-z@]+\*?/.exec(message || ""); return m ? m[0] : ""; };
export const PAIRS = Object.freeze([
  // call 3 A: the checker's carries the need, the ways and the hierarchy
  { name: "drawing-alt", keep: "a11y/I3", other: "tagged/drawing-alt", match: samePlace },
  // hidden anyway (INFO); paired so switching Pandoc's detail on does not double the list. The same command too:
  // inside a written-out call every line is placed at the call (s277, fpractice1's \instructions)
  { name: "skipped", keep: "pandoc-drops/name", other: "pandoc/SkippedContent",
    match: (k, o) => samePlace(k, o) && !!(o.pandoc && o.pandoc.contents) && sameCommand(o.pandoc.contents, commandOf(k.message)) },
  // s289: a command nobody understands (v2/unknown-calls.mjs) and Pandoc's skipped line for it; for an environment
  // the line Pandoc gives its \begin{..} (v2/test/unknown-calls.mjs U-h)
  ...["unknown/command-content-lost", "unknown/command-dropped", "unknown/environment-wrapped"].map((keep) => ({
    name: "unknown-skipped", keep, other: "pandoc/SkippedContent",
    match: (k, o) => samePlace(k, o) && !!(o.pandoc && o.pandoc.contents) && sameCommand(o.pandoc.contents, commandOf(k.message)) })),
  // the same name on the same line; otherwise Pandoc's stands
  { name: "defined-twice", keep: "store/already-defined", other: "pandoc/MacroAlreadyDefined",
    match: (k, o) => k.where.file === o.where.file && k.where.line === o.where.line && !!(o.pandoc && o.pandoc.name)
      && k.message.startsWith(o.pandoc.name + " ") },
].map(Object.freeze));

// ---- Pandoc's log ----
function lineStarts(text) {
  const s = [0];
  for (let j = 0; j < text.length; j++) if (text.charCodeAt(j) === 10) s.push(j + 1);
  return s;
}
function lineColumn(starts, off) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
  return { line: lo + 1, column: off - starts[lo] + 1 };
}
// Pandoc's column (a tab to the next stop of 4) -> the character's offset in the text
function offsetOf(text, starts, line, pcol) {
  const a = starts[line - 1], b = line < starts.length ? starts[line] - 1 : text.length;
  let vis = 1, i = a;
  while (i < b && vis < pcol) { vis = text.charCodeAt(i) === 9 ? vis + 4 - ((vis - 1) % 4) : vis + 1; i++; }
  return i + Math.max(0, pcol - vis);
}
const PANDOC_LEVELS = { INFO: "info", WARNING: "warning", ERROR: "error" };

// pandocRows(log, { output, error, stdin }) -> rows; log: the parsed JSON log, its text, or null.
// stdin: the -pp file Pandoc was given as unnamed input (the platform does this with the main file, s278):
// Pandoc then names it "" in the log and names no file in its error text.
export function pandocRows(log, options = {}) {
  const output = options.output instanceof Map ? options.output : new Map(Object.entries(options.output || {}));
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");
  const names = new Map([...output.keys()].map((k) => [norm(k), k]));
  const nameOf = (p) => (p == null ? null : p === "" && options.stdin != null ? options.stdin : names.get(norm(p)) ?? p);
  const starts = new Map(), ls = (f) => { if (!starts.has(f)) starts.set(f, lineStarts(output.get(f))); return starts.get(f); };
  // a place in a file the run wrote: Pandoc's line and column -> the character's, and its offset
  const placeIn = (file, line, pcol) => {
    if (!output.has(file) || !Number.isInteger(line) || !Number.isInteger(pcol) || line < 1 || line > ls(file).length) return null;
    return offsetOf(output.get(file), ls(file), line, pcol);
  };
  const messages = typeof log === "string" ? JSON.parse(log) : Array.isArray(log) ? log : [];
  const rows = [];
  for (const m of messages) {
    const file = nameOf(m.source);
    let line = m.line ?? null, column = m.column ?? null;
    const contents = typeof m.contents === "string" ? m.contents : null;
    let off = placeIn(file, line, column);
    if (off !== null && contents) {
      // the skipped text starts at or before Pandoc's place and reaches it
      const t = output.get(file);
      for (let s = off; s >= Math.max(0, off - contents.length); s--) if (t.startsWith(contents, s)) { off = s; break; }
    }
    if (off !== null) ({ line, column } = lineColumn(ls(file), off));
    rows.push({ level: PANDOC_LEVELS[m.verbosity] || String(m.verbosity || "").toLowerCase(), file, line, column, type: m.type ?? null,
                message: String(m.pretty ?? m.type ?? "").replace(/ at (\S.* )?line \d+ column \d+\s*$/, ""),
                contents, name: m.name ?? null, path: m.path ?? null, pandocLine: m.line ?? null, pandocColumn: m.column ?? null });
  }
  if (options.error) {
    // Pandoc stopped: its error text, one row, at the place it names
    const lines = String(options.error).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "^" && !/^\[(INFO|WARNING)\]/.test(l));
    if (lines.length) {
      // "Error at "doc.tex" (line 6, column 2):", or for unnamed input "Error at (line 6, column 2):"
      const at = /^Error at (?:"([^"]*)" )?\(line (\d+), column (\d+)\)/.exec(lines[0]);
      const file = at ? nameOf(at[1] ?? "") : null, pl = at ? Number(at[2]) : null, pc = at ? Number(at[3]) : null;
      const off = at ? placeIn(file, pl, pc) : null;
      const lc = off !== null ? lineColumn(ls(file), off) : { line: pl, column: pc };
      rows.push({ level: "error", file, line: lc.line, column: lc.column, type: "PandocError",
                  message: lines[0] + (lines.length > 1 ? " " + lines.slice(1).join("; ") : ""),
                  contents: null, name: null, path: null, pandocLine: pl, pandocColumn: pc });
    }
  }
  return rows;
}

const PANDOC_LABELS = { SkippedContent: "skipped by Pandoc", CouldNotLoadIncludeFile: "package or file not loaded",
  MacroAlreadyDefined: "command defined twice", PandocError: "Pandoc stopped" };

// pandocEntries(rows, run, originals) -> entries placed in the ORIGINAL files
export function pandocEntries(rows, run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const sm = buildSourceMap(run, orig);
  return rows.map((r) => {
    const e = pandocEntry({ level: r.level, file: r.file, line: r.line, column: r.column, message: r.message, type: "pandoc/" + (r.type || r.level) }, sm);
    e.label = PANDOC_LABELS[r.type] || e.label;
    e.pandoc = { type: r.type, name: r.name, contents: r.contents, path: r.path, line: r.pandocLine, column: r.pandocColumn };
    return e;
  });
}

// ---- parts of files the document does not read (call 2, s281; measured in _work/_s278-unread*.txt) ----
// A subfile converted on its own reads only its parent's PREAMBLE, and only when the run copied it in (run.splice);
// the parent's body is never read (the reader stops at its \begin{document}). So what this document does not read:
//   why "body"            the parent from its \begin{document} on, when the preamble was copied in (Math Ma ws2-3)
//   why "parent"          the whole parent, when nothing was copied (000-only-latex: a main.tex with no \begin{document})
//   why "through-parent"  then also every file only the parent opened (reader.openedBy; worksheet01_2024.tex)
// \begin{document} is found by tokens in the ORIGINAL parent, as run.mjs spliceAt finds it in the -pp text.
function beginDocumentAt(text, file) {
  const t = tokenize(text, { profile: profileFor(file), file }).tokens;
  for (let i = 0; i < t.length; i++) {
    if (t[i].kind !== "ControlWord" || t[i].name !== "begin") continue;
    const g = readGroup(t, i + 1);
    if (g && groupText(t, g).trim() === "document") return t[i].start;
  }
  return -1;
}
export function unreadParts(run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const sp = run && run.subfileParent, reader = run && run.reader;
  if (!sp || !sp.parent || !reader || reader.mode !== "subfile-alone" || !orig.has(sp.parent)) return [];
  const parent = sp.parent;
  if (sp.spliced) {
    const text = orig.get(parent), from = beginDocumentAt(text, parent);
    if (from < 0) return [];                       // not found: nothing is hidden when unsure
    return [{ file: parent, from, line: text.slice(0, from).split("\n").length, why: "body" }];
  }
  const by = reader.openedBy || {};
  const throughParent = (f) => {
    for (let o = by[f], seen = new Set(); o != null && !seen.has(o); seen.add(o), o = by[o]) if (o === parent) return true;
    return false;
  };
  return [{ file: parent, from: 0, line: 1, why: "parent" },
    ...(reader.chain || []).filter((f) => f !== parent && f !== run.entry && orig.has(f) && throughParent(f))
      .map((file) => ({ file, from: 0, line: 1, why: "through-parent" }))];
}
// the unread part an entry's ORIGINAL place lies in, or null
function unreadPartOf(e, parts) {
  const w = e.where;
  if (!w || !w.file) return null;
  return parts.find((u) => u.file === w.file
    && (u.from === 0 || (w.start != null ? w.start >= u.from : w.line != null && w.line >= u.line))) || null;
}

// ---- where each file is opened (s286, PLAN-REPORT-ORDER-s284 step 2) ----
// openingsOf(run, originals) -> [{ file, line, column, target }]: each reader row that opens a file (its `target` and
// `at`, s285), placed in the author's ORIGINAL file. The reader reads the written-out text (run.mjs), so `at` is moved
// back through the expander's edits; a command inside a written-out call is placed at the call.
function backWritten(edits, q) {
  let shift = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    const a = e.start + shift, len = e.text.length;
    if (q < a) break;
    if (q < a + len) return e.start;
    shift += len - (e.end - e.start);
  }
  return q - shift;
}
export function openingsOf(run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const reader = run && run.reader;
  if (!reader) return [];
  const xedits = run.expansion && run.expansion.changed ? run.expansion.edits : new Map();
  return reader.record.filter((r) => r.target != null && Number.isInteger(r.at) && orig.has(r.file)).map((r) => {
    const at = backWritten(xedits.get(r.file) || [], r.at), before = orig.get(r.file).slice(0, at);
    return { file: r.file, line: before.split("\n").length, column: at - before.lastIndexOf("\n"), target: r.target };
  });
}

// ---- package commands and their uses (s287, PLAN-REPORT-ORDER-s284 step 3) ----
// packageUsesOf(run, originals) -> { definitions, uses }, from the ORIGINAL files the run read, by tokens:
//   definitions  [{ file, name, from: { line, column }, to: { line, column } }]: each command or environment a local
//                .sty/.cls defines (readDefinition), the whole statement; name "\answer" or "\begin{sol}"
//   uses         [{ file, line, column, name, via }]: each place in the author's own files (not .sty/.cls) that calls a
//                package command or opens a package environment; for a command reached only through another package
//                command's definition (\problem calls \pspace), one more use with name "\pspace" and via "\problem"
// The name an author's own definition gives (\renewcommand{\answer}) is not a use.
const keyAt = (t, i) => {
  const k = t[i];
  if (k.kind === "ControlSymbol") return k.text;
  if (k.kind !== "ControlWord") return null;
  if (k.name !== "begin") return "\\" + k.name;
  const g = readGroup(t, i + 1);
  return g ? "\\begin{" + groupText(t, g).trim() + "}" : null;
};
export function packageUsesOf(run, originals) {
  const orig = originals instanceof Map ? originals : new Map(Object.entries(originals || {}));
  const read = ((run && run.reader && run.reader.chain) || [...orig.keys()]).filter((f) => orig.has(f));
  const tokensOf = (f) => tokenize(orig.get(f), { profile: profileFor(f), file: f }).tokens;
  const definitions = [], calls = new Map();
  for (const file of read.filter(isPackage)) {
    const starts = lineStarts(orig.get(file)), t = tokensOf(file);
    for (let i = 0; i < t.length; i++) {
      const d = readDefinition(t, i);
      if (!d) continue;
      if (d.def && d.def.name && (d.def.kind === "macro" || d.def.kind === "environment")) {
        const name = d.def.kind === "environment" ? "\\begin{" + d.def.name + "}" : "\\" + d.def.name;
        definitions.push({ file, name, from: lineColumn(starts, t[d.open].start), to: lineColumn(starts, t[d.close].end - 1) });
        if (!calls.has(name)) calls.set(name, new Set());
        for (let j = d.open; j <= d.close; j++) { const k = keyAt(t, j); if (k && k !== name) calls.get(name).add(k); }
      }
      i = Math.max(i, d.close);   // a definition inside this one belongs to it
    }
  }
  const defined = new Set(definitions.map((d) => d.name));
  // the package commands a call of `name` reaches: itself, then those its definition calls, in turn
  const reach = (name) => {
    const seen = [name];
    for (let n = 0; n < seen.length; n++) for (const c of calls.get(seen[n]) || []) if (defined.has(c) && !seen.includes(c)) seen.push(c);
    return seen;
  };
  const uses = [];
  for (const file of read.filter((f) => !isPackage(f))) {
    const starts = lineStarts(orig.get(file)), t = tokensOf(file), naming = new Set();
    for (let i = 0; i < t.length; i++) {
      const d = readDefinition(t, i);
      if (d && d.def && d.def.name) {
        for (let j = i + 1; j <= d.close; j++) if (keyAt(t, j) === "\\" + d.def.name) { naming.add(j); break; }
      }
      if (naming.has(i)) continue;
      const k = keyAt(t, i);
      if (!k || !defined.has(k)) continue;
      const { line, column } = lineColumn(starts, t[i].start);
      for (const name of reach(k)) uses.push({ file, line, column, name, via: name === k ? null : k });
    }
  }
  return { definitions, uses };
}
// the package definition an entry's place lies in, or null
const notAfter = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
function definitionOf(e, definitions) {
  const w = e.where;
  if (!w || !isPackage(w.file) || w.line == null) return null;
  const at = { line: w.line, column: w.column ?? 1 };
  return definitions.find((d) => d.file === w.file && notAfter(d.from, at) && notAfter(at, d.to)) || null;
}

// ---- one list ----

// combineEntries({ preprocessor, pandoc, checker }, { main, order, show })
//   main   the file the author opened (click to the line works there first)
//   order  the files in the order the document reads them (checkRun's `files`)
//   show   the categories switched on (default: CATEGORIES' `on`)
//   unread the parts the document does not read (unreadParts): their entries go to the "unread" category
//   opens  where each file is opened (openingsOf), for the nested order
//   packages the package commands and their uses (packageUsesOf); without it every entry in a package file is set-up
//   arrange "nested" (default, s286) or "flat" (by file in `order`, package files last, then line and column)
//   level  s291: "Fix this" (default), "Check" or "Everything": the ticks it sets (showFor), when `show` is not given
export function combineEntries(lists = {}, options = {}) {
  const given = { preprocessor: lists.preprocessor || [], checker: lists.checker || [], pandoc: lists.pandoc || [] };
  const show = new Set(options.show || (options.level ? showFor(options.level) : DEFAULT_SHOW));
  const all = [];
  for (const [src, p] of [["preprocessor", "p"], ["checker", "c"], ["pandoc", "d"]])
    given[src].forEach((e, n) => all.push(Object.assign({}, e, { id: p + n, also: [], calls: null, definition: null, need: null, inDefinition: null })));
  const firstFile = all.map((e) => e.where && e.where.file).find((f) => f && !isPackage(f)) ?? null;
  const main = options.main ?? (options.order && options.order[0]) ?? firstFile;
  const order = options.order ? [...options.order] : main ? [main] : [];
  const unread = options.unread || [], partOf = new Map();
  // s287: a use in a part the document does not read is no use
  const pk = options.packages || { definitions: [], uses: [] };
  const uses = pk.uses.filter((u) => !unreadPartOf({ where: { file: u.file, line: u.line } }, unread));
  const used = new Set(uses.map((u) => u.name));
  for (const e of all) {
    const d = definitionOf(e, pk.definitions);
    if (d) e.inDefinition = { name: d.name, file: d.file, line: d.from.line, used: used.has(d.name) };
    e.category = !d ? categoryOf(e) : e.inDefinition.used ? categoryOf(e, { inDefinition: true }) : "unused";
    const u = unreadPartOf(e, unread);
    if (u) { e.categoryIfRead = e.category; e.category = "unread"; partOf.set(e, u); }
    e.section = sectionOf(e, e.category);
    e.reportLevel = CATEGORY.get(e.category).level;
    e.shown = isOn(e, show);
    e.opens = e.where && e.where.file && e.where.line ? (e.where.file === main ? "main" : "file") : null;
    e.need = e.category !== "drawing" ? null : e.label === BOX_LABEL ? BOX_NEED : DRAWING_NEED;
    const cmd = commandOf(e.message);
    e.fold = e.category + "|" + e.rule + "|" + (e.where && e.where.file) + "|" + cmd;
  }
  // telling each problem once
  // one partner per pair row: a kept entry takes at most one of the other rule
  const gone = new Set(), told = [];
  for (const pair of PAIRS) {
    const taken = new Set();
    for (const o of all.filter((e) => e.rule === pair.other && !gone.has(e))) {
      const k = all.find((e) => e.rule === pair.keep && !gone.has(e) && !taken.has(e) && pair.match(e, o));
      if (!k) continue;
      k.also.push(o); gone.add(o); taken.add(k);
      told.push({ pair: pair.name, kept: { id: k.id, rule: k.rule }, also: { id: o.id, rule: o.rule } });
    }
  }
  const seq = new Map(all.map((e, i) => [e, i]));
  const rank = (f) => f == null ? Infinity : isPackage(f) ? 1e6 + Math.max(0, order.indexOf(f)) : order.includes(f) ? order.indexOf(f) : 5e5;
  const flat = all.filter((e) => !gone.has(e)).sort((a, b) => {
    const fa = a.where && a.where.file, fb = b.where && b.where.file;
    return rank(fa) - rank(fb) || String(fa ?? "").localeCompare(String(fb ?? ""))
      || (a.where.line ?? Infinity) - (b.where.line ?? Infinity) || (a.where.column ?? 0) - (b.where.column ?? 0) || seq.get(a) - seq.get(b);
  });
  const arrange = options.arrange || "nested";
  const { entries, again, uses: useLines } = arrange === "flat" ? { entries: flat, again: [], uses: [] } : nest(flat, main, options.opens || [], uses);
  // a call and its definition (the checker's link)
  const byLink = new Map();
  for (const e of entries) if (e.link && e.link.id) { if (!byLink.has(e.link.id)) byLink.set(e.link.id, []); byLink.get(e.link.id).push(e); }
  for (const group of byLink.values()) {
    const def = group.find((e) => e.link.role === "definition");
    if (!def) continue;
    def.calls = group.filter((e) => e.link.role === "call").map((e) => e.id);
    for (const c of group) if (c.link.role === "call") c.definition = def.id;
  }
  // the by-kind layout: a definition in the author's own file stands for its calls (plan 3.5)
  const standsFor = new Set(entries.filter((e) => e.calls && !isPackage(e.where.file)).map((e) => e.id));
  const LV = { error: 0, warning: 1, note: 2 };
  const sections = SECTIONS.map((s) => {
    const inS = entries.filter((e) => e.section === s.key);
    const groups = new Map();
    for (const e of inS) {
      if (e.definition && standsFor.has(e.definition)) continue;
      if (!groups.has(e.fold)) groups.set(e.fold, []);
      groups.get(e.fold).push(e);
    }
    const list = [...groups.values()].map((g) => ({ key: g[0].fold, label: g[0].label, rule: g[0].rule, file: g[0].where.file ?? null,
      command: commandOf(g[0].message), level: g[0].level, ids: g.map((e) => e.id), lines: g.map((e) => e.where.line).filter((l) => l != null) }));
    list.sort((a, b) => (LV[a.level] ?? 3) - (LV[b.level] ?? 3));
    return { key: s.key, title: s.title, folded: s.folded, count: inS.length, shown: inS.filter((e) => e.shown).length,
             hidden: !CATEGORIES.some((c) => SECTION_OF[c.key] === s.key && show.has(c.key)), groups: list };
  }).filter((s) => s.count);
  const byCategory = {}, bySection = {};
  for (const e of entries) { byCategory[e.category] = (byCategory[e.category] || 0) + 1; bySection[e.section] = (bySection[e.section] || 0) + 1; }
  const counts = { total: entries.length, preprocessor: given.preprocessor.length, checker: given.checker.length, pandoc: given.pandoc.length,
                   told: told.length, shown: entries.filter((e) => e.shown).length, byCategory, bySection,
                   // s291: the count line per level (the checker's entries are outside the levels)
                   levels: Object.fromEntries(LEVELS.map((lv) => [lv, entries.filter((e) => e.reportLevel === lv).length])) };
  // call 2's count line: how many come from each unread part
  if (unread.length) {
    const u = entries.filter((e) => partOf.has(e));
    counts.unread = { total: u.length, parts: unread.map((p) => ({ file: p.file, line: p.line, count: u.filter((e) => partOf.get(e) === p).length }))
      .filter((p) => p.count) };
  }
  return { entries, again, uses: useLines, sections, counts, told, options: { main, order, show: [...show], arrange, level: levelOf(show) } };
}

// marks(combined, show) -> [{ id, file, line, column, endLine, endColumn, start, end, level, category, reportLevel }]:
// the places the editor highlights (s291, plan step 7), the shown entries only, so the same choice drives the list
// and the highlighting. show: the ticks, or a level's name; default the combined report's own. An entry with no line
// has no mark. A package command's message is marked at its own place in the package file.
export function marks(combined, show) {
  const on = new Set(typeof show === "string" ? showFor(show) : show || combined.options.show);
  return combined.entries.filter((e) => isOn(e, on) && e.where && e.where.file && e.where.line != null).map((e) => ({
    id: e.id, file: e.where.file, line: e.where.line, column: e.where.column ?? null, endLine: e.where.endLine ?? null,
    endColumn: e.where.endColumn ?? null, start: e.where.start ?? null, end: e.where.end ?? null, level: e.level,
    category: e.category, reportLevel: e.reportLevel }));
}

// The nested order (s286): walk the main file from the top; at a place that opens a file, put that file's entries
// (and, at their own places, those of what it opens in turn), then go on. An entry at or before the command's
// character goes before the opened file's entries. A file opened again (or by a file it is already inside) gets no
// second copy: at a later place, one closed line `again` { file, where, first, ids, after } - where it is opened
// again, where it was opened first, the ids of the entries told there, and how many entries come before the line.
// s287 (PLAN-REPORT-ORDER-s284 step 3): a package file is followed like any other file, but only its set-up entries
// sit there; an entry inside a package command's definition has no place of its own in the walk. At each use of the
// command one closed line `uses` { name, via, defined, where, ids, after } - the command (and the one the author
// wrote, when reached through it), where its definition with entries starts, the use's place, the ids of the entries
// it shows as copies, and how many entries come before the line. Those entries, and the files nothing opens, follow
// in the flat order.
function nest(flat, main, opens, uses) {
  const byFile = new Map(), inDef = new Map();
  for (const e of flat) {
    if (e.inDefinition) { const n = e.inDefinition.name; if (!inDef.has(n)) inDef.set(n, []); inDef.get(n).push(e); continue; }
    const f = e.where && e.where.file; if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(e);
  }
  // the places in each file the walk stops at: openings, and uses of package commands
  const stops = new Map();
  for (const o of [...opens, ...uses.map((u) => ({ ...u, use: true }))]) {
    if (!stops.has(o.file)) stops.set(o.file, []);
    stops.get(o.file).push(o);
  }
  for (const l of stops.values()) l.sort((a, b) => a.line - b.line || a.column - b.column);
  const out = [], again = [], useLines = [], placed = new Map(), inside = new Set();
  const before = (e, o) => e.where.line != null && (e.where.line < o.line || (e.where.line === o.line && (e.where.column ?? 1) <= o.column));
  const walk = (file) => {
    inside.add(file);
    const es = byFile.get(file) || [];
    let i = 0;
    for (const o of stops.get(file) || []) {
      while (i < es.length && before(es[i], o)) out.push(es[i++]);
      const where = { file: o.file, line: o.line, column: o.column };
      if (o.use) {
        const copies = inDef.get(o.name) || [];
        if (copies.length) useLines.push({ name: o.name, via: o.via, defined: { file: copies[0].inDefinition.file, line: copies[0].inDefinition.line },
          where, ids: copies.map((e) => e.id), after: out.length });
      } else if (placed.has(o.target)) {
        const p = placed.get(o.target);
        if (p.ids.length) again.push({ file: o.target, where, first: p.where, ids: p.ids, after: out.length });
      } else if (!inside.has(o.target)) {
        const from = out.length;
        walk(o.target);
        placed.set(o.target, { where, ids: out.slice(from).map((e) => e.id) });
      }
    }
    while (i < es.length) out.push(es[i++]);
    inside.delete(file);
  };
  if (main != null) { placed.set(main, { where: null, ids: [] }); walk(main); }
  const taken = new Set(out);
  return { entries: [...out, ...flat.filter((e) => !taken.has(e))], again, uses: useLines };
}

// positionLines(combined, show) -> [{ ids, file, fold }]: the entries switched
// on, by position; three or more of the same rule in the same category and
// file in a row fold into one line (fold: { rule, label, level, count, from, to }).
// A file opened again (s286) is one closed line { ids: [], file, fold: null,
// again: { file, where, first, count, ids } }, counting its entries switched on;
// none switched on, no line.
// A use of a package command (s287) is one closed line { ids: [], file, fold: null, use: { name, via, defined, where,
// count, ids, copies: true } }: opened in place it shows the entries of the command's definition, marked as copies
// (each is counted once, and has no line of its own while the command is used).
export function positionLines(combined, show) {
  const on = new Set(show || combined.options.show);
  const marks = [...(combined.again || []).map((a) => ({ a, after: a.after })), ...(combined.uses || []).map((u) => ({ u, after: u.after }))]
    .sort((x, y) => x.after - y.after);
  const s = [], out = [];
  let g = 0;
  const onIds = (ids) => ids.filter((id) => combined.entries.some((e) => e.id === id && isOn(e, on)));
  const closed = ({ a, u }) => {
    const ids = onIds((a || u).ids);
    if (!ids.length) return;
    if (a) s.push({ closed: { again: { file: a.file, where: a.where, first: a.first, count: ids.length, ids } } });
    else s.push({ closed: { use: { name: u.name, via: u.via, defined: u.defined, where: u.where, count: ids.length, ids, copies: true } } });
  };
  combined.entries.forEach((e, n) => {
    while (g < marks.length && marks[g].after <= n) closed(marks[g++]);
    if (isOn(e, on) && !(e.inDefinition && e.inDefinition.used)) s.push(e);
  });
  while (g < marks.length) closed(marks[g++]);
  for (let i = 0; i < s.length;) {
    if (s[i].closed) { const c = s[i].closed; out.push({ ids: [], file: (c.again || c.use).where.file, fold: null, ...c }); i++; continue; }
    let j = i + 1;
    while (j < s.length && !s[j].closed && s[j].rule === s[i].rule && s[j].category === s[i].category && s[j].where.file === s[i].where.file) j++;
    const run = s.slice(i, j), file = s[i].where.file ?? null;
    if (run.length >= 3)
      out.push({ ids: run.map((e) => e.id), file, fold: { rule: s[i].rule, label: s[i].label, level: s[i].level, count: run.length,
                 from: run[0].where.line ?? null, to: run[run.length - 1].where.line ?? null } });
    else for (const e of run) out.push({ ids: [e.id], file, fold: null });
    i = j;
  }
  return out;
}

// ---- plain text ----
const placeText = (w) => !w || !w.file ? "(no place)" : w.line == null ? w.file : w.file + ":" + w.line + (w.column != null ? ":" + w.column : "");
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// renderCombined(combined, { view: "position" | "kind", show }) -> text
export function renderCombined(combined, options = {}) {
  const view = options.view || "position";
  const show = new Set(options.show || combined.options.show);
  const byId = new Map(combined.entries.map((e) => [e.id, e]));
  const c = combined.counts, L = [];
  L.push("COMBINED REPORT: " + (combined.options.main ?? "(no main file)"));
  L.push("In all: " + c.total + " entries (preprocessor " + c.preprocessor + ", checker " + c.checker + ", Pandoc " + c.pandoc + ")"
    + (c.told ? "; " + c.told + (c.told === 1 ? " problem" : " problems") + " told by two steps, kept once" : "") + ".");
  // s291: the count line per level ("Fix this: 9. Check would add 31, Everything 540.")
  if (c.levels) L.push(FIX + ": " + c.levels[FIX] + ". " + CHECK + " would add " + c.levels[CHECK] + ", " + ALL + " " + c.levels[ALL] + ".");
  const shownN = combined.entries.filter((e) => isOn(e, show)).length;
  const hiddenN = (k) => combined.entries.filter((e) => e.category === k.key && !isOn(e, show)).length;
  const off = CATEGORIES.filter((k) => k.key !== "unread" && hiddenN(k)).map((k) => (k.parent ? CATEGORY.get(k.parent).label + " - " : "") + k.label + " " + hiddenN(k) + " (hidden)");
  L.push("Shown: " + shownN + "." + (off.length ? " Not shown (switch on to see): " + off.join(", ") + "." : ""));
  // call 2: the parts this document does not read get a line of their own
  const unreadK = CATEGORY.get("unread"), unreadN = hiddenN(unreadK);
  if (unreadN && c.unread)
    L.push("Hidden: " + unreadN + (unreadN === 1 ? " entry" : " entries") + " from parts of other files this document does not read ("
      + c.unread.parts.map((p) => p.file + (p.line > 1 ? " from line " + p.line : "")).join(", ") + "). Switch on \"" + unreadK.label + "\" to see them.");
  L.push("Order: " + (view === "kind" ? "by kind" : combined.options.arrange === "flat" ? "by position: file, line, column"
    : "down the main file, each file's entries where it is opened; a package's set-up where it is loaded, its commands' at each use")
    + ". Places are file:line:column in the original files.");
  const details = (e, pad) => {
    const out = [];
    if (e.need) out.push(pad + e.need);
    if (e.source === "checker" && e.fixes.length) out.push(pad + "how to fix (best first): " + e.fixes.map((f) => oneLine(f.description)).join(" | "));
    if (e.calls) out.push(pad + "called at " + e.calls.map((id) => placeText(byId.get(id).where)).join(", ") + " (" + e.calls.length + (e.calls.length === 1 ? " call" : " calls") + ")");
    for (const a of e.also) out.push(pad + "also told by " + a.source + " (" + a.rule + "): " + oneLine(a.message));
    return out;
  };
  // a message that begins with its label (the checker's) is not given the label twice
  const said = (e) => { const m = oneLine(e.message); return m.toLowerCase().startsWith(String(e.label).toLowerCase()) ? m : e.label + ": " + m; };
  const entryLines = (e, pad) => [pad + placeText(e.where) + "  " + e.level + "  " + said(e), ...details(e, pad + "    ")];
  if (view === "kind") {
    for (const s of combined.sections) {
      const hidden = !s.folded && s.hidden;
      L.push("", s.title.toUpperCase() + " (" + s.count + (s.folded ? ", folded" : hidden ? ", hidden" : "") + ")");
      if (hidden) continue;
      for (const g of s.groups) {
        const es = g.ids.map((id) => byId.get(id));
        if (es.length === 1) { L.push(...entryLines(es[0], "  ")); continue; }
        L.push("  " + g.label + (g.command ? " " + g.command : "") + ": " + es.length + " places in " + (g.file ?? "(no place)")
          + (g.lines.length ? " (lines " + g.lines.join(", ") + ")" : "") + " (folded)");
        for (const e of es) L.push(...entryLines(e, "      "));
      }
    }
    return L.join("\n") + "\n";
  }
  let file;
  for (const line of positionLines(combined, [...show])) {
    if (line.file !== file || file === undefined) { file = line.file; L.push("", "== " + (file ?? "Not tied to a place") + (isPackage(file) ? " (package file)" : "") + " =="); }
    if (line.again) {
      const a = line.again;
      L.push(placeText(a.where) + "  " + a.file + ", read again: " + a.count + (a.count === 1 ? " message" : " messages") + ", same as at "
        + (a.first.file === a.where.file ? "line " + a.first.line : a.first.file + ":" + a.first.line) + " (closed)");
      continue;
    }
    if (line.use) {
      const u = line.use;
      L.push(placeText(u.where) + "  " + u.name + (u.via ? " (through " + u.via + ")" : "") + ": " + u.count + (u.count === 1 ? " message" : " messages")
        + " in its definition, " + u.defined.file + ":" + u.defined.line + " (closed)");
      continue;
    }
    if (!line.fold) { L.push(...entryLines(byId.get(line.ids[0]), "")); continue; }
    const f = line.fold;
    L.push((file ?? "(no place)") + ":" + f.from + (f.to !== f.from ? "-" + f.to : "") + "  " + f.level + "  " + f.label + ": " + f.count + " in a row (folded)");
    for (const id of line.ids) L.push(...entryLines(byId.get(id), "    "));
  }
  return L.join("\n") + "\n";
}
