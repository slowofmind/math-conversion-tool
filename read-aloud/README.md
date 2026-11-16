# read-aloud/ — "MathCat TTS" and "MathCat Pregen TTS" for HTML output

Two **Output packaging** options (full Pandoc options view only) that turn a single-page HTML
output made with the **MathML** math setting into a page that reads itself aloud, prose and math,
with highlighting, for sighted students with dyslexia or ADHD. Both work offline once downloaded.
Wiring into `index.html`: `INTEGRATION.md`.

## Contents

1. [The two options](#the-two-options)
2. [What happens when a user converts](#what-happens-when-a-user-converts)
3. [The reader in three pieces](#the-reader-in-three-pieces)
4. [Files](#files)
5. [Updating](#updating)
6. [Testing](#testing)
7. [Licences](#licences)

## The two options

| | MathCat TTS | MathCat Pregen TTS |
|---|---|---|
| Math drawn by | MathJax 4.1.3 (HTML), in advance | same |
| Fonts | MathJax's, cut to the characters the page uses | same |
| Speech made by | MathCAT 0.7.7 travelling in the page (English only) | MathCAT 0.7.7 in the platform, stored in the page |
| Speech settings | the NVDA add-on's defaults, Verbose; a student can change wording and pauses | the same settings, fixed when the page is made |
| Exploring with arrow keys | MathCAT live | stored map of every position and key |
| Size added (worksheet, 43 formulas) | ~1.4 MB | ~0.23 MB |
| Time in the platform (worksheet) | under 1 s | about 12 s |

Reading, highlighting, subtitles and exploring are identical between the two (tested on every
spoken piece and 1,161 key presses).

## What happens when a user converts

<details><summary>Step by step</summary>

1. Pandoc converts as for **Standalone** (stylesheet `standalone.css`, images embedded).
2. `index.html` calls `makeReadAloudPage(html, 'tts' | 'pregen')` from `rd-packager.js`.
3. The packager opens a hidden helper page, `rd-workbench.html` (once per session), so MathJax and a
   second MathCAT never mix with the platform or the proofing tool.
4. In the helper page (`rd-workbench.js`):
   - every MathML element gets a label (`data-atc-id`), every formula a number;
   - MathJax draws each formula as HTML; the labels are copied onto what it draws; the original
     labelled MathML goes into the formula's hidden copy (for screen readers and MathCAT);
   - `rd-fonts.js` finds which characters each MathJax font draws, cuts those fonts with HarfBuzz
     (always keeping the space) and embeds them;
   - **Pregen only:** MathCAT (the platform's `mathcat-wasm/`, this page's own copy) produces each
     formula's speech with bookmarks, adds the structure marks, and tries every key from every
     position; the result goes into the page as JSON (`#atc-rd-mcspeech`).
5. The packager puts the reader block together from `reader/` (see below) and adds it before `</body>`.
6. The page goes to the Code view, the preview and Download.
</details>

## The reader in three pieces

Each reader block is put together at conversion time (`reader/assemble-block.js`); nothing is built
in advance.

| Piece | File | What it does |
|---|---|---|
| **Interface** (replaceable) | `reader/interface-default.js` + `.css` | What the student sees and uses: toolbar and settings, how the sentence, word and formula-part highlights look, subtitles, the testing log, keyboard and click controls. |
| **Shared machinery** | `reader/reader-core.js` | Everything else both versions share: finding sentences and formulas, speaking, timing, which word or part is being spoken, playback, exploring. It announces what is happening; the interface draws it. |
| **Speech source** | `reader/speech-source-mathcat-live.js` (MathCat TTS) or `reader/speech-source-mathcat-stored.js` (Pregen) | What MathCAT says for each formula and where exploring goes. The only piece that differs between the two versions. |

<details><summary>Trying another interface</summary>

Add `reader/interface-<name>.js` and `.css` beside the default ones, then change `DEFAULT_INTERFACE`
in `reader/assemble-block.js` (or pass `{ ui: '<name>' }`). The new interface gets the reader object
and must call `reader.start(...)`; `reader-core.js` lists the announcements it can listen to
(sentence, word, part, subtitle, caption, status, mode, voices, log) and the commands it can call.
Both versions change together. Keep the ids and classes the tests use, or update the tests.
</details>

## Files

<details><summary>Needed by the platform (commit these)</summary>

| Path | Job |
|---|---|
| `rd-packager.js` | The one function the platform calls. |
| `rd-workbench.html`, `rd-workbench.js` | The hidden helper page: MathJax drawing, labels, Pregen's MathCAT run. |
| `rd-fonts.js` | Which characters each font draws; cutting fonts with HarfBuzz; embedding them. |
| `structure-marks.js` | The intro-phrase highlighting rule ("the absolute value of"…), shared by both versions. |
| `reader/` | The reader's pieces and the two block templates. |
| `engine/mathcat-wasm-en/` | MathCAT 0.7.7, English only (`mathcat-wasm.bin`, 0.9 MB), its loader and `BUILD-INFO.json`; `build-en.sh` says how it was built. |
| `vendor/mathjax/` | MathJax 4.1.3: startup, core, MathML input, HTML output, liteDOM, hidden MathML (0.7 MB). |
| `vendor/fonts/mathjax-newcm-font/` | The font's data: sizes and which file holds which character (0.75 MB). |
| `fonts-otf/` | MathJax's 105 font files as gzipped OpenType, ready for cutting (2.1 MB); a page fetches only those it uses. |
| `vendor/harfbuzz/` | HarfBuzz's font cutter (0.68 MB). |
</details>

<details><summary>Not needed by the platform (git-ignored: tests, tools, session notes)</summary>

`tests/` (stand-in host page, packager run, reader tests, the comparison between the two versions,
the preview-frame test, `make-blocks.mjs`), `tools/` (`vendor-mathjax.sh`, `make-fonts-otf.py`),
`SESSION-*.md`. Listed in `read-aloud/.gitignore`. A copy lives in the TTS project folder.
</details>

## Updating

<details><summary>After a MathCAT upgrade (the platform's pin)</summary>

Pregen uses the platform's `mathcat-wasm/` automatically. For MathCat TTS, rebuild the English-only
engine with `engine/mathcat-wasm-en/build-en.sh` (it reads the pin from the platform's
`mathcat-wasm/build/Cargo.toml` and runs the platform's own build script), then rerun the tests.
Keep both on the same MathCAT, or the two options will no longer match.
</details>

<details><summary>After a MathJax upgrade</summary>

In a scratch folder: `npm install mathjax@X @mathjax/mathjax-newcm-font@X`, then
`bash read-aloud/tools/vendor-mathjax.sh <scratch>/node_modules` and
`python read-aloud/tools/make-fonts-otf.py <scratch>/node_modules/@mathjax/mathjax-newcm-font/chtml/woff2 read-aloud/fonts-otf`
(needs `pip install fonttools brotli`). Rerun the tests.
</details>

## Testing

<details><summary>Commands</summary>

From the repo root, with Playwright available (set `PLAYWRIGHT_PATH` if it isn't found):

```
python -m http.server 8765                                   # in one window
node read-aloud/tests/run-packager.cjs                       # makes tests/out-tts.html, out-pregen.html
node read-aloud/tests/test-mjfonts.cjs read-aloud/tests/out-tts.html
node read-aloud/tests/test-mcpre.cjs   read-aloud/tests/out-pregen.html
node read-aloud/tests/compare-tts-pregen.cjs                 # the two versions must say and box the same
node read-aloud/tests/test-in-preview-frame.cjs              # both work in a frame like the preview
node read-aloud/tests/make-blocks.mjs [old-tts.html old-pregen.html]   # blocks, or pages with new blocks swapped in
```
The reader tests use a simulated voice (headless browsers have none) and block all network requests.
`compare-tts-pregen.cjs` takes any two pages, so it also compares an old and a new version of one reader.
</details>

## Licences

HarfBuzz: MIT (`vendor/harfbuzz/LICENSE`). MathJax and its font package: Apache-2.0
(`vendor/mathjax/LICENSE`); the font itself derives from New Computer Modern, whose licence should
be confirmed before release. MathCAT: MIT. Everything else here: MIT, as the platform's original work.
