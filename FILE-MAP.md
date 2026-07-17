# File map — pandoc-for-math-conversion

Where the working files live and which lines in `index.html` point at them. Written after the 2026-07-17 reorganization that grouped the previously flat files into role-based folders.

## Folders

- **`pandoc-wasm/`** — `pandoc.js` (WASI wrapper) and `pandoc.wasm` (the Pandoc engine).
- **`math-conversion/`** — the math device pipeline: `mathjax-bundle.js` (tex → MathML), `mml-condition.js`, `mml-isotopes-browser.js`, and `MML2OMML.XSL` (MathML → OMML for DOCX).
- **`image-processing/`** — MuPDF: `mupdf.js` (API), `mupdf-wasm.js` (Emscripten glue), and `mupdf-wasm.wasm`.
- **`filters/`** — reference copies of the Lua filters: `default-lists.lua`, `embed-images.lua`, `handout.lua`. See the note below — these are **not** what the tool runs.

`index.html`, `ace/`, `samples/`, the four pipeline folders (`latexml-pipeline-input/`, `latexml-pipeline-output/`, `lualatex-pipeline-input/`, `lualatex-pipeline-output/`), and the repo/CI files remain at the project root.

## Resource references in `index.html`

| Line | Reference in code | Points to |
|-----:|-------------------|-----------|
| 9    | `<script src="ace/ace.js">` | `ace/` (root, unchanged) |
| 1995 | `import('./pandoc-wasm/pandoc.js')` | `pandoc-wasm/` |
| 4169 | `import('./math-conversion/mathjax-bundle.js')` | `math-conversion/` |
| 4170 | `import('./math-conversion/mml-condition.js')` | `math-conversion/` |
| 4171 | `import('./math-conversion/mml-isotopes-browser.js')` | `math-conversion/` |
| 4174 | `fetch('math-conversion/MML2OMML.XSL')` | `math-conversion/` |
| 4226 | `import('./image-processing/mupdf.js')` | `image-processing/` |

## Notes for later edits

**WASM binaries are found by their own loaders, not by `index.html`.** `mupdf-wasm.js` locates its `.wasm` with `new URL('mupdf-wasm.wasm', import.meta.url)` (line 719) and `mupdf.js` imports the glue via the same-folder `./mupdf-wasm.js` (line 23), so the MuPDF trio moves together untouched. `pandoc.js` was patched to work the same way — its wasm fetch now reads `fetch(new URL("./pandoc.wasm?...", import.meta.url))`. That is a **local patch**: if an upstream `pandoc.js` is ever dropped in, re-apply both this line and the synthetic "xform" DEVICE block documented at the top of that file.

**Built-in filters are inline, not loaded from `filters/`.** They live in `index.html` as `content:` strings in the `BUILT_IN_FILTERS` registry (`default-lists` ~L2776, `resolve-image-paths` ~L2830, `embed-images` ~L2921). The tool runs those inline copies; the `.lua` files in `filters/` are reference copies only, so editing them does not change the tool's behavior. (`resolve-image-paths` exists only inline — there is no loose file for it.)

Line numbers are current as of the reorganization. The edits were in-place single-line changes, so they stay accurate unless the file grows above these points.
