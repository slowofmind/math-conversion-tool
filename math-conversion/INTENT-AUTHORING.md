# Intent authoring in this platform — orientation for a future session

Written 2026-08-09 for a Claude session working on THIS repo (Accessible
STEM platform) that has no other context. Two jobs this file supports:
(1) building the search-and-suggest feature in the CodeMirror 6 editor,
(2) building presentation demos. Read `INTENT-BUNDLE.md` (same folder) first
for what the math bundle is and how it gets rebuilt.

## What already works (nothing to build for this part)

`index.html` §5B imports `mathjax-bundle-intent.js`. When a LaTeX source is
converted to HTML, any math using the intent commands below produces MathML
carrying `intent`/`arg` attributes (read by MathCAT inside NVDA/JAWS —
works offline from the static MathML) and `ext-*` attributes (carriers for
SRE speech; need a page-side rules shim, not yet shipped here). Sources
using none of these commands convert byte-identically to the old bundle.

## The commands (what the suggest tool inserts)

Three primitives, defined by the bundle at conversion time:

- `\intent{concept}{...math...}` — wrap math, name its meaning.
- `\iarg{op}` / `\iarg[b]{op}` — mark operands inside a wrap. First operand
  defaults to slot `a`; label later ones `[b]`, `[c]`. Spoken in slot order.
- `\speakas{words}{...math...}` — escape hatch: speak exactly these words.

Plus ~27 shortcut macros generated from the vocabulary (`\card{S}`,
`\determ{A}`, `\dotp{u}{v}`, `\deriv{y}{x}`, ...). Every macro is an
abbreviation of an `\intent` wrap; rendering is identical to the plain
notation. Unknown concept names degrade gracefully (hyphens read as
spaces + "of"), so suggesting a not-yet-authored concept name is SAFE.

PREFERRED FORM FOR THE SUGGEST TOOL: the wrap (`\intent{...}{...}`) around
the author's original tokens — visible, reversible, teaches the mechanism.
Offer macros as the terse alternative. NEVER auto-apply; faculty choose
(standing user directive).

## intent-vocabulary.json (same folder — the data the tool needs)

COPY of the single source of truth in the mathjax-intent-extension project
(mma-code\000-BBB...\mathjax-intent-extension\src\). Do not hand-edit here;
it must stay in sync with the baked bundle — resync both when that project
rebuilds. v0.2.0, 39 concepts. Per concept: `concept` (the name to put in
\intent), `group` (rollup toggle), `arity`, `phrases.en` (spoken form),
`macro` (name/args/tex, or null = wrap-only), `notation` (id into
notations[]), `confidence`, `notes`.

**`notations[]` is the suggest tool's spec.** Each entry = one ambiguous
LaTeX notation: `tex` pattern, `description`, `concepts[]` (the competing
readings to offer, in priority order), `mathcatBehaviour` (what a screen
reader guesses unaided — useful for explaining WHY it needs disambiguation).
Detection strategy: scan math in the CM6 document for these tex patterns
(e.g. `|...|`, `\|...\|`, `\overline{...}`, `(..,..)`, `[..,..]`, prime,
`^*`, `\dot{...}`), then offer that notation's concepts[]. 10 notation
groups exist; growing the list is a known, separate workstream.

## Demo material

`intent-demo-examples.md` (same folder) has 14 ready examples with REAL
before/after screen-reader speech, course context, and exact LaTeX — copy
the "With intent" column straight into the editor. Highlights that land
well: |S| vs |A| vs |x| (one notation, five meanings); \dot{x} = 4x^2 - 16
(verbatim from APMTH 108); x^* meaning fixed point (APMTH 108) vs optimal
solution (APMTH 121); [HCl] concentration (chemistry). Verify a demo by
converting to HTML and inspecting the emitted `<math>` for
`intent="concept($a)"` — that attribute is what NVDA+MathCAT speaks from.

## Known limits (don't chase as bugs)

- SRE/aria-label speech in OUTPUT pages needs the ~1KB rules shim from the
  mathjax-intent-extension project (not shipped here yet). MathCAT/NVDA
  needs nothing.
- The docx/OMML path ignores intent attributes (harmless pass-through).
- `\intent` etc. are conversion-time commands; they will not compile in
  ordinary LaTeX (a PDF-compat .sty is designed, not built).
