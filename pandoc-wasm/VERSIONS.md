# Pandoc WebAssembly payload — version log

`pandoc.wasm` is **not committed to this repository.** It is a ~56 MB
published build artifact from Pandoc's own CI, and committing each new
version would add roughly that much to the git history permanently.

What *is* committed is `pandoc-wasm.bin` — the gzipped payload the loader
actually fetches at runtime (~15 MB). GitHub Pages serves files out of the
repository, so this one has to be tracked or the deployed site has nothing
to load.

## Updating to a new Pandoc release

1. Download `pandoc.wasm` from the Pandoc WASM app distribution.
2. Copy it to `pandoc-wasm/pandoc.wasm` (gitignored; local only).
3. Run `pandoc-wasm/compress-wasm.ps1`. It regenerates `pandoc-wasm.bin`
   and verifies the round trip byte-for-byte by SHA-256.
4. Update `WASM_SHA1` in `pandoc-wasm/pandoc.js` to the **sha1 of the raw
   `pandoc.wasm`**. This is not cosmetic: it is the cache-buster in
   `./pandoc-wasm.bin?sha1=…`, and if it is not changed, browsers will keep
   serving the previously cached payload and the upgrade will appear to do
   nothing.
5. Add a row to the table below.
6. Commit `pandoc-wasm.bin` and `pandoc-wasm/pandoc.js`.

## Version history

| Pandoc | Released | raw bytes | raw sha1 | .bin bytes | Installed |
|---|---|---|---|---|---|
| 3.10 | 2026-06-03 | 58,580,800 | `81325b24686ba020293da498958982a8caa7a102` | 16,160,713 | — |
| 3.11 | 2026-08-28 | 59,163,604 | `ea6c0439152ba64cae0978a36d170885813fdd3e` | 16,348,224 | 2026-09-01 |

## Notes on the 3.10 → 3.11 upgrade

Verified before installing, by running the 3.11 binary directly under Node's
WASI implementation:

- **ABI is unchanged.** Identical 30 `wasi_snapshot_preview1` imports and
  identical 7 exports. The `target_features` custom section is byte-identical,
  so the browser feature floor did not move.
- **`wasm/pandoc.js` upstream has zero drift** from the copy this project
  vendored, and still pins `@bjorn3/browser_wasi_shim@0.3.0`. Our three local
  patch blocks (synthetic `xform` device, compressed-payload loader, nested
  virtual-FS directories) carried over untouched.
- **`mathml` is now the default math method** (was `plain`, jgm/pandoc#11751).
  This does not affect the MathJax-device pipelines: `MJX_MATH_LUA` replaces
  every `Math` node with a `RawInline` before the writer runs, so the writer's
  math method has nothing left to act on. Confirmed empirically across html5,
  chunkedhtml, epub and docx — placeholders survived intact in all four, with
  no MathML, OMML or `span.math` leakage.
- **`--math-method` is new; `html-math-method` still works** in defaults files.
  Pandoc's own browser app still sends the legacy key, so there is no urgency
  to migrate. Both the bare-string and `{method, url}` object forms still parse.
- **DOCX still ignores the math method entirely** — always texmath OMML.
- **Format lists barely moved**: input 51 (unchanged), output 76 (was 75; the
  new `t2t` writer arrived in 3.10.1).
- A consequence worth remembering: sending *no* math method used to mean
  plain TeX and now means MathML. Any future "leave math as LaTeX" option must
  send `plain` explicitly.
