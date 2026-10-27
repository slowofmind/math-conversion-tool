// v2/transforms/tagged-pdf.mjs — session 270. Files written for an accessible
// (tagged) PDF: what the -pp copy can carry across to Pandoc, and a report of
// what it cannot (sessions/TAGGED-PDF-PLAN-s264.md option B, as narrowed in
// session 270; DECISIONS 2026-10-25, "tonight: Tagged PDF handling"). Twelfth
// and last in run.mjs.
//
// Plain terms: the LaTeX tagging project lets an author describe images,
// mark decoration and declare the language for an accessible PDF. Pandoc 3.11
// already keeps \includegraphics[alt={..}] (s264). Three more things cross when
// the -pp copy writes them differently (_work/_s270-tagprobe.txt; the print is
// identical in each):
//   - \DocumentMetadata whose { is on the next line: Pandoc shows its settings
//     as text ("lang=en-US, uncompress, tagging=on"). The { is joined to the
//     command's line.
//   - \includegraphics[artifact]: a decorative image, announced "image". The
//     key is written alt={}, which gives alt="" (silent).
//   - \includegraphics[actualtext=..]: a symbol read as text, announced
//     "image". The key is written alt, its value kept: alt="star".
// Reported on the attention channel, not changed (none has a carrier Pandoc
// honours, or the one it has changes the print or needs another package):
//   tagged/lang          the document language (\DocumentMetadata lang=): the
//                        page and Word file carry none; the platform's lang
//                        metadata is where it would go (s264 option C)
//   tagged/artifact-alt  [artifact] beside an alt text: Pandoc shows the alt
//                        text although the image is decoration
//   tagged/drawing-alt   tikzpicture / \tikz [alt=..]: Pandoc drops a drawing
//                        and its description
//   tagged/table-headers table/header-rows or header-columns declared: Pandoc
//                        marks a header row only when a rule follows row 1,
//                        never two rows or header columns (M6)
//   tagged/text-lang     \tagpdfsetup{text/lang=..}: the language change is lost
//   tagged/low-level     \tagstructbegin{.. alt / actualtext / alttext ..}: lost
//
// Where: the author's files only (a package is never edited), running text by
// placeAt (not a definition body - the expander writes a call out and the copy
// there is carried - not maths, an option, a picture), not inside an
// environment this version hides. Keys are read by tokens: the [..] after the
// command, split at commas outside braces, a key the text before its first =.
import { readGroup, readBracket, matchEnvironment, isPictureEnv } from "../structure.mjs";

const textOf = (toks) => toks.map((t) => t.text).join("");
const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? textOf(ts.slice(g.open + 1, g.close)).trim() : null; };
const isBlank = (t) => t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment";

// The key=value entries of tokens open..close (exclusive), split at commas at
// brace depth 0: [{ key, keyFrom, keyTo, value }] with token indices of the key.
function entries(ts, open, close) {
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
      else if (d === 0 && ts[k].kind === "Other" && ts[k].text === "=") { eq = k; break; }
    }
    let ke = eq < 0 ? b : eq - 1;
    while (ke >= a && isBlank(ts[ke])) ke--;
    out.push({ key: textOf(ts.slice(a, ke + 1)).trim(), keyFrom: a, keyTo: ke, value: eq < 0 ? null : textOf(ts.slice(eq + 1, b + 1)).trim() });
  };
  for (let k = open + 1; k < close; k++) {
    const t = ts[k];
    if (t.kind === "BeginGroup") depth++;
    else if (t.kind === "EndGroup") depth--;
    else if (depth === 0 && t.kind === "Other" && t.text === ",") { flush(k); from = k + 1; }
  }
  flush(close);
  return out;
}
// Every key in a (possibly nested) setup text, by its full name: "table/header-rows",
// and the inside of tagging-setup={..} read the same way.
function keysDeep(ts, open, close, out = []) {
  for (const e of entries(ts, open, close)) {
    out.push(e);
    if (e.value !== null) {
      const k = e.keyTo + 1 + ts.slice(e.keyTo + 1, close).findIndex((t) => t.kind === "BeginGroup");
      const g = k > e.keyTo ? readGroup(ts, k) : null;
      if (g && g.close < close && (e.key === "tagging-setup" || e.key === "testphase")) keysDeep(ts, g.open, g.close, out);
    }
  }
  return out;
}

