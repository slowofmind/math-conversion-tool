# Blank Answer Spaces — Sub-Project Research Record

**Status: OPEN sub-project.** Temporary fix adopted (see "Interim decision");
full solution designed but pending verification tests. This problem is
general — any course material with fill-in-the-blank commands (`\fitb`/`\cfitb`
in Math Ma, likely analogues in other courses) needs the same answer.

**Origin:** Math Ma Fall 2025 profile work, 2026-08-01/02. See
`ma2025-conversion-disposition.md` entries 6-7 (fitb family) which reference
this document.

---

## The problem

A "blank to be filled in" must survive four renderings: visual HTML (sighted
students), speech via NVDA+MathCAT (the AT stack this project targets),
refreshable/embossed braille (Nemeth), and DOCX. The blank appears in three
placements in the corpus (ws\ tree, instance-level scan 2026-08-02, script
`%TEMP%\classify-fitb.py`, output `%TEMP%\fitb-class.txt`):

- 112 of 165 (68%): entire \fitb inside math delimiters ($..$, \[..\], alignat*)
- 41 (25%): entirely prose
- 12 (7%): hybrid — command in prose, answer contains $..$ fragments.
  For the PROBLEMS profile hybrids collapse into prose blanks (answer deleted);
  they only matter for solutions output, where no blank machinery is involved.

Also: 12 empty-answer instances (paired table-style blanks); optional
[\vphantom] argument twice; widths always brace-free.

## Standards audit (2026-08-02)

1. **W3C 2012 Draft Note "Fill In the Blank with MathML"** (Leas/DAISY,
   Libbrecht, Soiffer): prescribed `class="MathML-Blank"` on an
   `menclose notation="bottom"` over a space element; aural guidance "just say
   blank". STATUS: never advanced past Draft; the class convention is
   implemented NOWHERE in MathCAT (zero references in source). Superseded in
   practice.
2. **MathML 4 `intent`** is the successor. w3c/mathml issue #481 (Soiffer):
   concept name `blank` "tentatively agreed" for fill-in-the-blank; MathCAT
   heuristics in progress.
3. **Already shipping:** MathCAT braille backends match the intent PROPERTY
   `:blank` — Nemeth rule `omission-intent` emits ⠿ (the general omission
   symbol, matching NFB/Nemeth transcription convention that ALL print
   omissions — long dash, underscores, ? — transcribe to the omission symbol);
   parallel rules in UEB (⠬), CMU, Swedish.
4. **menclose was dropped from MathML Core** — never renders in native
   browser math. Irrelevant while rendering via MathJax, but any solution
   should avoid menclose for future-proofing.
5. aria-label on a generic <span> is unreliable/flagged as misuse; robust
   prose patterns are visually-hidden text (sr-only) or a labeled non-generic
   role.

## Empirical results — MathCAT 0.7.5 (built from source, sandbox, 2026-08-02)

Speech = en SimpleSpeak default; braille = Nemeth. Test: 3 + 9 = <blank>.

| Markup | Speech | Nemeth |
|---|---|---|
| 2012 note (class=MathML-Blank, menclose bottom, mspace) | "line on bottom, enclosing space end enclosure" | ⠿ + stray cells |
| bare menclose bottom (MathJax \enclose default) | same verbose noise | same |
| intent=":blank" alone (property) | silent | ⠿ clean |
| intent="blank" alone (concept) | "blank" | messy |
| **mrow intent="blank:blank" wrapping mspace** | **"blank"** | **⠿ clean** |
| mtext nbsp + intent=":blank" | silent | ⠿ clean |

**Winner: `<mrow intent="blank:blank"><mspace width="..."/></mrow>`** —
concept name drives speech, property drives braille, no menclose, visible
line suppliable via CSS class (border-bottom).

## MathJax v4.1.3 default handling of candidate TeX inputs (tex2mml, verified)

