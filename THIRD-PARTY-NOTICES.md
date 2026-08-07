# Third-Party Notices

This repository combines original work (see `LICENSE`, MIT) with third-party
open-source components. This file inventories every component that is not
original to this project, its license, and whether it is physically included
in this repository or only accessed as an external service.

Nothing in this file is legal advice; license identifications below were
verified against each project's published licensing as of August 2026 and
should be confirmed by counsel.

## Components distributed in this repository

| Component | Location in repo | License | Upstream |
|---|---|---|---|
| Pandoc (WebAssembly build) | `pandoc-wasm/pandoc.wasm`, `pandoc-wasm/pandoc-wasm.bin` (gzipped copy of the same binary) | GPL-2.0-or-later | https://pandoc.org / https://github.com/jgm/pandoc |
| pandoc.js (WASI wrapper for pandoc.wasm) | `pandoc-wasm/pandoc.js` | MIT (Copyright Tweag I/O Limited and John MacFarlane) | https://github.com/jgm/pandoc (wasm demo). Carries two local patch blocks, documented at the top of the file. |
| MuPDF / MuPDF.js | `image-processing/mupdf.js`, `mupdf-wasm.js`, `mupdf-wasm.wasm` | AGPL-3.0 (dual-licensed; commercial licenses available from Artifex Software) | https://mupdf.com / https://github.com/ArtifexSoftware/mupdf.js |
| CodeMirror 6 | `codemirror/cm6-editor.js` (bundled build; build inputs in `cm6-src/`) | MIT | https://codemirror.net |
| MathJax (v4, tex-to-MathML build) | `math-conversion/mathjax-bundle.js` | Apache-2.0 | https://www.mathjax.org |
| MML2OMML.XSL | `math-conversion/MML2OMML.XSL` | **Unverified — flagged for legal review; see note below** | Associated with Microsoft Office |

### MML2OMML.XSL — licensing flag

This XSLT stylesheet converts MathML to Office Math Markup (OMML) and is used
in the DOCX output path. It carries no license header. A stylesheet of this
name ships inside Microsoft Office installations, and Microsoft's general
policy does not permit redistribution of Office-installed files absent express
permission. (The reverse-direction stylesheet, `omml2mml.xsl`, has documented
open-source lineage via the TEI stylesheet project; the status of this
MathML-to-OMML direction is less clear.) If redistribution is judged
impermissible, open-source JavaScript MathML-to-OMML converters exist as
replacements, or the file can be excluded and documented as a
user-supplied dependency.

Supporting context: a March 2024 thread on Microsoft Q&A
(https://learn.microsoft.com/en-us/answers/questions/5286296/redistrubution-of-omml2mml-xsl-from-ms-office)
addresses the companion stylesheet. The answer there states that
`omml2mml.xsl` originated in the open-source "XSL stylesheets for TEI XML"
project and that using and redistributing it — including commercially — is
generally considered acceptable under the terms of that project's open-source
license, with documentation crediting the TEI stylesheets recommended as the
way to disclose the dependency. Two caveats keep this flag open rather than
resolved: the thread concerns `omml2mml.xsl` (the OMML-to-MathML direction),
not the MathML-to-OMML file included here, and the reply is a community
answer on a locked thread, hedged with phrases like "most likely," rather
than an official Microsoft licensing statement.

## Components referenced but not distributed in this repository

These are used by remote conversion pipelines (GitHub Actions driving Docker
images hosted elsewhere), loaded from CDNs at runtime, or planned for future
integration. They are listed so the project's full dependency surface is
visible, even though their code does not live in this repository.

| Component | How it is used | License | Upstream |
|---|---|---|---|
| LaTeXML | Remote conversion engine, run inside a Docker image via GitHub Actions in a separate repository | Public domain (work of NIST, US Government) | https://math.nist.gov/~BMiller/LaTeXML/ |
| latexml-oxide | Planned replacement engine for the LaTeXML pipeline (Docker) | CC0-1.0 | https://github.com/dginev/latexml-oxide |
| TeX Live | Inside the Docker images (LaTeXML package support; LuaLaTeX PDF compilation) | Aggregate of free licenses (LPPL, GPL, and others, per package) | https://tug.org/texlive/ |
| BusyTeX via texlyre-busytex | Planned future in-browser PDF compilation (WASM TeX Live) | AGPL-3.0-or-later (derived from busytex, MIT) | https://github.com/TeXlyre/texlyre-busytex |
| MathJax (CDN) | Loaded at runtime by generated HTML output and by the preview pane | Apache-2.0 | https://www.mathjax.org |

## Combined-work licensing summary

Original code in this repository is offered under the MIT License (`LICENSE`),
which is compatible with the GPL and AGPL. Because the repository physically
includes components under GPL-2.0-or-later (Pandoc) and AGPL-3.0 (MuPDF),
distribution or network hosting of the combined work is governed by those
copyleft terms — in practice, the AGPL-3.0 as the strongest of them. Our
understanding, for counsel to confirm: these licenses require that complete
corresponding source be available to users (which public posting of this
repository satisfies) and that copyleft terms be preserved; they do not
prohibit commercial use in themselves. The one component with no identified
license is `MML2OMML.XSL`, flagged above.

Removed, formerly included: the Ace code editor (BSD-3-Clause) was replaced by
CodeMirror 6 and deleted from the repository in August 2026; it remains in git
history prior to that point.
