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
// Composed entry points
// ===========================================================================
// HTML / MathML / speech reuse: universal transforms only.
export function conditionUniversal(mml) {
  return remapMhchemArrows(mml);
}

// Word / OMML pipeline: universal + OMML-specific.
export function conditionForOmml(mml) {
  return fixBarAccents(remapMhchemArrows(mml));
}