| TeX | MathML emitted | MathCAT speech | Nemeth |
|---|---|---|---|
| `\_\_\_\_` | four separate `<mi mathvariant="normal">_</mi>` | **SILENT — blank does not exist for AT** | **dropped entirely** |
| `\rule{6em}{0.4pt}` | `<mspace width height mathbackground="black">` | silent | **⠿ correct** |
| `\underline{\quad\quad}` | munder + horizontal-bar mo | "with line below" | ⠿⠩⠱ (omission + noise) |

Visual: `\_\_\_\_` renders as connected underscore glyphs (acceptable);
`\rule` renders a clean solid line; `\underline{\quad\quad}` a clean underline.

## Interim decision (Nicholas, 2026-08-02 — CONFIRMED)

Temporary, pattern-only fix, zero pipeline changes: **literal `\_\_\_\_`
everywhere**, prose and math alike, for uniformity while the rest of the
profiles are built out.
- Prose blanks: visible; present as characters on refreshable braille;
  announced per reader punctuation settings; plus a per-document convention
  note (candidate: injected via custom Pandoc template variable from
  YAML/-M metadata — verified working).
- Math blanks: visible (connected underscore glyphs) but KNOWN LIMITATION,
  accepted temporarily: AT-invisible — MathCAT speaks nothing and Nemeth
  drops them (verified against MathJax v4.1.3 output + MathCAT 0.7.5).
- Documented alternative if the math gap needs a stopgap before the full
  solution: `\rule{6em}{0.4pt}` (visible line, Nemeth-correct ⠿,
  speech-silent). The full intent-based solution replaces both flavors.
- Implemented in `ma2025-problems-profile.json` (fitb/cfitb → `\_\_\_\_`),
  engine-verified 2026-08-02.

## Full solution design (pending verification)

Profile inserts sentinel/marker → pipeline attaches
`intent="blank:blank"` + a CSS class to an mrow/mspace structure.
Attachment point options: (a) MathJax TeX-side (custom macro/extension, or
v4 intent options — capability unverified); (b) post-tex2mml string/DOM
surgery in the existing platform stage that already rewrites MathML for OMML
(one-line addition, guaranteed floor). Prose blanks: HTML span with
visually-hidden "blank" text (not aria-label on bare span).

## Open verification tracks (required before adopting full solution)

1. **NVDA add-on version check** (Nicholas's machine, via NVDA bridge):
   confirm installed MathCAT add-on speaks "blank" for intent="blank:blank"
   like 0.7.5 does. Expected utterance known.
2. **VoiceOver**: Apple's engine, not MathCAT; almost certainly ignores
   intent today; test on Apple hardware; mitigation = MathJax speech strings.
3. **Visual**: CSS border-bottom on the class across MathJax CHTML output;
   confirm \class survives their pipeline.
4. **DOCX/OMML**: what MML2OMML.XSL does with mspace/mrow/intent and with
   \rule's mathbackground mspace — untested.
5. **Embossed braille via other toolchains** (BrailleBlaster, liblouis/WSL
   route): separate MathML interpretations; may not know intent exists.
   MathCAT-generated braille (live NVDA or batch API) is the verified path.
6. **MathJax TeX-side intent authoring** (v4 capability audit) vs
   post-processing injection.
7. Width fidelity: all blanks currently uniform; print widths 0.22in-4in
   carry meaning (phrase vs number). Sentinel could encode width for the
   full solution (e.g. FITBBLANK:2.5in).

## Reusable artifacts

- MathCAT test harness: sandbox /tmp/blanktest (Rust, mathcat 0.7.5 crate,
  probe list in src/main.rs) — recreate as needed; rules from NSoiffer/MathCAT.
- MathJax tex2mml one-shot: /tmp/mjtest/conv2.mjs (mathjax@4 npm,
  mathjax.init + MathJax.tex2mml).
- Corpus classifier: %TEMP%\classify-fitb.py (math-state scanner; handles
  comments, $/\[..\]/env tracking, brace-aware arg parsing).
