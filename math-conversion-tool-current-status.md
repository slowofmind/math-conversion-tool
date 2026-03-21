# Math Conversion Tool — Current Status

## PDF Image Conversion (MuPDF WASM)

The PDF-to-SVG/PNG pipeline is functional with lazy-loaded MuPDF WASM, supporting Off/Prompt/Auto modes via the Media tab.

### SVG Cleanup — Not Yet Implemented

Three of the four known MuPDF SVG output quirks have **not** been ported from `svgCleanup.ts` (in `atc-vector-image-extraction`):

1. **Unfilled paths rendering as black** — MuPDF outputs `<path>` elements without explicit fill; browsers default to `fill: black`, causing shapes that should be transparent/unfilled to appear solid black.
2. **Full-page background rectangles** — MuPDF inserts a white rectangle covering the entire PDF page dimensions, which can obscure content or add unwanted whitespace when the SVG is embedded inline.
3. **Out-of-bounds elements** — Elements that extend beyond the visible page area are included in the SVG output, potentially causing layout issues when embedded.

The fourth quirk (XML declarations/doctypes) **is** handled — by `clean_svg()` in the `embed-images.lua` built-in filter, which strips `<?xml ...?>`, `<!DOCTYPE ...>`, and processing instructions before inline embedding.

**Reference implementation:** `svgCleanup.ts` in `C:\Users\nim022\Desktop\mma-code\atc-vector-image-extraction\`

---

## LaTeXML Integration via GitHub Actions (NEW — initial test)

### Architecture

The browser tool connects to a GitHub Actions workflow that runs LaTeXML inside a Docker container. This enables server-side LaTeX conversion without hosting any infrastructure.

- **Docker image:** `ghcr.io/slowofmind/latexml-pipeline:latest` (TexLive 2026 + LaTeXML 0.8.8)
- **Workflow:** `.github/workflows/latexml-convert.yml` — triggers on push to `pipeline-input/`
- **Repo:** `github.com/slowofmind/math-conversion-tool` (private)

### Flow

1. User clicks "LaTeXML" button in toolbar
2. JS commits `.tex` file to `pipeline-input/` via GitHub Contents API
3. Push triggers the Actions workflow
4. Workflow runs `convert.sh` with `MODE=latexml` in Docker
5. Workflow commits HTML output to `pipeline-output/` (with `[skip ci]`)
6. JS polls workflow status, then fetches `*-mathjax4.html` from `pipeline-output/`
7. Result displayed in preview panel; available for download + SCORM packaging

### Authentication

Requires a GitHub PAT with `repo` + `actions` scopes, stored in `localStorage`. First use prompts for the token. Right-click the LaTeXML button to update the token.

### Files added/modified

- `.github/workflows/latexml-convert.yml` — the Actions workflow
- `pipeline-input/` — JS commits .tex files here (auto-cleaned after conversion)
- `pipeline-output/` — workflow commits HTML results here
- `index.html` Section 12 — ~200 lines of new JS for the integration

### Setup required before first test

1. Push the Docker image to ghcr.io ✅
2. Push the workflow YAML + pipeline folders to `github.com/slowofmind/math-conversion-tool`
3. Enter PAT in the tool on first use

### Known limitations (initial test)

- Latency: ~1-2 minutes vs seconds for Pandoc WASM (expected, inherent to Actions)
- Single-user: no collision handling for simultaneous conversions
- No cleanup of old output files from `pipeline-output/`
- PAT is stored in localStorage (acceptable for small trusted team)
- Only LaTeXML mode implemented; TexLive/PDF compilation button not yet added
- Auxiliary files (images, .bib, .sty) are not yet uploaded alongside the .tex file
