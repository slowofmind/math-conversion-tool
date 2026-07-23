# Upstream candidates — fixes worth passing to the pandoc-wasm developers

_Running record of local changes to our platform that could be implemented
identically (or nearly so) in the original pandoc-wasm project
(<https://github.com/tweag/pandoc-wasm>, which also powers pandoc.org/app).
Each entry notes what the upstream defect is, how we fixed it locally, and
how portable the fix is. Maintained so these can eventually be collected
into issues/PRs for the Pandoc devs._

## 1. Flat virtual filesystem breaks all multi-file documents (2026-07-22)

**Upstream defect.** `pandoc.js` stores every input file as a single entry
in one flat root `Map` (`fileSystem.set(filename, file)`). A filename
containing directory separators — `ws/1/worksheet.tex` — becomes one root
entry whose *name* contains slashes. The WASI shim
(`@bjorn3/browser_wasi_shim`) resolves paths component-by-component through
nested `Directory` objects, so any `\input`, `\include`, `\subfile`,
`\usepackage` (local .sty), or `\includegraphics` that targets a
subdirectory fails with "Could not load include file". Reproduced on
pandoc.org/app itself: flat filenames work, any directory path fails.
This blocks every real-world multi-file LaTeX project (book/memoir +
subfiles is the standard faculty authoring pattern).

**Our fix (portable as-is).** `pandoc-wasm/pandoc.js`, NESTED-FS patch
block: import `Directory` from the shim; `addFile` splits the name on `/`
and creates/walks nested `Directory` nodes (shim ≥0.3.0:
`Directory.contents` is a `Map`), placing the `File` at the leaf; a
`getFileEntry` helper replaces the two `fileSystem.get()` output lookups
in `convert()`. Flat names behave exactly as before. No changes to the
wasm binary or the Haskell side; this is a pure JS-glue fix and should
drop into upstream `pandoc.js` unchanged.

**Companion app-level issue (pandoc.org/app, not pandoc.js).** Browser
directory uploads (`webkitdirectory`) report paths that *include the
selected folder's own name* (`project/ws/1/x.tex`) while documents refer
to `ws/1/x`. Our app-side remedy: auto-append each uploaded top-level
folder name to pandoc's `resource-path`, which the reader searches when
resolving includes and images. Upstream's app would need the same (or
strip the common prefix).

**Related option-format note.** The `convert()` options object uses
pandoc's *defaults-file* format, where `resource-path` is a list — a
CLI-style colon-joined string is not the right shape. Worth documenting
in the pandoc.js interface comment upstream.

## 2. Serve pandoc.wasm compressed on hosts without transfer compression (2026-07-20)

**Upstream context, not a defect.** pandoc.org/app loads fast because its
host compresses the ~57 MB `pandoc.wasm` in transit (`Content-Encoding:
zstd`, ~15.7 MB on the wire). Deployments on GitHub Pages (and similar
hosts that skip compressing very large assets) serve it raw — ~55 s to
ready vs ~14 s. Anyone self-hosting pandoc-wasm hits this.

**Our fix (portable recipe).** Pre-gzip the wasm to a file with a
**non-`.gz` extension** (`pandoc-wasm.bin`; a `.gz` name invites servers
like Apache to add `Content-Encoding: gzip` and double-decompress), fetch
it, pipe through `DecompressionStream('gzip')` wrapped in a `Response`
with `Content-Type: application/wasm` (this preserves
`instantiateStreaming`), and fall back to the raw `pandoc.wasm` on any
failure. WASM-LOADER patch block in our `pandoc.js` + `compress-wasm.ps1`.
Could be offered upstream as an optional documented pattern rather than a
default.

## 3. Split-environment `\newenvironment` definitions derail the LaTeX reader (2026-07-22)

**Upstream defect — pandoc CORE (jgm/pandoc), not pandoc-wasm.** A
`\newenvironment` whose begin-body opens an environment that only the
end-body closes (the standard LaTeX "split environment" idiom, e.g.
`\newenvironment{it}[3][]{...\begin{tabular}{ll}}{\end{tabular}}`) parses
fine as a *definition*, but the first *use* of the environment derails the
whole parse: the expanded begin-body injects an unmatched
`\begin{tabular}`, and the failure is reported with a wildly misleading
position — in our case "line 139, expecting \end{document}" when the
actual trigger sat at line 538 (Parsec backtracking artifact). Reproduced
on pandoc 3.10 CLI; minimal repro: the definition above in a local `.sty`
+ a document that uses the environment once. Real-world impact: course
`.sty` files use this idiom constantly (our corpus: 11 distinct
environments across three packages), and because pandoc parses local
`\usepackage` targets, supplying the `.sty` makes conversion strictly
worse than omitting it (unknown env → Div fallback is harmless).

**Our remedy (app-level, not a pandoc patch):** planned sty-sanitizer
pre-pass that comments out unbalanced-body environment definitions in
uploaded `.sty` files before pandoc sees them, restoring the safe
unknown-env fallback. For pandoc upstream, the actionable asks would be
(a) tolerate or explicitly reject split-environment expansions instead of
derailing, and (b) improve the error position when a macro-expanded
environment fails.

## Extension protocol

Append-only; number new entries sequentially, date them, and keep the
three-part shape (upstream defect/context → our fix and where it lives →
portability notes). When an entry is reported upstream, add a line with
the issue/PR link rather than rewriting the entry.
