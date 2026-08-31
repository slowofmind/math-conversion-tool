# mathjax-bundle-intent.js — provenance and integration (2026-08-09)

`mathjax-bundle-intent.js` is a drop-in replacement for `mathjax-bundle.js`
(same ESM export, same signature: `tex2mml(tex, display=true) -> MathML
string`, same 38 TeX packages, MathJax 4.1.3) with the MathML `intent`
extension baked in. `index.html` §5B was switched to import it on
2026-08-09; the old bundle is kept beside it — revert = change the import
path back.

## What changes, what doesn't

- A source using none of the intent commands converts **byte-identically**
  to the old bundle (verified over a 20-expression corpus incl. mhchem,
  physics, braket, noundefined at build time).
- New TeX commands: `\intent{concept}{...}`, `\iarg{op}` / `\iarg[b]{op}`,
  `\speakas{words}{...}`, plus ~27 shortcut macros (`\card`, `\determ`,
  `\dotp`, `\deriv`, ...) generated from the vocabulary. `\abs`/`\norm` now
  shadow the physics versions: identical rendering, plus intent attributes.
- Annotated math emits `intent=`/`arg=` (consumed by MathCAT in NVDA/JAWS —
  works OFFLINE from the static MathML this pipeline produces) and `ext-*`
  attributes (carriers for SRE composed speech, which additionally needs a
  small rules shim in the OUTPUT page — not part of this bundle; see the
  mathjax-intent-extension project).

## Source of truth / rebuilding

NOT hand-maintained (like the original bundle). It is built in the
`mathjax-intent-extension` project (mma-code\000-BBB...\mathjax-intent-extension):

- entry: `build/bundle/tex2mml-intent-entry.mjs`
- vocabulary: `src/intent-vocabulary.json` (39 concepts as of 2026-08-09)
- build + verify: `sh build/bundle/build-tex2mml-bundle.sh` (esbuild; runs an
  intent smoke test and, with `OLD_BUNDLE=<path>`, the byte-parity check)
- reference for authors: that project's `docs/authoring-commands-reference.md`

Rebuild there and re-copy `dist/mathjax-bundle-intent.js` here whenever the
vocabulary changes. The planned detection/suggestion tooling (CodeMirror6)
will target the same commands; its spec is the vocabulary's `notations[]`
array.
