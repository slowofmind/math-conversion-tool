# Accessible STEM Conversion Tool

A browser-based tool, developed at Harvard's Assistive Technology Center,
that converts faculty-authored LaTeX course materials into accessible HTML,
DOCX, and (eventually) EPUB. The emphasis is on math accessibility: output
carries MathML that works with screen readers and other assistive technology.
The tool runs almost entirely client-side — the conversion engine (Pandoc,
compiled to WebAssembly) executes in the user's browser — with optional
remote pipelines (LaTeXML, LuaLaTeX) reached through GitHub Actions for
files that need deeper LaTeX support or PDF output.

The project combines original work with several open-source components. The
two inventories below separate them; `THIRD-PARTY-NOTICES.md` gives the full
license detail for everything not written here.

## Original work in this repository

Everything below was created for this project and is offered under the MIT
License (see `LICENSE`):

- `index.html` — the single-page application itself: interface, conversion
  orchestration, error-log-to-editor highlighting, find-and-replace tooling,
  preview, and the built-in cleanup/preprocessing profiles for course
  materials (with `ma2025-problems-profile.json` and
  `ma2025-solutions-profile.json` as the canonical profile sources)
- The Lua filters (in `filters/` and embedded in `index.html`) — list
  formatting, image path resolution, image embedding, and related
  format-specific handling
- The custom math handling for DOCX output — `math-conversion/mml-condition.js`
  and `math-conversion/mml-isotopes-browser.js`, which condition MathML
  before conversion to Word's math format
- The SCORM packaging option for HTML output (for LMS upload)
- The Overleaf transfer bookmarklet, its installation page
  (`bookmarklet-install.html`), and the development harness
  (`dev-overleaf-harness.html`)
- The GitHub Actions workflows (`.github/workflows/`) that drive the remote
  LaTeXML and LuaLaTeX pipelines
- Local patches to the third-party `pandoc.js` wrapper (documented at the
  top of that file)
- The sample LaTeX files in `samples/`

## Third-party components

Included in this repository:

- **Pandoc** (GPL-2.0-or-later) — the core conversion engine, as a
  WebAssembly binary in `pandoc-wasm/`, with its MIT-licensed `pandoc.js`
  wrapper
- **MuPDF / MuPDF.js** (AGPL-3.0, dual-licensed by Artifex) — in
  `image-processing/`; converts PDF figures to web-usable images
- **CodeMirror 6** (MIT) — the in-browser code editor, bundled in
  `codemirror/`
- **MathJax v4** (Apache-2.0) — bundled in `math-conversion/` for
  TeX-to-MathML conversion, and loaded from CDN by generated HTML output
- **MML2OMML.XSL** — MathML-to-Word-math stylesheet in `math-conversion/`;
  its license could not be verified, so it is specifically flagged for
  review in `THIRD-PARTY-NOTICES.md`. A Microsoft Q&A thread indicates the
  companion stylesheet shipped with Office originated in the open-source
  TEI XSL stylesheets project and is generally considered redistributable
  under that project's license; the notices file discusses how far that
  extends to this file.

Used remotely or planned, but not distributed here: **LaTeXML** (public
domain, NIST) and **latexml-oxide** (CC0) as alternate conversion engines
run in Docker via GitHub Actions; **TeX Live** (aggregate of free licenses)
inside those Docker images; and **BusyTeX via texlyre-busytex**
(AGPL-3.0-or-later), planned for future in-browser PDF compilation.

## Licensing

Original work: MIT. Because the repository includes GPL- and AGPL-licensed
components, the combined work as distributed or hosted is governed by those
copyleft terms (in practice AGPL-3.0, the strongest present). See
`THIRD-PARTY-NOTICES.md` for the component-by-component inventory and a
fuller summary.

## Status

A working proof of concept, currently used for internal testing at Harvard.
The goal is a release for general use by Harvard faculty and staff, with the
possibility of sharing the code publicly beyond Harvard so that other
institutions and the broader accessibility community can use and build on
it. Interfaces, file layout, and component choices are still changing.
