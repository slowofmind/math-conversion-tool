# Session Summary — March 18, 2026
## LaTeXML, BookML, GitHub Actions, and Custom Docker Pipeline

**Context:** Research and implementation session exploring LaTeXML/BookML for LaTeX-to-accessible-HTML conversion, GitHub Actions as a deployment model, and building a custom Docker-based conversion pipeline.

---

## 1. Key Research Findings

### GitHub Actions — How It Works
- GitHub Actions provides temporary Ubuntu VMs ("runners") that spin up on repository events (e.g., `git push`), run instructions from a YAML workflow file, and disappear after the job completes (max 6 hours per job).
- The workflow file lives at `.github/workflows/<name>.yaml` in the repository.
- **Free for public repos** (unlimited minutes). Private repos get 2,000 free minutes/month on the free plan.
- Runners have Docker pre-installed, enabling use of pre-built Docker images containing entire toolchains (TexLive, LaTeXML, etc.).
- Each user's repository runs its own independent pipeline — there is no shared quota or infrastructure between repos.

### Docker Images and Container Registries
- A Docker image is a snapshot of a complete Linux filesystem with software pre-installed. A Dockerfile is the script that creates this snapshot.
- Images are stored on container registries: Docker Hub (`hub.docker.com`), GitHub Container Registry (`ghcr.io`), etc.
- `ghcr.io` is free for public images and integrates with GitHub Actions natively.
- When a GitHub Actions workflow runs, the runner pulls the Docker image, starts it, mounts the repo files, runs the build, and collects output.
- **You don't need Docker installed locally to use GitHub Actions.** Docker is only needed locally for building/testing your own images.

### BookML — Testing Complete
- Successfully tested BookML via GitHub Actions using the standard ~7-line workflow YAML.
- BookML wraps LaTeXML and provides bookdown-style HTML output, SCORM packaging, PDF compilation, and search.
- The BookML Docker image contains TexLive 2021, LaTeXML 0.8.8, Perl, Ghostscript, dvisvgm, and GNU Make.
- Output includes split HTML pages (by section), SCORM packages, and a PDF — all attached to a GitHub Release.
- Supports MathJax 2, 3 (default), or 4 via `\usepackage[mathjax=4]{bookml/bookml}`.
- The `aux-directory` artifact contains useful intermediate files: raw LaTeXML XML, logs, dependency tracking.

### LaTeXML MathML Quality
- LaTeXML produces high-quality Presentation MathML with `<semantics>` wrappers containing both MathML and original LaTeX in `<annotation>` elements.
- Includes `alttext` attribute on `<math>` elements (raw LaTeX as fallback — inert metadata, does not interfere with screen readers).
- Adds invisible operators (`⁢` for multiplication, `⁡` for function application) that help screen reader tools like MathCat infer meaning.
- MathJax reads the **Presentation MathML** (not the LaTeX annotation) for rendering and speech generation — this is the correct behavior since LaTeXML's MathML is more structurally explicit than raw LaTeX.

### SCORM — Relevant for Canvas
- SCORM (Sharable Content Object Reference Model) is an old but still widely used e-learning standard supported by all major LMSes.
- A SCORM package is just a zip file containing HTML content + an `imsmanifest.xml` file.
- **Critical finding:** Canvas blocked JavaScript execution in uploaded HTML files (April 2025 update), breaking MathJax rendering. But **SCORM packages bypass this restriction** — JavaScript (including MathJax) works normally in SCORM-uploaded content. This is a confirmed workaround documented in the Canvas community.
- BookML generates SCORM packages automatically. Our custom pipeline could add SCORM packaging as an optional output.

### TexLive 2025/2026 and Tagged PDF
- TexLive 2025+ includes the LaTeX Tagged PDF project, enabling automatic PDF tagging for accessibility.
- Requires LuaLaTeX + `unicode-math` + `\DocumentMetadata{tagging=on, pdfstandard=ua-2}`.
- LuaMML (loaded automatically) converts math to MathML for embedding in the tagged PDF.
- This is still a work in progress — not all packages are compatible — but functional enough for testing.
- Our custom Docker image uses **TexLive 2026** (full distribution), enabling experimentation with these features.

### GitHub Releases and Privacy
- Releases on private repos are private — only authorized collaborators can see them.
- GitHub Pages on free/Pro accounts are always public; only Enterprise accounts support private Pages.
- Overleaf-to-GitHub sync is one-way — output files don't flow back into Overleaf.

---

## 2. What Was Built

### BookML Test Repository
- Created a test repo on github.com with the standard BookML workflow YAML.
- Successfully ran a conversion of `4-calculus-derivatives.tex` producing HTML, SCORM, and PDF output.
- Output examined and validated — clean conversion, good MathML quality, proper SCORM manifest.

### Custom Docker Pipeline (`latexml-pipeline`)
- **Location:** `C:\Users\nim022\Desktop\mma-code\latexml-pipeline\`
- **Docker image:** `latexml-pipeline:latest` (7.85 GB, built from local TexLive 2026 ISO)
- **Components:** Ubuntu 24.04 + TexLive 2026 (full, no docs/source) + LaTeXML 0.8.8 + Python 3

#### Pipeline Outputs (per `.tex` file)
| File | Description |
|------|-------------|
| `{name}-mathjax4.html` | Standalone HTML with MathJax 4 CDN, CSS inlined, full accessibility |
| `{name}-mathml.html` | Standalone HTML with raw MathML only, no JavaScript, browser-native rendering |
| `{name}.pdf` | Standard PDF via pdfLaTeX (TexLive 2026) |
| `{name}-latexml.log` | LaTeXML conversion log |
| `{name}-latexmlpost.log` | LaTeXML post-processing log |

#### File Structure
```
latexml-pipeline/
  Dockerfile           — Full image definition (TexLive 2026 + LaTeXML, needs ISO to rebuild)
  Dockerfile.dev       — Lightweight rebuild for script changes only (use this for iteration)
  convert.sh           — Conversion script (runs inside the container)
  .dockerignore        — Build context exclusions
  README.md            — Build and usage instructions
  run-pipeline.bat     — Double-click to run conversion (no terminal needed)
  input/               — Place .tex files here
  output/              — Results appear here
  texlive.iso          — MOVED BACK to C:\Users\nim022\Desktop\mma-code\texlive.iso
