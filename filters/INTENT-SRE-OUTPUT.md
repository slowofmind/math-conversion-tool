# The SRE speech channel on intent output pages

## Current state (stage 2, 2026-11-01)

`mathjax-intent-toggle.lua` (this folder) is added automatically by the
platform for "MathML (+ MathJax)" with an HTML output. **This platform copy is
the master**: edit it here (the extension's generator is retired for it).
Tests: `../js/test-sre-intent.mjs` (`node test-sre-intent.mjs`, cwd `js`).
Full record: `intent-briefing/STAGE2-BRIEF.md` (Accessible-STEM-Project).

What the page gets:
- MathJax 4.1.3 (pinned), with speech and on-screen subtitles on.
- A **translator**: just before MathJax reads each formula's MathML, it turns
  each simple `intent` into hidden `ext-*` attributes, in the browser only
  (the converted file keeps only `intent` and `arg`).
- **ClearSpeak rules** that speak those attributes with words made from the
  concept name: `determinant($a)` on `|A|` is spoken "determinant of A";
  `alternation:infix($x,$y)` "x alternation y"; `_the-golden-ratio` "the
  golden ratio"; any custom name works the same way.
- Left to SRE's normal reading: property-only intents (`:chemical-formula`),
  a number or a nested intent among the operands (`power($b,2)`,
  `norm(difference($a,$b))`), a missing `arg`, a malformed value.
- **MathSpeak is never changed.**
- The speech/MathCAT toggle button, the menu fix and the chemistry-arrow fix,
  as before.

Verifying a page: the console shows `[intent] speech self-test OK` when
translated intents were spoken; "skipped" when the page has no intent, is in
MathCAT mode, or uses MathSpeak; "SPEECH DEGRADED" when the rules did not
reach the speech worker (the page still renders and MathCAT still works).
Checked 2026-11-01 in a real converted page (`intent-briefing/probes/
stage2-platform-sample-speech.txt`); acceptance is the speech strings
[NICHOLAS 2026-11-01], not a listening session.

## History: the original note (2026-08-09)

The text below describes the filter of August 2026 (vocabulary, TeX
commands, `ext-*` baked at conversion). Kept for the record; superseded.

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
