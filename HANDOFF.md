# Accessible STEM — Project Handoff

_Handoff for a new chat session. Written 2026-07-17, after the folder reorganization and the pipeline-folder rename/split; updated 2026-07-20 with the compressed-wasm delivery work. Companion to `FILE-MAP.md` (folder + line-number map) in the same directory._

## What this project is

"Accessible STEM: A Toolkit for Instructor-Created Course Content" is an author-once / output-multiple publishing pipeline (Harvard; owner Nicholas, GitHub `slowofmind`). The whole tool is a single browser page, `index.html`, that turns faculty-authored LaTeX into accessible output (HTML / DOCX / EPUB) with strong math accessibility. It runs Pandoc entirely in the browser via WebAssembly, and can also route documents to two heavier engines — LaTeXML and LuaLaTeX — through GitHub Actions.

A note on memory: Claude's auto-generated memory may refer to this project as "Digital Collegium" and mention APGAM `table-accessibility.lua` items. Treat those specifics as stale or from a separate thread — this handoff and `FILE-MAP.md` are the source of truth for the current tool.

## How to work with the files — READ FIRST

The project lives on Nicholas's Windows machine at:
`C:\Users\nim022\Desktop\mma-code\Accessible-STEM-Project\pandoc-for-math-conversion`

The Claude sandbox (the `view` / `bash` / `/mnt` tools) CANNOT reach these files. Every read or edit of a project file must go through the Desktop Commander (DC) MCP tools (`desktop-commander:*`). The default DC shell is `powershell.exe`.

### Desktop Commander quirks (hard-won — save yourself the rediscovery)

- DC content search (`start_search` with `searchType=content`) is broken here: it returns only a file-level "match" with no line numbers. Don't use it for line-level work.
- For line-level search, use PowerShell `Select-String` via `desktop-commander:start_process` — it returns line numbers. But patterns containing forward slashes `/` (and complex escaped-paren alternations) silently return nothing, so search on slash-free, hyphenated terms instead (e.g. `latexml-pipeline-output`, `mathjax-bundle`).
- `edit_block` (params: `file_path`, `old_string`, `new_string`, `expected_replacements` default 1) edits the Windows file in place and preserves encoding. It errors if the match count differs from `expected_replacements` — a useful guard. Set that count to change several identical occurrences at once.
- `write_file` times out on large writes (~150+ lines risky; ≤~55 safe). Write big files in chunks (one `rewrite`, then `append`s), or use a PowerShell .NET write.
- For large or Unicode files, an encoding-safe scripted edit works reliably: read and write with `[System.IO.File]::ReadAllText` / `WriteAllText`, split and rejoin on `[char]10` (this keeps CR/LF intact), and detect a UTF-8 BOM (first three bytes 239,187,191) so you can write back with `UTF8Encoding($false)` or `($true)` to match. This preserved `index.html`'s box-drawing characters.
- Delete to the Recycle Bin rather than permanently: `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,'OnlyErrorDialogs','SendToRecycleBin')`.
- The generic sandbox tools (`view`, `create_file`, `str_replace`) act on the sandbox, NOT the Windows files — never use them for project files.

### Never open these (they crash or flood the context)

- Binaries: `pandoc.wasm`, `mupdf-wasm.wasm`
- `mathjax-bundle.js` (~380 KB minified)
- The body of `MML2OMML.XSL`
- Don't grep `mupdf.js` for `libmupdf` (~2500 hits)

## Folder structure

The root path is above; see `FILE-MAP.md` for the full map and the exact `index.html` line numbers for each loaded resource. In brief:

