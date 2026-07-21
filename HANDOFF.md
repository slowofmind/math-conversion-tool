# Accessible STEM — Project Handoff

_Handoff for a new chat session. Written 2026-07-17; updated 2026-07-20 (compressed-wasm delivery) and 2026-07-21 (branch `cm6-migration`: CM6 editor, cleanup workspace model). Companions: `PROJECT-OVERVIEW.md` (comprehensive project write-up, including provenance and roadmap) and `FILE-MAP.md` (folder + line-number map — its `index.html` line numbers predate this branch and have drifted)._

## What this project is

"Accessible STEM: A Toolkit for Instructor-Created Course Content" is an author-once / output-multiple publishing pipeline (Harvard; owner Nicholas, GitHub `slowofmind`). The whole tool is a single browser page, `index.html`, that turns faculty-authored LaTeX into accessible output (HTML / DOCX / EPUB) with strong math accessibility. It runs Pandoc entirely in the browser via WebAssembly, and can also route documents to two heavier engines — LaTeXML and LuaLaTeX — through GitHub Actions.

A note on memory: Claude's auto-generated memory may refer to this project as "Digital Collegium" and mention APGAM `table-accessibility.lua` items. Treat those specifics as stale or from a separate thread — this handoff and `FILE-MAP.md` are the source of truth for the current tool.

## How to work with the files — READ FIRST

The project lives on Nicholas's Windows machine at:
`C:\Users\nim022\Desktop\mma-code\Accessible-STEM-Project\pandoc-for-math-conversion`

The Claude sandbox (the `view` / `bash` / `/mnt` tools) CANNOT reach these files. Every read or edit of a project file must go through the Desktop Commander (DC) MCP tools (`desktop-commander:*`). The default DC shell is `powershell.exe`.

### Desktop Commander quirks (hard-won — save yourself the rediscovery)

- DC content search (`start_search` with `searchType=content`) has been unreliable across sessions: in some it returns file-level matches with no line numbers; in recent sessions (2026-07-20/21) it returned proper line-numbered results. Try it first; if it degrades, fall back to PowerShell `Select-String` via `desktop-commander:start_process` — but note Select-String patterns containing forward slashes `/` (and complex escaped-paren alternations) silently return nothing, so search on slash-free, hyphenated terms instead (e.g. `latexml-pipeline-output`, `mathjax-bundle`).
- PowerShell mangles quotes inside inline `python -c "..."` one-liners (SyntaxError mid-string). Write the helper script to a temp `.py` file with `write_file`, then run that file.
- Syntax-check `index.html`'s module script after editing: `C:\Users\nim022\AppData\Local\Temp\extract-module.py` extracts the `<script type="module">` block to `module-check.mjs`; run it then `node --check` the result. Recreate the extractor from HANDOFF history if the temp file is gone (six lines: read index.html, regex the module block, write it out).
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
- `ace/` (the editor library used on `main`; the `cm6-migration` branch instead loads `codemirror/cm6-editor.js`, an esbuild bundle of `cm6-src/facade.js` — rebuild with `powershell -NoProfile -ExecutionPolicy Bypass -File build-cm6.ps1`), `samples/` (numbered `.tex` test files), and `.github/workflows/` (the two pipeline YAMLs).

On `cm6-migration`, editor access goes through the facade API only (createEditor, setText/getText, setLanguage, gotoLine, setDiagnostics, highlightRanges/clearHighlights, registerCompletionSource, setCompletionEnabled). Design rule: Pandoc-specific intelligence stays in `index.html` as data, never compiled into the bundle. Syntax highlighting is the TeXlyre `codemirror-lang-latex` Lezer grammar; the token color palette is plain CSS in `index.html` (`.cm-editor`-prefixed `tok-*` rules), so palette changes need no rebuild.

## Architecture

Three engines sit behind one UI.

- **Pandoc** — in-browser WASM, offline, the default. `pandoc.js` is a custom Tweag WASI wrapper carrying TWO local patches, each in a clearly fenced comment block: a synthetic `xform` DEVICE block near the top, and a WASM-LOADER block that fetches the gzipped `pandoc-wasm.bin` (~15 MB) instead of the raw `pandoc.wasm` (~56 MB), decompressing in the browser via `DecompressionStream` with a fallback to the raw wasm. If upstream `pandoc.js` is ever re-dropped in, BOTH patch blocks must be re-applied (upgrade procedure is in `FILE-MAP.md`).
- **LaTeXML** and **LuaLaTeX** — remote, via GitHub Actions on the Docker image `ghcr.io/slowofmind/latexml-pipeline:latest` (a `MODE` env var selects the engine). Flow: `index.html` commits a `.tex` to the engine's input folder via the GitHub API → the workflow triggers on push to that input path → the container runs → output is committed to the engine's output folder → `index.html` polls and fetches it. This relies on a GitHub token embedded in `index.html` (known security debt).

Built-in Lua filters are INLINE in `index.html` as `content:` strings in a `BUILT_IN_FILTERS` registry (default-lists ~L2776; resolve-image-paths ~L2830, which exists inline only, no loose file; embed-images ~L2921). The tool runs these inline copies — the loose `.lua` files in `filters/` are reference copies only.

