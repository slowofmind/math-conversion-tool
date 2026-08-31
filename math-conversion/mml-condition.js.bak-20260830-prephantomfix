// mml-condition.js
// Portable MathML conditioning: "prepare MathML for a target renderer."
//
// Operates on a serialized MathML STRING, so the same logic drops into any
// environment — this Node tool, a browser MathML pass, a MathJax post-filter,
// or even a Lua gsub. No DOM or dependencies required.
//
// Two categories, tagged by how far they travel:
//
//   UNIVERSAL  — also correct for HTML / MathML and for screen-reader output
//                (MathCAT / SRE). Safe to reuse in the accessibility pipeline.
//                  • remapMhchemArrows: mhchem Private-Use-Area glyphs -> Unicode
//
//                  • normalizeEmptyAttributes: bare attr -> attr="" (XHTML)
//
//   OMML-ONLY  — only needed for the Word / OMML path; do NOT carry into HTML.
//                  • fixBarAccents: coax the XSL into m:bar for over/underlines

// ===========================================================================
// UNIVERSAL — mhchem PUA arrow glyphs -> standard Unicode
// ===========================================================================
// MathJax's mhchem draws several reaction arrows from its own font's Private
// Use Area, because some have no Unicode equivalent. Those codepoints are
// meaningless to Word AND to screen readers (SRE reads U+E408 as a pile of
// harpoons rather than "equilibrium"). We remap to the nearest standard char.
// The two biased equilibria (E409/E40A) genuinely have no Unicode form, so ⇌
// is the accepted stand-in.
export const MHCHEM_ARROW_MAP = {
  0xE428: 0x27F5, // ⟵  \mhchemlongleftarrow
  0xE429: 0x27F6, // ⟶  \mhchemlongrightarrow
  0xE42A: 0x27F7, // ⟷  \mhchemlongleftrightarrow
  0xE42B: 0x21C4, // ⇄  \mhchemlongleftrightarrows
  0xE408: 0x21CC, // ⇌  \mhchemlongrightleftharpoons (equilibrium)
  0xE409: 0x21CC, // ⇌  \mhchemlongRightleftharpoons (biased; approximated)
  0xE40A: 0x21CC, // ⇌  \mhchemlongLeftrightharpoons (biased; approximated)
};

// A PUA character in either serialized form: numeric char reference (&#xE429;)
// or the literal codepoint.
const PUA_TOKEN = /&#x([eEfF][0-9A-Fa-f]{3});|([\uE000-\uF8FF])/g;

export function remapMhchemArrows(mml) {
  return mml.replace(PUA_TOKEN, (whole, hex, lit) => {
    const cp = hex ? parseInt(hex, 16) : lit.codePointAt(0);
    const target = MHCHEM_ARROW_MAP[cp];
    return target == null ? whole : '&#x' + target.toString(16).toUpperCase() + ';';
  });
}

// ===========================================================================
// OMML-ONLY — over/underline -> m:bar (not a low m:acc accent)
// ===========================================================================
// MathJax emits \overline as <mover>…<mo accent="true">―(U+2015)</mo></mover>.
// Microsoft's MML2OMML.XSL only builds a proper m:bar when the accent attribute
// is NOT "true" AND the bar char is U+00AF/U+0305 (over) or U+005F/U+0332
// (under); otherwise it falls back to m:acc, which Word renders as a low,
// overlapping accent. We rewrite the bar mo to satisfy the XSL's m:bar test,
// distinguishing over vs under by the closing tag (MathJax puts the bar mo last).
const OVERBAR = /<mo accent="true">(?:&#x2015;|\u2015)<\/mo>(\s*)<\/mover>/gi;
const UNDERBAR = /<mo accent="true">(?:&#x2015;|\u2015)<\/mo>(\s*)<\/munder>/gi;

export function fixBarAccents(mml) {
  return mml
    .replace(OVERBAR, '<mo>&#x00AF;</mo>$1</mover>')
    .replace(UNDERBAR, '<mo>&#x0332;</mo>$1</munder>');
}

// ===========================================================================
// UNIVERSAL — valueless attributes -> attr=""  (XHTML / EPUB safety)
// ===========================================================================
// The intent vocabulary legitimately yields EMPTY phrases: "the absolute value
// of x" has no closing phrase, so ext-close is set to "". MathJax's HTML
// serializer then emits a bare attribute name:
//
//     <mrow ext-open="the absolute value of" ext-close data-latex="...">
//
// HTML treats that as a boolean attribute and reads it back as "", which is
// exactly what the ClearSpeak rule [t] @ext-close wants. XHTML does not: every
// attribute MUST have a value, so an EPUB reader stops at the first one and
// renders the chapter only up to that point. The OMML path is equally strict,
// since it parses the MathML with XSLTProcessor.
//
// We KEEP the attribute and give it an explicit empty value rather than
// dropping it, so rule matching and semantics are unchanged.
//
// NOT THE FIX FOR THE EPUB BUG (2026-08-14). tex2mml already emits
// ext-close="" correctly -- verified directly. The bare attributes seen in
// EPUB output are produced LATER, by Pandoc's own EPUB writer, which strips
// empty attribute values on the way to XHTML (reproduced on local Pandoc 3.10
// CLI, so not a wasm artefact). That is repaired after conversion by
// repairEpubEmptyAttributes() in index.html. See docs/pandoc-epub-bugs.md.
//
// This function is kept as defence in depth: it costs nothing, and it protects
// the OMML path, where MML2OMML.XSL is parsed by XSLTProcessor and would be
// equally intolerant of a bare attribute if a future MathJax serialiser change
// ever produced one.
//
// The tag pattern tolerates quoted values containing < or > (data-latex can
// hold either), and never matches closing tags, since those start with "/".
const TAG_WITH_ATTRS =
  /<([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ONE_ATTR = /\s+([\w:.-]+)(\s*=\s*(?:"[^"]*"|'[^']*'))?/g;

export function normalizeEmptyAttributes(mml) {
  return mml.replace(TAG_WITH_ATTRS, (tag, name, attrs, slash) => {
    if (!attrs) return tag;
    let rebuilt = '';
    let changed = false;
    let m;
    ONE_ATTR.lastIndex = 0;
    while ((m = ONE_ATTR.exec(attrs)) !== null) {
      if (m[2] === undefined) {
        rebuilt += ' ' + m[1] + '=""';
        changed = true;
      } else {
        rebuilt += ' ' + m[1] + m[2].replace(/^\s*=\s*/, '=');
      }
    }
    return changed ? '<' + name + rebuilt + (slash ? '/' : '') + '>' : tag;
  });
}

// ===========================================================================
// Composed entry points
// ===========================================================================
// HTML / MathML / speech reuse: universal transforms only.
export function conditionUniversal(mml) {
  return normalizeEmptyAttributes(remapMhchemArrows(mml));
}

// Word / OMML pipeline: universal + OMML-specific.
export function conditionForOmml(mml) {
  return normalizeEmptyAttributes(fixBarAccents(remapMhchemArrows(mml)));
}