- `index.html` — the entire tool and the GitHub Pages entry point (~6316 lines).
- Module folders loaded by `index.html`: `pandoc-wasm/` (`pandoc.js`, `pandoc.wasm`, `pandoc-wasm.bin`, `compress-wasm.ps1`), `math-conversion/` (`mathjax-bundle.js`, `mml-condition.js`, `mml-isotopes-browser.js`, `MML2OMML.XSL`), `image-processing/` (`mupdf.js`, `mupdf-wasm.js`, `mupdf-wasm.wasm`), and `filters/` (reference copies of the Lua filters — NOT what the tool runs).
- Remote-pipeline I/O folders: `latexml-pipeline-input/`, `latexml-pipeline-output/`, `lualatex-pipeline-input/`, `lualatex-pipeline-output/`.
- `ace/` (the editor library, loaded at `index.html` line 9), `samples/` (numbered `.tex` test files), and `.github/workflows/` (the two pipeline YAMLs).

## Architecture

Three engines sit behind one UI.

- **Pandoc** — in-browser WASM, offline, the default. `pandoc.js` is a custom Tweag WASI wrapper carrying TWO local patches, each in a clearly fenced comment block: a synthetic `xform` DEVICE block near the top, and a WASM-LOADER block that fetches the gzipped `pandoc-wasm.bin` (~15 MB) instead of the raw `pandoc.wasm` (~56 MB), decompressing in the browser via `DecompressionStream` with a fallback to the raw wasm. If upstream `pandoc.js` is ever re-dropped in, BOTH patch blocks must be re-applied (upgrade procedure is in `FILE-MAP.md`).
- **LaTeXML** and **LuaLaTeX** — remote, via GitHub Actions on the Docker image `ghcr.io/slowofmind/latexml-pipeline:latest` (a `MODE` env var selects the engine). Flow: `index.html` commits a `.tex` to the engine's input folder via the GitHub API → the workflow triggers on push to that input path → the container runs → output is committed to the engine's output folder → `index.html` polls and fetches it. This relies on a GitHub token embedded in `index.html` (known security debt).

Built-in Lua filters are INLINE in `index.html` as `content:` strings in a `BUILT_IN_FILTERS` registry (default-lists ~L2776; resolve-image-paths ~L2830, which exists inline only, no loose file; embed-images ~L2921). The tool runs these inline copies — the loose `.lua` files in `filters/` are reference copies only.

Math device pipeline (`index.html` ~L4158–4300): `needsMathjaxDevice` / `ensureMathjaxDevice` import tex→MathML plus conditioning, load `MML2OMML.XSL` into an XSLTProcessor, register a device transform, and round-trip math through the synthetic `xform` virtual file. Defaults: HTML math is static MathML via the device; DOCX is OMML (via `MML2OMML.XSL`); MathJax-4 head-injection happens only for the `mathjax4` option. Do NOT change math conversion or output behavior unless Nicholas explicitly asks.

MuPDF (`index.html` ~L4205–4300): `loadMuPDF` + `convertPdfToSvg` (DocumentWriter `svg`) plus a pixmap/DPI path. The MuPDF trio self-relocates via relative imports, so moving that folder needs no edits.

## Repo & deployment

One git remote (`origin`) with DUAL push URLs — `github.com/slowofmind/math-conversion-tool` and `code.harvard.edu/nim022/math-conversion-tool` — on branch `main`, deployed via GitHub Pages. The literal `math-conversion-tool` inside `index.html` (~L5761/5767) is the repo NAME, unrelated to any folder path.

## Recent work (2026-07-20) — compressed wasm delivery

**Problem:** the live GitHub Pages site took ~55 s to become ready, vs ~14 s for the public pandoc.org/app. DevTools measurement (`performance.getEntriesByType('resource')`) proved both apps use the identical ~57 MB `pandoc.wasm`; the difference was purely transport. Pandoc.org's host compresses it in transit (`Content-Encoding: zstd`, ~15.7 MB on the wire); our GitHub Pages instance serves it raw with no `Content-Encoding` — the CDN compresses small text assets (our `pandoc.js` went 9→3 KB) but skips the huge wasm.

