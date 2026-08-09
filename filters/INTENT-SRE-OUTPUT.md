# Adding the SRE speech channel to intent output pages (2026-08-09)

`mathjax-intent-toggle.lua` (this folder) injects into a converted HTML page
everything the SRE/MathJax speech channel needs: a pinned MathJax 4.1.3
script tag, an accessibility config, the intent extension with the six
composed-speech rules and the speech-worker patch, a MathCAT-vs-speech mode
TOGGLE BUTTON, a context-menu positioning fix, and a console self-test.
It is a GENERATED COPY from the mathjax-intent-extension project
(build\build-lua-filter.py) — do not edit here; rebuild there and re-copy.

## How to use it in this platform (no code changes needed)

1. Math rendering method: **MathJax → MathML (HTML)** (the static path).
2. Upload `mathjax-intent-toggle.lua` via the platform's **Lua filters**
   control. User-uploaded filters run BEFORE the internal `_mjx-math.lua`
   device filter — exactly the required order: this filter sees the math
   while it is still LaTeX (collects usage for its per-document vocabulary
   pruning, injects the header), then the device filter converts the math
   to static intent-bearing MathML.
3. Convert. The output page then has BOTH channels plus the toggle:
   - **MathJax speech mode** (default): SRE voices each expression using
     the composed intent phrases (ext-* attributes riding the MathML);
     speech shown as subtitles during keyboard exploration. Needs internet
     (MathJax + speech worker come from the CDN).
   - **Hidden MathML mode** (toggle, or last-used — the mode persists per
     browser via MathJax's own localStorage): screen reader + MathCAT read
     the MathML directly. The intent attributes are NOT rewritten by the
     toggle or by MathJax's assistive-MathML embedding (attribute
     passthrough verified engine-level, 39/39 round-trip).
   - **Offline / CDN unreachable**: the MathJax script simply never runs;
     the page falls back to the raw static MathML — native browser
     rendering + MathCAT still work. Graceful by construction.

## Verifying a page

Open the browser console: `[intent] speech self-test OK` means composed
speech is live (the self-test seeds its expected phrases from the ext-open
attributes in the static MathML). "self-test skipped — hidden-MathML mode"
is normal in MathCAT mode. "SPEECH DEGRADED" = the rules did not reach the
worker (CSP-blocked worker or CDN drift) — the page still renders and
MathCAT still works.

## Status / caveats

- This static-MathML + SRE combination is the one leg verified only at
  ENGINE level (Node round-trip, 39/39), not yet heard in a browser — test
  a converted page with NVDA before presenting it live.
- The same filter also serves the fully-verified fallback: skip the device
  path (method "MathJax 4"-style, LaTeX kept in the page) and the filter
  provides the complete dynamic pipeline exactly as tested with desktop
  Pandoc. If the static demo misbehaves, fall back to that.
- Alternative math methods (KaTeX etc.) + this filter = unsupported.