```

#### How to Run Locally
```bash
cd C:\Users\nim022\Desktop\mma-code\latexml-pipeline

# If convert.sh was changed, rebuild first (takes seconds):
docker build -f Dockerfile.dev -t latexml-pipeline .

# Run the pipeline:
docker run --rm -v "C:\Users\nim022\Desktop\mma-code\latexml-pipeline\input:/source" -v "C:\Users\nim022\Desktop\mma-code\latexml-pipeline\output:/output" latexml-pipeline
```

Or just double-click `run-pipeline.bat`.

#### How to Rebuild the Full Image (only if TexLive/LaTeXML need updating)
1. Move `texlive.iso` back into `latexml-pipeline/`
2. Run: `docker build -t latexml-pipeline .`
3. Move `texlive.iso` back out to reclaim 6.3 GB
4. WARNING: Full rebuild is resource-intensive — see WSL2 limits below

---

## 3. Docker Setup on This Machine

### Installation
- **Docker Desktop 29.2.1** installed on Windows 11
- Uses **WSL2 backend** (WSL 2.6.3 installed during setup)
- AMD64 (x86_64) architecture

### WSL2 Resource Limits (IMPORTANT)
The initial Docker build froze the system because WSL2 consumed all available RAM (16 GB total). A `.wslconfig` file was created to prevent this:

**File:** `C:\Users\nim022\.wslconfig`
```ini
[wsl2]
memory=6GB
processors=2
swap=2GB
```

This caps Docker/WSL2 at 6 GB RAM and 2 CPU cores, leaving the rest for Windows. **Do not delete this file** — without it, Docker will grab all resources during intensive operations.

After changing `.wslconfig`, WSL must be restarted:
```bash
wsl --shutdown
```
Then restart Docker Desktop.

### Docker Resource Saver
- Enabled in Docker Desktop settings (5-minute timeout)
- Reduces CPU/memory when no containers are running

### Disk Space Management
The Docker image uses ~7.85 GB. Key commands:
```bash
docker system df              # Check Docker disk usage
docker system prune -a        # Remove all unused images (reclaims all space)
docker images                 # List images and sizes
docker image rm <name>        # Remove a specific image
```

The TexLive ISO (`texlive.iso`, 6.32 GB) is at `C:\Users\nim022\Desktop\mma-code\texlive.iso` — needed only for full image rebuilds.

---

## 4. Next Steps

### Immediate (next session)
1. **Push the Docker image to `ghcr.io`** — requires creating a GitHub Personal Access Token, then `docker login ghcr.io` + `docker push`
2. **Create a GitHub Actions workflow** in a shared repo that uses the custom image for automated conversion on push
3. **Make it easy for non-Git colleagues** — explore options like a web form, shared folder, or batch upload tool

### Short-term improvements
4. **SCORM packaging** — add as an optional output variant (trivial: manifest XML + zip)
5. **Styling improvements** — LaTeXML's default CSS is functional but plain; consider custom CSS or selective BookML styling
6. **Tagged PDF experiments** — add a LuaLaTeX variant using TexLive 2026's tagging features for PDF/UA-2 output
7. **Test with messier faculty documents** — real-world files with exotic packages, images, custom macros

### Longer-term possibilities
8. **Canvas integration testing** — upload MathML variant directly, SCORM variant via SCORM import, compare behavior
9. **MathJax 4 offline variant** — for SCORM packages that need to work without internet
10. **SRE pre-generation** — Node.js step to pre-compute speech strings for offline accessibility
11. **Integration with the Pandoc WASM tool** — "Download as SCORM" button, or linking to GitHub Actions pipeline

---

## 5. Key Technical Decisions Made

| Decision | Rationale |
|----------|-----------|
| Custom pipeline without BookML | BookML's multi-page, Makefile-driven approach conflicts with single-page standalone goals; easier to call LaTeXML directly |
| TexLive 2026 full distribution | Faculty documents use unpredictable packages; minimal installs cause constant missing-package failures |
| ISO-based Docker build | Avoids 6+ hour network download; local ISO installs in ~15 minutes |
| Two HTML variants (MathJax 4 vs raw MathML) | Enables A/B comparison of accessibility approaches; raw MathML useful for Canvas upload testing |
| `Dockerfile.dev` for iteration | Avoids needing the ISO present for every script change; rebuilds in <1 second |
| MIT CTAN mirror | Fastest mirror for Boston/Harvard area (used in the network-download Dockerfile variant) |

---

## 6. Reference: BookML GitHub Actions Workflow

For comparison, the standard BookML workflow (tested and working in the `latexml-testing` repo on github.com):

```yaml
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Compile with BookML
        uses: vlmantova/bookml-action@v1
```

The Node.js 20 deprecation warning on the Actions page is informational only — it means `actions/checkout@v4` and `actions/upload-artifact@v4` will need updating to v5+ before June 2, 2026. This is Mantova's responsibility for the BookML action, and ours for any custom workflow.