// createTaggedPdf({ files, hidden, placeAt })
//   files    the author's files of the chain: [{ path, tokens }]
//   hidden   the environments this version hides (the reader's)
//   placeAt  (file, tokens, k) -> { place, depends }: v2/flag-calls.mjs placeAt
export function createTaggedPdf({ files = [], hidden = [], placeAt } = {}) {
  const BY = "tagged-pdf";
  const hid = new Set(hidden);
  const hiddenOf = new Map();
  const isHidden = (file, tokens, i) => {
    if (!hiddenOf.has(file)) {
      const spans = [];
      for (let k = 0; k < tokens.length; k++) {
        if (tokens[k].kind !== "ControlWord" || tokens[k].name !== "begin") continue;
        const n = envName(tokens, k);
        if (n === null || !hid.has(n)) continue;
        const env = matchEnvironment(tokens, k);
        if (env) { spans.push([k, env.close]); k = env.close; }
      }
      hiddenOf.set(file, spans);
    }
    return hiddenOf.get(file).some(([a, b]) => a <= i && i <= b);
  };
  const authorFile = new Set(files.map((f) => f.path));
  const usable = (ctx) => authorFile.has(ctx.file) && !isHidden(ctx.file, ctx.tokens, ctx.i) && placeAt(ctx.file, ctx.tokens, ctx.i).place === "text";
  const flag = (ctx, rule, message, endTok, detail) => ctx.emit(ctx.decide.flag({ by: BY, file: ctx.file, rule, level: "unsupported",
    span: { start: ctx.tokens[ctx.i].start, end: ctx.tokens[endTok].end }, message, detail: detail || {} }));

  const commands = {
    DocumentMetadata(ctx) {
      const { tokens, i, file, emit, decide } = ctx;
      if (!authorFile.has(file)) return null;
      let j = i + 1;
      while (j < tokens.length && isBlank(tokens[j])) j++;
      if (!tokens[j] || tokens[j].kind !== "BeginGroup") return null;
      const g = readGroup(tokens, j);
      if (!g) return null;
      if (j > i + 1 && tokens.slice(i + 1, j).some((t) => t.kind === "Newline"))
        emit(decide.rewrite({ by: BY, file, rule: "tagged/metadata", span: { start: tokens[i].start, end: tokens[j].end }, replacement: "\\DocumentMetadata{",
          note: "joined \\DocumentMetadata's { to its line: with the { on the next line Pandoc shows the settings as text. What a compile prints is unchanged." }));
      const keys = keysDeep(tokens, g.open, g.close);
      const lang = keys.find((e) => e.key === "lang");
      if (lang && lang.value) flag(ctx, "tagged/lang", "the document language (" + lang.value + ") is declared for the PDF; the converted page and Word file " +
        "carry no language. Until the platform fills it in, set the language in the output's metadata.", g.close, { lang: lang.value.replace(/^\{|\}$/g, "") });
      if (keys.some((e) => e.key === "table/header-rows" || e.key === "table/header-columns"))
        flag(ctx, "tagged/table-headers", "table headers are declared for the PDF (in \\DocumentMetadata's tagging-setup); Pandoc marks a header row only " +
          "when a rule (\\hline, \\midrule) follows the first row, and never header columns.", g.close);
      return null;
    },
    tagpdfsetup(ctx) {
      const { tokens, i } = ctx;
      if (!usable(ctx)) return null;
      const g = readGroup(tokens, i + 1);
      if (!g) return null;
      const keys = keysDeep(tokens, g.open, g.close);
      if (keys.some((e) => e.key === "table/header-rows" || e.key === "table/header-columns"))
        flag(ctx, "tagged/table-headers", "table headers are declared for the PDF; Pandoc marks a header row only when a rule (\\hline, \\midrule) " +
          "follows the first row, and never header columns.", g.close);
      const tl = keys.find((e) => e.key === "text/lang");
      if (tl) flag(ctx, "tagged/text-lang", "a change of language (" + (tl.value || "") + ") is marked for the PDF only; the converted page does not " +
        "carry it. babel's \\foreignlanguage{..}{..} would.", g.close, { lang: tl.value });
      return null;
    },
    tagstructbegin(ctx) {
      const { tokens, i } = ctx;
      if (!usable(ctx)) return null;
      const g = readGroup(tokens, i + 1);
      if (!g) return null;
      const k = entries(tokens, g.open, g.close).find((e) => e.key === "alt" || e.key === "actualtext" || e.key === "alttext");
      if (k) flag(ctx, "tagged/low-level", "a description written with \\tagstructbegin (" + k.key + ") exists only in the tagged PDF; the converted " +
        "page does not carry it.", g.close, { key: k.key });
      return null;
    },
    includegraphics(ctx) {
      const { tokens, i, file, emit, decide } = ctx;
      if (!usable(ctx)) return null;
      const b = readBracket(tokens, i + 1);
      if (!b) return null;
      const es = entries(tokens, b.open, b.close);
      const has = (k) => es.find((e) => e.key === k);
      const art = has("artifact"), act = has("actualtext");
      if (art && has("alt")) { flag(ctx, "tagged/artifact-alt", "the image is marked as decoration (artifact) and also has alt text; the converted " +
        "page announces the alt text. Remove one of them.", b.close); return null; }
      if (art && art.value === null) {
        emit(decide.rewrite({ by: BY, file, rule: "tagged/artifact", span: { start: tokens[art.keyFrom].start, end: tokens[art.keyTo].end }, replacement: "alt={}",
          note: "wrote [artifact] as alt={}: the image is decoration, and Pandoc then gives it an empty alt text (silent) instead of \"image\". What a compile prints is unchanged." }));
        return null;
      }
      if (act && act.value !== null && !art)
        emit(decide.rewrite({ by: BY, file, rule: "tagged/actualtext", span: { start: tokens[act.keyFrom].start, end: tokens[act.keyTo].end }, replacement: "alt",
          note: "wrote [actualtext=" + act.value + "] as alt=" + act.value + ": Pandoc then reads the image as that text instead of \"image\". What a compile prints is unchanged." }));
      return null;
    },
    tikz(ctx) { return drawing(ctx, ctx.i + 1); },
    begin(ctx) {
      const n = envName(ctx.tokens, ctx.i);
      if (n === null || !isPictureEnv(n)) return null;
      return drawing(ctx, readGroup(ctx.tokens, ctx.i + 1).close + 1);
    },
  };
  function drawing(ctx, at) {
    if (!authorFile.has(ctx.file) || isHidden(ctx.file, ctx.tokens, ctx.i)) return null;
    const pl = placeAt(ctx.file, ctx.tokens, ctx.i).place;
    if (pl === "definition" || pl === "option") return null;
    const b = readBracket(ctx.tokens, at);
    if (!b) return null;
    const alt = entries(ctx.tokens, b.open, b.close).find((e) => e.key === "alt");
    if (alt) flag(ctx, "tagged/drawing-alt", "the drawing's description (alt=" + alt.value + ") is lost: Pandoc drops the drawing and its description. " +
      "The page's figure step, or a replacement, would have to carry it.", b.close, { alt: alt.value });
    return null;
  }

  return { transform: { name: BY, rounds: [1], commands } };
}

export default createTaggedPdf;