Math device pipeline (`index.html` ~L4158–4300): `needsMathjaxDevice` / `ensureMathjaxDevice` import tex→MathML plus conditioning, load `MML2OMML.XSL` into an XSLTProcessor, register a device transform, and round-trip math through the synthetic `xform` virtual file. Defaults: HTML math is static MathML via the device; DOCX is OMML (via `MML2OMML.XSL`); MathJax-4 head-injection happens only for the `mathjax4` option. Do NOT change math conversion or output behavior unless Nicholas explicitly asks.

MuPDF (`index.html` ~L4205–4300): `loadMuPDF` + `convertPdfToSvg` (DocumentWriter `svg`) plus a pixmap/DPI path. The MuPDF trio self-relocates via relative imports, so moving that folder needs no edits.

## Repo & deployment

One git remote (`origin`) with DUAL push URLs — `github.com/slowofmind/math-conversion-tool` and `code.harvard.edu/nim022/math-conversion-tool`. `main` is the default branch on both sites and is what GitHub Pages serves; the Pages source setting is independent of the default-branch setting. All current work is on branch `cm6-migration` (published to both remotes 2026-07-21; forked from `main` at `8899dfc`; merges as a unit because the editor migration is its first commit). Local `main` is one commit ahead of the published `main` (the 2026-07-20 HANDOFF update) — the next sync on `main` will push it. The literal `math-conversion-tool` inside `index.html` (~L5761/5767 pre-branch) is the repo NAME, unrelated to any folder path.

## Recent work (2026-07-21) — branch `cm6-migration`: cleanup workspace model

Six commits, all smoke-tested by Nicholas except the last checkbox. In order: `b171253`/`ab97af1` CM6 scaffold + Ace→CM6 migration; `038f6fa` Lezer LaTeX grammar + token palette; `0d8e73c` cleanup profiles (presets, JSON export/import in the VS Code extension's envelope, conversion-time cleanup via `getSourceForConversion()` feeding all three engines, auto-populate toggle, line-drift warning in the log); `e61381e` auto-populate classifies `\cmd{...}` warnings as matched pairs; `44ba250` EDIT_TAGS-with-blank-replacements as the default everywhere (Nicholas's call: Pandoc deletes command brace content when skipping, so generated patterns should rescue it); `08facef` the workspace model (empty "My cleanup" start; presets/imports/auto-populate all append into the active profile through `mergePatternsInto()` with equivalence dedupe; "Add preset patterns…" control; clear-all button); `ca048f7` failsafe checkbox that downloads the active profile JSON alongside every output download (expect Chrome's one-time multiple-downloads permission prompt).

Full detail on the cleanup system's current semantics is in `PROJECT-OVERVIEW.md`. Key code locations (post-branch line numbers, will drift): cleanup engine ~L4700–5050, preset registry + merge + profile state ~L5085–5200, export/import/clear handlers ~L5290–5400, `getSourceForConversion` ~L5670, `populateCleanupFromWarnings` ~L5700–5790.

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

- **Branch `cm6-migration` is current and published** (both remotes, 2026-07-21). Everything through `08facef` is browser-verified by Nicholas; `ca048f7` (the failsafe checkbox) awaits its smoke test. `main` remains the stable Ace-era build that Pages serves; merge decision deferred until the branch is demo-stable. A "Compare & pull request" banner on the repo sites is informational only.
- **Deliberately deferred design decisions (Nicholas is thinking; don't implement unprompted):** how to differentiate auto-populated patterns from deliberate ones (options catalogued in `PROJECT-OVERVIEW.md`); the scope revisit (import drops profile-level scope; possible multiple scopes per profile — data-model + extension round-trip implications).
- **Backlog (see `PROJECT-OVERVIEW.md` Roadmap for detail):** unified upload with auto-classification (feasibility established, 1–2 sessions); editor items — color palette punch-up (CSS-only), math-region background tint (facade change, own checkpoint), completion layer (facade mechanism idle, hybrid design agreed), prune `@codemirror/legacy-modes` on next bundle touch; extend the line-drift warning to the LaTeXML/LuaLaTeX log paths; optional timestamping of failsafe downloads; embedded-token security debt; transplant to a fresh public repo before the team demo; the old Ace `worker-html.js` error (likely obsolete once CM6 lands on `main` — confirm).
- **Known accepted problem:** line-number drift between cleaned conversion input and the editor text; mitigated by the log warning and matched-text-search fallback in decoration code.

## Nicholas's working preferences

Prose over bullets in explanations and write-ups; read and inspect fully before writing or changing anything; work in iterative checkpoints (present a plan or findings and get explicit sign-off before any destructive step); and diagnose the root cause before writing code.

## Where deeper history lives

`PROJECT-OVERVIEW.md` (same directory) is the comprehensive write-up: purpose, origin and lineage (including the recorded provenance of the stack-based parser — VS Code extension `atc-latex-cleanup-tool`, ≥Nov 2025, no earlier ancestor on record), architecture, the cleanup system's full semantics, deployment, and the roadmap including the unified-upload feasibility analysis. Detailed session transcripts were captured under `/mnt/transcripts/` in the originating chats (see `journal.txt` there for the catalog) — most recently the CM6-migration and cleanup-workspace sessions of 2026-07-20/21. A fresh chat will not have those files, so this handoff, `PROJECT-OVERVIEW.md`, and `FILE-MAP.md` are the primary references; ask Nicholas if deeper history is needed.