**Fix:** ship our own compression. `compress-wasm.ps1` gzips `pandoc.wasm` → `pandoc-wasm.bin` (55.87 → 15.41 MB, round-trip SHA-256-verified) and the WASM-LOADER patch block in `pandoc.js` fetches the `.bin`, pipes it through `DecompressionStream('gzip')` wrapped in a `Response` with `Content-Type: application/wasm` (preserving streaming compilation), and falls back to raw `pandoc.wasm` on any failure. Result confirmed live: load time now matches the public app.

**Reusable technique + portability notes (read before compressing other wasm, or moving off GitHub Pages):**

- The same recipe applies to any large binary asset we add later (e.g. `mupdf-wasm.wasm`, ~10 MB — currently lazy-loaded, so lower priority): gzip it, give it a **non-`.gz` filename**, fetch + `DecompressionStream` in its loader.
- The `.bin` (not `.gz`) filename is load-bearing: traditionally configured servers (Apache is the classic case — plausible for an eventual Harvard-hosted deployment) see a `.gz` extension and add `Content-Encoding: gzip` themselves, so the browser transparently decompresses before our code runs, our explicit decompression then fails, and only the slow fallback saves us. A neutral extension makes the scheme portable across GitHub Pages (both flavors), Harvard web servers, and local test servers.
- When moving to any new host, verify with DevTools: the `pandoc-wasm.bin` request should transfer ~15.4 MB and the console should show no yellow `[pandoc.js]` fallback warning. If the host turns out to compress large files natively, the scheme still works — it's just redundant, not broken.
- `DecompressionStream` is baseline in all current browsers (Chrome/Edge 2020+, Firefox 2023+, Safari 16.4+); older browsers hit the raw-wasm fallback and simply load slowly.

## Recent work (2026-07-17)

- Reorganized the previously flat directory into role-based folders (`pandoc-wasm/`, `math-conversion/`, `image-processing/`, `filters/`); moved 12 files; updated the `index.html` resource paths (L1995 pandoc, L4169–4171 math imports, L4174 `MML2OMML.XSL` fetch, L4226 mupdf) and `pandoc.js`'s wasm-fetch patch; removed stray root test files; and wrote `FILE-MAP.md`.
- Renamed the pipeline folders to engine-labeled names and SPLIT the previously-shared output folder: `pipeline-input`→`latexml-pipeline-input`, `pipeline-lualatex-input`→`lualatex-pipeline-input`, `pipeline-output`→`latexml-pipeline-output`, plus a new `lualatex-pipeline-output`. Updated every reference in `index.html` (region-aware, because `pipeline-output` appeared in both engine paths with some byte-identical lines) and in both workflow YAMLs; moved the existing LuaLaTeX artifacts into the new output folder. Verified zero straggler references, with Unicode and line count intact.

## Current state and open items

- **Pushed and live (2026-07-20).** The folder reorganization, pipeline renames, and the compressed-wasm delivery are all committed and synced; the live GitHub Pages site loads in the same ballpark as pandoc.org/app. Local browser testing of the compressed loader passed (status reached "Pandoc WASM ready", no fallback warning).
- **Open: `worker-html.js` error from the Ace editor.** A pre-existing, unrelated issue Nicholas flagged during the 2026-07-20 local test; it is the next item to investigate.
- **Next phase Nicholas flagged:** catalog how the rest of the tool works, toward planning what a genuinely simplified version would need.

## Nicholas's working preferences

Prose over bullets in explanations and write-ups; read and inspect fully before writing or changing anything; work in iterative checkpoints (present a plan or findings and get explicit sign-off before any destructive step); and diagnose the root cause before writing code.

## Where deeper history lives

Detailed transcripts of these sessions were captured under `/mnt/transcripts/` in the originating chats (see `journal.txt` there for the catalog) — most recently the folder-reorg and pipeline-rename sessions of 2026-07-17. A fresh chat will not have those files, so this handoff and `FILE-MAP.md` are the primary references; ask Nicholas if deeper history is needed.
