# Math Ma Fall 2025 — Conversion Disposition

**Purpose.** Working inventory of every custom command and environment used in the
Math Ma Fall 2025 materials, with a *disposition* for each: what it does in the
PDF workflow (default/problems mode and `[sols]` mode), what it should become in
the accessible-conversion workflow, and the exact cleanup-profile pattern that
implements that decision. This document drives the profile-only conversion route
(no `.sty` file supplied to Pandoc); patterns run in the LaTeX cleanup tool
before the Pandoc WASM conversion.

**Sources of truth.** Ma 2025 materials at
`C:\Users\nim022\Desktop\mma-code\000 - Broad range of Math samples\ATC Math Ma Fall 2025 Materials (Copied 02-19-26)\`
(handout.sty 405 lines, workbook.sty, plotstyle.sty, tikzangle.sty, main.tex,
ws\1..7, hw\, workshop\, assessments\). Cross-referenced against
`handout-sty-effects-inventory.md` (April inventory; verified no drift on
problem-related entries, 2026-08-01).

**Profile targets.** Two profiles, stored as JSON in project root until stable:
- `ma2025-problems` — student-facing problem sets: strip authoring tags, keep
  problem content, remove all solutions/instructor content.
- `ma2025-solutions` — solution sets: keep problem and solution content, strip
  tags, remove instructor-only content.

**Standing decisions (Nicholas, 2026-08-01):**
- No reserved-space preservation: all problem-space arguments (`[1in]`,
  `[\vfill]`, etc.) are deleted. Alternative spacing profiles may be explored
  later as separate profiles.
- Solutions profile strips `problem` tags too, accepting the loss of the
  sols-mode italics (weak semantics; heading-based structure is the eventual
  replacement).

**Pattern conventions.** Patterns are given as (mode; opening prefix | anchor |
suffix; closing prefix | anchor | suffix; action). Regex mode = the engine
escapes the ANCHOR to literal but treats prefix/suffix as raw JavaScript regex;
the nesting stack counts the literal anchor strings. Ordering within a profile
matters only where noted (dependent patterns).

**Status legend.** DOCUMENTED (effects verified against source) →
DISPOSED (conversion decision made) → SPECIFIED (pattern written below) →
BUILT (in profile JSON) → VERIFIED (conversion output checked).

---

## 1. `problem` environment — SPECIFIED

**Effects, default mode.** One optional argument (default `0pt`). Begin-side
only records the argument; content passes through with no font change, no
numbering, no title. End-side emits trailing space for student work via
`\pspace`: argument `\vfill` or `\newpage` emitted directly; argument beginning
`\nstretch`/`\stretch` becomes `\vspace{arg}\newpage`; anything else becomes
`\vspace{arg}`.

**Effects, `[sols]` mode.** Argument accepted but ignored (`\pspace` no-op'd,
so no trailing space). Content set in `\problemfont` (italic), restored at end.

**Inner-content effects.** The environment exerts NO scoping influence on
commands inside it: `\fitb`, `\probonly`, `\solonly`, `mc`, `tf`, etc. behave
per the GLOBAL package option, identically inside and outside. Real inner
effects are only: (a) sols-mode italic cascades over inner prose (not math);
(b) end-of-environment space stacks additively with manual `\pspace` calls
inside (census: 1,337 standalone `\pspace` uses corpus-wide); (c) relatives
`\continueproblem{...}` (framed continuation box, problems-only) and `warmup`
(pass-through + trailing `\hrule`) orbit it without changing its behavior.

**Corpus evidence (ws\ tree, 2026-08-01).** 770 `\begin{problem}` instances.
Argument vocabulary is closed: none; plain lengths 0.15in-2.5in; `\vfill`;
`\newpage`; `\vfill\newpage`; `\vfill \newpage` (internal space, ws5-2.tex:131);
`\stretch{n}`; `\nstretch{n}`. Same-line content after the argument EXISTS
(ws1-2.tex:411, ws1-2.tex:449, ws1-7.tex:366, ws1-7.tex:376, ws4-3.tex:218,
ws4-6.tex:77, ws6-5.tex:308, ws6-5.tex:317) — a grab-to-end-of-line suffix
would destroy that content; the bounded bracket group below is required.

**Disposition.** Both profiles: strip begin/end tags AND the optional argument,
keep content. The argument must be consumed by the pattern — under the
profile-only route (no sty), a leftover `[1in]` renders as literal visible text.

**Pattern (identical in both profiles).** Regex mode, matched pair, one pattern
handles argument and no-argument forms:

- opening:  prefix ``  | anchor `\begin` | suffix `\{problem\}(\[[^\]]*\])?`
- closing:  prefix ``  | anchor `\end`   | suffix `\{problem\}`
- action: REMOVE_TAGS (keep content)

Engine notes: anchor is literal-escaped in regex mode (no `\b` hazard); the
stack counts literal `\begin`/`\end` of ALL environments, and proper LaTeX
nesting guarantees the balancing `\end` is ours — confirmed by closing-suffix
verification, with stack-reset recovery if verification fails. The optional
group `(\[[^\]]*\])?` consumes every observed argument form including the
internal-space case, and cannot overrun because no argument value contains `]`.

**Flagged edges (flag-don't-fail).**
- LaTeX tolerates whitespace/newline between `{problem}` and `[`; the adjacent
  regex does not. Zero instances observed in ws corpus; if one appears, the
  begin tag is still removed (optional group matches empty) and the bracket
  text becomes visible — caught in visual review.
- Commented-out block ws1-7.tex:385-391 contains a fully commented
  begin/end pair; stack pairs them with each other, remove-tags edits inside
  the comment. Harmless, verified 2026-08-01.
- Trailing whitespace after `]` (several instances) is outside the match;
  irrelevant.

**Status.** SPECIFIED. Not yet built into profile JSON.

---
## 2. `solution` environment — SPECIFIED

**Effects, default mode.** `\let\solution=\comment` — verbatim's comment
environment. Content is discarded WITHOUT being tokenized (verbatim scan), so
arbitrary/unbalanced content survives authoring.

**Effects, `[sols]` mode.** Renewed: saves font, applies `\solutionfont`
(defined empty — no actual change), emits bold `\textbf{Solution.}` lead-in,
restores font at end.

**Corpus evidence.** 758 `\begin{solution}` instances in ws\ tree.

**Disposition.** Problems profile: REMOVE_ALL (tags + content) — the workhorse
deletion. Solutions profile: EDIT_TAGS — opening tag replaced with literal
`\textbf{Solution.} `, closing tag deleted. Reproduces the print artifact's
lead-in; Pandoc converts `\textbf` natively. Decision (Nicholas, 2026-08-01):
bold lead-in, NOT a heading — solutions appear inside nested lists too often,
and a heading element there would force Pandoc to break list structure.

**Patterns.** Literal mode, matched pair:
- opening: prefix `` | anchor `\begin` | suffix `{solution}`
- closing: prefix `` | anchor `\end`   | suffix `{solution}`
- problems profile action: REMOVE_ALL
- solutions profile action: EDIT_TAGS, opening replacement
  `\textbf{Solution.} `, closing replacement empty.

**Status.** SPECIFIED.

---

## 3. `\probonly{...}` — SPECIFIED

**Effects.** Default mode: identity (content shown). `[sols]` mode: argument
gobbled. Pure mode switch; perfectly mirrored by `\solonly`.

**Corpus evidence.** 74 instances in ws\ tree. Common uses: `\probonly{\vfill}`,
`\probonly{\newpage}`, framed continuation content.

**Disposition.** Problems profile: REMOVE_TAGS (keep content). Solutions
profile: REMOVE_ALL. Note: much probonly content is print-space commands
(`\vfill`, `\newpage`) that Pandoc drops anyway; keeping tags-stripped content
is still correct and harmless.

**Patterns.** Literal mode, matched pair (no regex needed):
- opening: prefix `\probonly` | anchor `{` | suffix ``
- closing: prefix `` | anchor `}` | suffix ``
- problems: REMOVE_TAGS; solutions: REMOVE_ALL.

**Flagged edge (applies to ALL brace-anchored patterns).** The nesting stack
counts every literal brace, including escaped set-notation `\{`/`\}`. Balanced
escaped pairs (the near-universal case) cancel; a lone `\{` would mispair.
Caught in visual review.

**Status.** SPECIFIED.

---

## 4. `\solonly{...}` — SPECIFIED

**Effects.** Exact mirror of `\probonly`: gobbled in default mode, identity in
`[sols]` mode.

**Corpus evidence.** 96 instances in ws\ tree.

**Disposition.** Problems profile: REMOVE_ALL. Solutions profile: REMOVE_TAGS.

**Patterns.** Literal mode, matched pair:
- opening: prefix `\solonly` | anchor `{` | suffix ``
- closing: prefix `` | anchor `}` | suffix ``
- problems: REMOVE_ALL; solutions: REMOVE_TAGS.

**Status.** SPECIFIED.

---

## 5. `\note{...}` — SPECIFIED

**Effects.** `\newcommand{\note}[1]{}` — argument gobbled in BOTH default and
`[sols]` modes. Displays only under the separate `notes` package option
(framed sans-serif box with its own math version). Content is instructor
commentary: teaching intentions, pacing notes, what staff hope students
realize.

**Corpus evidence.** 312 instances in ws\ tree.

**Disposition.** REMOVE_ALL in BOTH profiles. Highest-stakes deletion in the
system — instructor commentary must never leak into student-facing output.
Designated first visual spot-check target during conversion testing.

**Patterns.** Literal mode, matched pair:
- opening: prefix `\note` | anchor `{` | suffix ``
- closing: prefix `` | anchor `}` | suffix ``
- both profiles: REMOVE_ALL.

**Flagged edge.** Multi-paragraph and math-bearing note content observed
(ws1-7.tex:397); the brace stack handles nested braces. Same escaped-brace
caveat as entry 3.

**Status.** SPECIFIED.

---
## 6. `\fitb[blank]{width}{answer}` — BUILT (temporary blank treatment)

**Effects.** Underlined parbox of the given width. Default mode: shows the
optional placeholder (default: a space) — a blank for student work. `[sols]`
mode: shows the answer, bold in text (`\textbf`), bold-math (`\bm`) inside
math — the command checks `\ifmmode`.

**Corpus evidence (instance-level scan, `%TEMP%\classify-fitb.py`).**
142 `\fitb` + 23 `\cfitb` = 165 instances (earlier findstr count of 123 was
LINES, not instances — multi-blank lines hid the rest). Placement: 112 (68%)
entirely inside math delimiters; 41 (25%) prose; 12 (7%) hybrid (command in
prose, answer contains $..$ — collapses to prose for problems output since
the answer is deleted). 12 empty-answer instances (paired table-style
blanks). Widths always simple brace-free lengths; optional arg used twice
(both \vphantom print-spacers, safely dropped). Answers are brace-nested
math in the majority of instances; nesting depth ≤ 2 observed.

**Blank treatment.** See `blank-answer-spaces-subproject.md` (separate
sub-project: standards audit, MathCAT/MathJax empirical results, full
intent-based solution design, open verification tracks). INTERIM DECISION:
literal `\_\_\_\_` everywhere; math-mode blanks are AT-invisible — accepted
temporarily, documented there.

**Patterns (regex mode, matched pair).**

Problems profile — answer consumed into the opening tag (Nicholas's
suffix-grab design), whole construct becomes underscores:
- opening: prefix `\\fitb(\[[^\]]*\])?\{[^{}]*\}` | anchor `{` |
  suffix `(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*`  (depth-3
  nested-brace grab; deeper answers fail to match and survive visibly —
  flag-don't-fail)
- closing: anchor `}`
- EDIT_TAGS: opening → `\_\_\_\_`, closing → (empty)

Solutions profile — answer kept as content, underlined:
- opening: prefix `\\fitb(\[[^\]]*\])?\{[^{}]*\}` | anchor `{` | suffix ``
- closing: anchor `}`
- EDIT_TAGS: opening → `\underline{`, closing → `}`
- repeatUntilStable: true (content kept could theoretically contain nested
  instances)

**Flagged edges.** Empty answers → problems: underscores (correct);
solutions: `\underline{}` (invisible; author supplied answer via adjacent
\solonly — acceptable). Answers containing `]` (interval notation) are
immune — the brace-anchored region never consults brackets.

**Status.** BUILT into `ma2025-problems-profile.json` /
`ma2025-solutions-profile.json`; engine-verified (17/17 profile checks,
`%TEMP%\profile-tests.mjs`). Conversion output check pending.

---

## 7. `\cfitb[blank]{width}{answer}` — BUILT

Identical to `\fitb` but centered; 23 instances. No pattern collision:
`\fitb` is not a substring of `\cfitb` (regex prefixes start at the
backslash). Same pattern pair as entry 6 with `\\cfitb` prefix. `\mfitb`
(alias) has ZERO ws-corpus uses — no pattern.

**Status.** BUILT; same verification.

---

## Build log

**2026-08-02 — Profiles v0 created:** `ma2025-problems-profile.json`,
`ma2025-solutions-profile.json` (project root; envelope formatVersion 1.0,
importable via the cleanup tool's profile import). Entries 1-7. Pattern
order in each profile: note → solution → solonly/probonly (mode pair) →
problem env → fitb → cfitb. `repeatUntilStable` enabled on content-keeping
patterns (problem env both profiles; probonly problems; solonly, fitb,
cfitb solutions) as nesting insurance — count-based termination, no
wrapping hazard. Corpus nesting of `problem` NOT observed (ws6-3:146-153
is sequential, verified); the flag is defensive.

**2026-08-02 — Engine bug found & fixed during profile verification**
(`verifyClosingPattern`, index.html): in regex mode the closing tag span
used the regex SOURCE length for prefix/suffix instead of the MATCHED
length — a regex closing suffix like `\{problem\}` (source 11, match 9)
over-consumed 2 characters, eating the newline + backslash of whatever
followed (`\newpage` → `newpage`). Fixed to measure the actual regex match
on both sides. Re-verified: 29/29 engine assertions
(`%TEMP%\engine-tests.mjs`) + 17/17 profile checks
(`%TEMP%\profile-tests.mjs`). NOTE: index.html change is uncommitted —
Nicholas to commit. Known remaining quirk (pre-existing, unchanged): regex
closing prefix/suffix verification uses a 50-char window; closing tags
whose regex match would exceed 50 chars will fail verification.

---
## 8. Multiple-choice item family: `\circleitem`, `\plainitem`, `\maybecircle` — BUILT

**Effects.** A boolean-relay reveal system. `\circleitem` sets `doCircle`,
emits `\item`, resets; `\plainitem` = `\item` with flag off. `\maybecircle
[cond]{content}` (cond defaults to the flag) = `\probonly{content}` +
`\solonly{ ovalbox around content if cond (math-aware, negative hspace to
hug it) else content }` — i.e. problems: plain; sols: the correct choice's
label circled, mimicking hand-grading. Mode-switches entirely THROUGH
probonly/solonly internally (no [sols]-block override needed).

**Corpus evidence.** ONE live site in ws/hw/workshop: ws2-2.tex:378-382
(squash problem) — `\begin{enumerate}[label=\protect\maybecircle{\Alph*.}]`
with 3 `\plainitem` + 1 `\circleitem`. The `\maybecircle` lives in the
enumerate LABEL SPEC (state-carried answer key — see standing note below).

**Disposition & patterns (single-string, literal, both profiles unless noted).**
- `\begin{enumerate}[label=\protect\maybecircle{\Alph*.}]` →
  `\begin{enumerate}[label=\Alph*.]` (both profiles; Pandoc maps the clean
  enumitem spec to upper-alpha list numbering).
- `\plainitem` → `\item` (both profiles).
- `\circleitem` → problems: `\item`; solutions: `\item \textbf{(correct)} `
  (Nicholas, 2026-08-02: textual marker for now; long-run idea — filter +
  labelling so "correct" is announced first/findable by screen readers, plus
  CSS mimicking the visual circle for readers who benefit from visual cues).

No general `\maybecircle` pattern: zero uses outside the label-spec site;
deferred to the exam-merge revisit.

**Status.** BUILT (see build log).

---

## 9. Assessment constructs with ZERO corpus uses — DOCUMENTED, NO PATTERN

`mc` env, `tf` env, `\tfheading`, `choices` env, `\maybebubble`: all zero
uses in ws/hw/workshop AND zero in Exam 1's own tex files. They are the
package's full assessment repertoire carried forward across sty
generations, dormant in this corpus. `choices` is `\let` to comment with NO
sols override — content discarded in every PDF mode (vestigial).

Effects on record for when they're needed: `mc{letter}` = underlined 0.5in
answer box (blank in problems, bold letter in sols) beside a minipage
question body. `tf{True/False}` = parses first char T/t into a boolean,
renders two `\maybebubble`s in columns measured to the words "True"/"False"
(empty ○○ in problems, one filled ● in sols) under `\tfheading`'s header
row — a table faked with parboxes. `mc`/`tf` are per-question two-column
LAYOUTS, not list constructs.

**Status.** DOCUMENTED. Patterns to be designed at exam-merge time.

---

## Standing notes

**Exam-sty merge (target: 1-2 profiles per course/course group).** Exam 1's
local 223-line handout.sty is a sibling: same vocabulary, same \comment
tricks, same DeclareOption mode architecture; its [sols] solution renewal
emits exactly the `\textbf{Solution.}` lead-in this profile uses.
Enumerated divergences for the merge: (a) exam `\fitb` is TWO-argument (no
optional placeholder) — current regex already tolerates it (bracket group
optional); (b) exam `\maybecircle` is one-argument with a sticky boolean
(no reset in `\circleitem`); (c) REAL CONFLICT: `\answer{}` = identity in
workbook sty but `\solonly{bold}` in exam sty — 3 usage sites in
ws/hw/workshop to inspect before resolving. General taxonomy for future
corpora: ARGUMENT-carried answer keys (mc{B}, tf{T}, fitb{w}{ans}) convert
mechanically; STATE-carried keys (boolean relays through label specs) need
bespoke rewrites — prefer argument-carried in faculty guidance.

**REVISIT BEFORE INITIAL RELEASE — layout/grouping fidelity (Nicholas,
2026-08-02).** General principle: exact PDF layout matching is a non-goal
(e.g. no need to reserve blank answer space in problem sets). BUT where
content is GROUPED in ways that help sighted students orient, track
content, find answers, and follow faculty instructions — e.g. mc/tf answer
zones beside question bodies, tf's aligned True/False columns, boxed or
framed groupings — it is worth considering matching some layout aspects via
CSS or simple HTML. Likely beneficial for students with executive-function
or working-memory issues. The assessment cluster (entries 8-9), the blank
sub-project, and the framed/highlight constructs (workbook.sty, pending)
are the main candidates. Revisit as a pass over the whole profile before
initial release.

---
## Corrections to entries 8-9 (2026-08-02, second corpus pass)

A findstr quirk invalidated the first pass: `/s` with MULTIPLE path-qualified
filespecs silently searches only the first — whole-tree single-filespec
counts are authoritative. Re-verified: entry 9's zeros (mc, tf, tfheading,
choices, maybebubble) HOLD whole-tree, as do learningCheck/Example/wsplan.
Entry 8's counts were wrong: `\maybecircle` = 12 (not 1), `\circleitem` = 2,
`\plainitem` = 6; extras in Exam 1 practice files. Two usage idioms exist:

1. **Label-spec** (2 sites): ws2-2.tex:378 uses `enumerate`,
   e1practice1.tex:795 uses `altenumerate` — same bracket text, different
   env. The exact-string pattern was replaced with a regex single-string
   matching only the option text `[label=\protect\maybecircle{\Alph*.}]` →
   `[label=\Alph*.]`, environment-agnostic. (Both profiles.)
2. **Inline choices** (10 instances, e1practice3.tex): hardcoded truth
   tests — `\maybecircle[1=1]{correct choice}` / `\maybecircle[0=1]{wrong}`.
   Argument-carried key. Patterns (regex matched pair): problems — generic
   `\\maybecircle(\[[^\]]*\])?` | `{` ... `}` REMOVE_TAGS (keeps choice
   text, drops wrapper+condition). Solutions — ordered pair: (a)
   `\\maybecircle\[1=1\]` EDIT_TAGS closing → ` \textbf{(correct)}`
   (Nicholas 2026-08-02: marker AFTER text for inline flow, vs BEFORE for
   \circleitem list items); then (b) the generic REMOVE_TAGS for the rest.

---

## 10. `grading` environment — BUILT

**Effects.** Default: `\comment` (discarded, unparsed). Under the dedicated
`grading` package option: blue tcolorbox headed `\textbf{Grading Notes.}` —
per-problem instructions for TF/CA graders.

**Corpus.** 191 instances — the highest-volume construct after `solution`:
13 problem-set files (hw\PS01-15) + e1practice3. PS files cannot convert
cleanly without this pattern.

**Disposition.** REMOVE_ALL in BOTH profiles (grader-facing layer).
Literal matched pair on `\begin`/`\end` + `{grading}`.

---

## 11. `workshop` and `wsplan` environments — BUILT

**Effects.** `workshop`: default comment; under the `workshop` option a
yellow tcolorbox headed `\workshopnote` ("CA Notes.") — facilitator layer.
`wsplan`: default comment; under `wsplan` option a gray colorbox — session
planning layer.

**Corpus.** workshop: 22 instances (hw\PS02/04/06 + all three
workshop\Workshop0N.tex). wsplan: ZERO whole-tree (defensive pattern only).

**Disposition.** REMOVE_ALL in BOTH profiles, both environments.

---

## 12. `solutiononly` environment — BUILT (disposition corrected mid-work)

**Effects.** Default: comment (hidden). Under `sols` AND `solsonly`
options: pass-through — content DISPLAYS in solution documents. This is
answer-key commentary, the environment-shaped sibling of `\solonly{}` —
NOT an instructor-only layer (initial mis-grouping corrected same day).

**Corpus.** 3 instances, all hw\PS04.tex.

**Disposition.** Problems: REMOVE_ALL. Solutions: REMOVE_TAGS (keep
content).

---

## 13. `learningCheck` trio and `Example` — DOCUMENTED, NO PATTERN (zero uses)

**learningCheck / learningCheckMC / learningCheckEssay.** All three are
empty pass-throughs by default; ONLY plain `learningCheck` is `\let` to
comment under `[sols]`; the MC/Essay variants are never overridden and no
option styles any of them. So `learningCheck` has INVERTED logic relative
to the rest of the package: content appears in the PROBLEMS build and is
REMOVED from the SOLUTIONS build — the package's sole problems-build-only
construct. Inferred intent (name + mechanics; zero uses across ALL courses
in the broad-samples tree, so intent is inference not observation):
student self-assessment prompts that would be noise in an answer key.
FUTURE-COURSE WARNING: a copy-pasted "remove everything odd" profile would
wrongly delete learningCheck content from PROBLEM SETS if a course uses it
— the correct dispositions are problems REMOVE_TAGS / solutions REMOVE_ALL.

**Example.** `\let` to comment then immediately renewed (the same
define-then-renew idiom as `problem`) to an ALWAYS-ON numbered heading:
`\refstepcounter{equation}` + bold "Example N." + content + `\exend`.
Not mode-switched at all, and it SHARES the equation counter — examples
interleave numbering with displayed equations and are `\ref`-able. Zero
corpus uses. When live in another course: keep content in both profiles;
the heading + shared-counter semantics need thought (Pandoc won't
replicate the counter interleave).

**Framing note.** The package's real axes are DOCUMENT TYPES, not
audiences: every construct declares which builds it appears in (grading
build, workshop build, sols build, problems build). learningCheck is the
lone problems-build-only member.

---

## Build log (continued)

**2026-08-02 — comment family + maybecircle corrections applied.**
Profiles now 15 patterns (problems) / 16 (solutions): added grading /
workshop / wsplan / solutiononly matched pairs, the environment-agnostic
label-spec regex (replacing the exact-string version), and the inline
maybecircle patterns (solutions: [1=1]-marker before generic — ordered
dependent pair). Engine-verified: 17/17 core + 6/6 mc-cluster + 11/11
comment-family checks (`%TEMP%\profile-tests.mjs`). Methodology note for
future corpus scans: findstr /s with multiple path-qualified filespecs
under-searches — always use a single filespec from the tree root.
## 14. `\answer` and `\answeronly` — BUILT (merge conflict DISSOLVED)

**Effects.** Workbook sty: `\answer{#1}` = identity always; `\answeronly
[1]{}` = gobbled always. Exam sty: `\answer` = `\solonly{bold}`. BUT: every
assessment file that uses `\answer` carries its own preamble
`\renewcommand{\answer}[1]{#1}` (e1practice1/2/3, fit-test,
mepractice1/2/3) — authors overrode exam semantics back to identity per
document. So `\answer` means IDENTITY everywhere it is used in this corpus:
a pure semantic marker wrapping the answer sentence inside solution prose.
The standing-note merge conflict is hereby DISSOLVED (updated from "real
conflict" to "neutralized by per-file renewals"; Pandoc's macro expansion
also handles the renewal lines natively).

**Corpus.** `\answer`: 40 hits = 7 renewal lines + ~30 assessment uses + 3
ws sites (ws5-5.tex:377,402,423, all inside solutions). `\answeronly`: 10,
ALL assessments — short-form answer trailing an explanation
("...is positive. \answeronly{positive}").

**Disposition.** `\answer`: REMOVE_TAGS both profiles (keep content, drop
marker; nested-brace content verified). `\answeronly` (defensive for ws,
live at merge): problems REMOVE_ALL; solutions REMOVE_TAGS.

**Parked for exam merge.** A `noanswer` environment appears in
`\end{noanswer} \answeronly{...}` pairs in practice files — defined in
document preambles, not in either sty. Inspect at merge time.

---

## 15. `problemonly` environment — BUILT

**Effects.** Default `{}{}` pass-through (shows); `\comment` under BOTH
`sols` and `solsonly`. Problems-document-only apparatus.

**Corpus.** 98 instances across ~50 files — nearly every worksheet, most
problem sets, several assessments. Content verified (ws1-1.tex:15-33):
course reminders, "this worksheet is your personal guide" framing,
learning-objectives lead-ins. Genuinely student-facing.

**Disposition.** Problems: REMOVE_TAGS (students need it). Solutions:
REMOVE_ALL (front-matter noise in an answer key; matches print behavior).

---

## 16. `\htitle` and `\stitle` — BUILT (semantic-heading upgrade)

**Effects.** `\htitle{#1}`: centered large bold — visually a heading,
semantically nothing; shown in default AND sols builds; blanked only in
solsonly. `\stitle{#1}`: the mirror — blank except in solsonly builds.

**Corpus.** htitle: 5 sites (Workshop01-03 titles, ws1-1 title, one
mid-document "Test yourself!" in Workshop03). stitle: ZERO.

**Disposition.** `\htitle`: EDIT_TAGS both profiles → `\section*{...}` —
Pandoc emits a real HTML heading, navigable by screen-reader structure
jumps (Nicholas approved 2026-08-02). `\stitle`: defensive REMOVE_ALL both
(neither profile targets solsonly builds).

---

## 17. `\spaceonly` — BUILT (defensive)

**Effects.** Identity by default; blanked under `nospace`. Marks content
existing purely for spacing. **Corpus.** ZERO uses. **Disposition.**
REMOVE_ALL both profiles, per the no-reserved-space decision.

---

## Build log (continued)

**2026-08-02 — mode-pairs cluster applied.** Profiles now 21 patterns
(problems) / 22 (solutions): \answer, \answeronly, \spaceonly, problemonly,
\htitle -> \section*, \stitle. Engine-verified 46/46 total (17 core + 6
mc + 11 comment-family + 12 mode-pairs), including nested-brace \answer
content ($\dfrac{3}{4}$) through the stack matcher and correct
\answer/\answeronly prefix disambiguation. Standing-note update: the
workbook-vs-exam \answer conflict is dissolved (per-file renewals).
## 18. `\pspace` and `\nstretch` — BUILT

**Effects.** `\pspace{arg}` is the package's most conditional construct:
dispatches on the FIRST CHARACTER of its argument (\firstChar trick) —
`\vfill`/`\newpage` inserted directly; `\nstretch` triggers
`\vspace{arg}\newpage` (space + FORCED page break); anything else plain
`\vspace{arg}`. Also fed implicitly by the problem env's optional arg
(entry 1 already drops those) and killed by the nospace option.
`\nstretch` = `\let` alias of `\stretch`, existing solely as the pspace
sentinel. **Corpus.** \pspace 114 standalone calls; \nstretch 88 (as
arguments). **Disposition.** REMOVE_ALL both profiles (spacing and page
breaks; no-reserved-space decision). The three page-break mechanisms in
the package all funnel through \pspace's two branches and \psrnewpage.

---

## 19. `\continueproblem` — BUILT (defensive; disposition set by intent)

**Effects.** `\probonly{\begin{framed} #1 \end{framed}}` — repeats a
problem's text in a framed box when answer space pushes it to a following
page, so students need not flip back (Nicholas's recollection, confirmed
by mechanics AND by e1practice3's manual framed "\emph{Continued from
previous page}" box — the idiom done by hand). **Corpus.** ZERO uses of
the command. **Disposition.** REMOVE_ALL both profiles: print-pagination
duplication is pure noise in reflowable HTML (a screen reader would hear
the problem twice).

---

## 20. `\psreflection` / `\psrnewpage` — BUILT (no-Lua redefinition design)

**Effects & provenance.** Every PS file defines `\psreflection` LOCALLY
(the per-file-definition idiom again). Four textual variants = ONE
semantic definition: identical citation problem + three reflection
prompts verbatim; drift is only the heading word (PS01 "Reflect Back."),
one intro sentence, and the page-break mechanism (\newpage / \psrnewpage
/ commented out). Conditionals: [nocite] suppresses the citation block;
prompts are \probonly-wrapped. The student-facing prompt text lives in
the DEFINITION, not the documents — unreachable by call-site patterns.

**Design (Nicholas-approved 2026-08-02): redefine in preamble, let Pandoc
expand.** Verified: Pandoc natively expands \newcommand with optional
arguments, including blank-line paragraph breaks in the body (end-to-end
sandbox test to HTML: citation list + reading assignment + prompts list
all correct, \S -> §). Five patterns per profile:
1. REMOVE_ALL the in-file definition (pair on the stable prefix
   `\newcommand{\psreflection}[2][]`, stack-grabbing the balanced body;
   robust to other patterns pre-chewing the body since all edits are
   brace-balance-preserving).
2. single-string rename `\psreflection[nocite]{` -> `\psreflectionnc{`.
3. single-string injection of Pandoc-safe + profile-safe replacement
   definitions immediately before `\begin{document}` (plain text +
   itemize; no ifthenelse/problem/probonly/vspace). Problems defs:
   citation block + #2 (reading assignment) + prompts; \psreflectionnc
   variant omits citation. Solutions defs: citation block only
   (\psreflectionnc empty). Injection also lands harmlessly in ws
   subfiles (definitions Pandoc-consumed, never called there).

`\psrnewpage`: NO PATTERN — all 13 hits live inside the removed
definitions; never in document flow.

---

## 21. No-pattern pass-throughs: `framed`, `warmup`, `objectives`, `\shortintertext`

**framed (91 uses) — DELIBERATE pass-through with a semantic finding.**
Census of all 91: 34 learning-objectives boxes ("You should be able
to:"), ~25 definitions/theorems/named rules (Power Rule, Chain Rule,
limit definitions, notation notes, "useful facts"), 6 centered
figure/table boxes, 1 manual "Continued from previous page". Pandoc's
unknown-environment behavior emits <div class="framed"> — the hook for
later styling. NICHOLAS FLAG (2026-08-02): these boxes carry real
semantic weight (reference/orientation content distinct from problem
flow) and likely need SEMANTIC MARKUP, not just CSS. NOT <aside> (content
is central, not tangential). Accessible-textbook consensus (PreTeXt
pattern): container + real heading inside — the \textbf{Power Rule:}
lead-ins are de facto headings, future heading-ification candidates —
plus role="region" with accessible name where the box merits a navigable
landmark (objectives boxes qualify); role="note" for lighter ancillary
boxes. DOCX analogue: bordered paragraph style via Pandoc custom-style.
Folded into the layout/grouping pre-release standing note.

**warmup** (0 uses): pass-through -> div.warmup; closing \probonly{\hrule}
is sty-side, invisible to conversion. **objectives** (0 uses; =
problemonly + \MakeFramed): pass-through in problems (-> div.objectives);
if ever live, solutions needs REMOVE_ALL (inherits problemonly
semantics) — noted, not built. **\shortintertext** (2 uses, BOTH
assessments): a standard mathtools command that this sty reimplements via
\def. VERIFIED in MathJax 4.1.3: both \shortintertext AND \intertext fail
identically (red error mtext + prose mangled to per-letter <mi>); the
mathtools extension does not implement them — Nicholas's prediction
confirmed, my first "OK" reading was a false negative (always inspect
MathML content, not just the error attribute). Replacement pattern
deferred to exam merge; candidate transforms: env-split
(`\end{align*} text \begin{align*}`) or env-agnostic `\text{...} \quad`
(leaning latter for 2 sites). Profile patterns run before Pandoc's
align->aligned rewrite, so either is safe upstream.

---

## Build log (continued)

**2026-08-02 — spacing/structure cluster applied.** Profiles now 26
patterns (problems) / 27 (solutions): \pspace, \continueproblem, and the
three-part psreflection machinery (definition removal, nocite rename,
preamble injection) per profile. Engine-verified 57/57 total (17 core +
6 mc + 11 comment-family + 12 mode-pairs + 11 spacing/structure),
including: definition removal robust to interior mutation by earlier
patterns; plain \psreflection calls preserved for Pandoc expansion.
End-to-end sandbox verification: injected definitions through real
Pandoc -> correct HTML (citation list, expanded reading assignment,
prompts list, paragraph breaks inside macro bodies, \S -> §).
handout.sty content constructs are now COMPLETE; remaining: internals
closeout (no-pattern bookkeeping), then workbook.sty.
## 22. handout.sty internals closeout — NO PATTERNS (bookkeeping)

Machinery that never appears in document text (or only via vocabulary
already dispositioned), requiring no patterns:

- **Package loads**: verbatim (source of the \comment trick), calc,
  ifthen, bm, tcolorbox (+breakable), framed, fancybox,
  wasysym[nointegrals].
- **Dispatch/state**: \firstChar + \@firstchar (argument sniffing for
  \pspace), \probspace / \problemspace / \probspaceFirstChar (problem-arg
  relay), \@fitbans / \@fitbblank (fitb scratch), doCircle / doBubble /
  answerTrue booleans, \@twidth / \@fwidth (tf column measurement),
  \cornersize, \framemargin, \currentbgcolor (white; swapped inside
  grading/workshop boxes).
- **Font hooks**: \problemfont (italic — why [sols] builds italicize
  problem statements), \solutionfont, \tffont (both empty).
- **handout@showsols boolean**: set by [sols]; no consumer inside
  handout.sty itself — check workbook.sty for consumers.
- **Own \shortintertext \def** (see entry 21), \sfdefault -> cmbr, and
  the notes-option math-version machinery.
- **Options**: nospace, sols, showprobonly, solsonly, grading, wsplan,
  workshop, notes. Profile correspondence: problems profile = default
  build; solutions profile = [sols] build. solsonly is a THIRD build
  flavor (no problem statements; \stitle instead of \htitle) that no
  current profile targets — a possible future third profile if faculty
  ever request solutions-only documents.

handout.sty is COMPLETE: entries 1-22 cover every construct.

---

## 23. Color-in-math speech findings — EMPIRICAL (MathCAT 0.7.5 harness)

Question: can the `intent` attribute make a screen reader announce
"blue box" for colored/boxed math? Verified via the blanks-work rust
harness (libmathcat 0.7.5, Rules dir, Nemeth preference set).

Terminology first: `\boxed` is the LaTeX (amsmath) command; MathJax v4
maps it to the MathML element `<menclose notation="box">`. There is no
"boxed attribute." `\textcolor` in math maps to
`<mstyle mathcolor="...">`. (Both shapes sandbox-verified against
MathJax 4.1.3 tex2mml, color extension loaded.)

Probe results (speech / Nemeth):

1. menclose box alone -> "box, enclosing u squared end enclosure" /
   enclosure indicators present. Plain \boxed (201 corpus uses) is
   already fully announced with zero work.
2. menclose + mathcolor inside -> IDENTICAL speech to (1).
   **mathcolor is completely silent to MathCAT.** Color alone carries
   zero information to AT — empirical confirmation of the WCAG 1.4.1
   exposure for the substitution-tracing palette.
3. menclose + intent="blue-box($c)" (arg ref to content) ->
   "blue box of u squared". Unknown intent concept names are spoken
   as-is, hyphen -> space, function-style. THIS WORKS.
4. menclose + intent="blue-box" (bare, no arg) -> speaks ONLY
   "blue box" — content lost. The argument form is REQUIRED.
5. mstyle mathcolor alone -> "u squared". Silent, per (2).
6. mrow intent="blue($c)" with no menclose -> "blue of u squared".
   intent can annotate color on any grouping, box not needed.

Caveats: (a) intent replaces the default enclosure phrasing (no
"end enclosure") — acceptable. (b) Nemeth output is unchanged by
intent in every case — intent is speech-only per spec; braille box
indicators come from menclose structure, and color never surfaces in
braille at all. (c) This is MathCAT behavior (the engine in NVDA, our
primary AT target); other AT may not honor intent yet. (d) MathML Core
DROPPED menclose — browsers' native MathML won't draw the box, but our
HTML pipeline renders via MathJax so visuals are safe; the DOCX path
(MML2OMML.XSL -> OMML m:borderBox?) needs its own check, flagged for
the color-semantics pass.

Injection point if we pursue this: MathJax tex2mml does not emit
intent from \textcolor. The natural home is our existing client-side
MathML rewrite stage (conditionForOmml / rewriteIsotopes layer):
detect mstyle mathcolor=X and add intent="X($content)" mechanically.
Parked under the color-semantics sub-project — do not build unprompted.

---

## 24. \version — REMOVE_ALL both profiles (workbook.sty scope; ws6-5 only)

**What it is**: a course-variant selector. Three sites, all in
ws\6\ws6-5.tex solution blocks (whole-tree count 3): passages tagged
{1a} and {Mb} carrying alternative wordings — the Mb variants add
closed-interval endpoint reasoning and a 7-point critical-point list
(with \boxed answer); the 1a variant carries the 5-point \boxed list.
Course structure (Nicholas): Math Ma + Mb together cover Math 1a's
single-semester content across a year (1b follows 1a in spring). The
group authors content jointly and reuses pieces across courses; the
BASE text without either variant is the simpler Ma version — the
workbook is officially written for Ma.

**Live authoring error — FLAG TO FACULTY**: \version is defined
nowhere in this snapshot. The compiled solutions PDF therefore shows
garbled output at all three sites: undefined control sequence in
nonstop mode drops the command name and typesets the remaining
groups, so BOTH contradictory boxed answers plus stray literals
"Mb"/"1a" appear inline. One-line fix on the authoring side.

**Decision (Nicholas)**: remove command + tag + content for ALL tags,
via an EXPLICIT profile pattern rather than relying on Pandoc's
natural destruction — conceptually cleaner, and prevents the skipped
content from surfacing in Pandoc's log. Equivalence verified anyway:
Pandoc 3.10's unknown-command path (getRawCommand) grabs following
[...] and {...} groups and drops command + groups (reference-doc
source-verified; sandbox-probed on 3.1.3 with identical result). The
resulting solution stays coherent; the boxed critical-point
enumeration sentence is absent BY DECISION (base text derives the
candidate values in prose; the closing \fbox classification sentences
survive and classify exactly the 1a/Ma five points — the internal
evidence that base+1a is the Ma-coherent reading).

**Pattern (both profiles)**: matched_pair REMOVE_ALL, opening prefix
regex \\version\{[^}]*\} + anchor { with stack-grabbed balanced body
(generic over tags — covers 1a, Mb, and future course tags; bodies
span lines and contain nested braces in math). Problems profile now
27 patterns, solutions 28.

**Tests**: fixture 6 added — 8/8 checks (harness total 65/65). Covers
nested-brace math bodies, multi-line bodies, no stray tag literals,
base text intact (solutions side), and a hypothetical problems-side
occurrence outside solution envs (solution envs are removed wholesale
by the problems profile, so corpus sites never reach the pattern
there).

**Math-context**: text-only (3 uses; bodies contain math but the
command itself always appears in prose).

---

## 25. \calcitem — definition removal + marker replacement (both profiles)

Per-file device (PS01/03/07/09/11): \newcommand{\calcitem}{...} makes
a list item whose label is \calculator (icon) + the normal enum label,
marking calculator-allowed problems. 12 call sites, text-only.

**ORDER-CRITICAL two-pattern design**: (1) matched_pair REMOVE_ALL on
prefix \\newcommand\{\\calcitem\} removes the in-file definitions
FIRST — a naive global replace would rewrite the definition's own
name into \newcommand{\item ...}, a catastrophic self-redefinition of
\item. Guarded by an explicit test. (2) single_string
\calcitem -> \item \textbf{[Calculator allowed]}.

Interim wording approved by Nicholas. Long-run upgrade (parked, do
not build unprompted): icon + screen-reader text via the sentinel /
dispatch-filter layer — the assessment-semantics filter's third
client alongside blanks and correct-markers. Empirical note logged
during design: no icon or emoji self-describes "calculator allowed"
to AT; Unicode abacus announces as "abacus"; the accessible-icon
pattern is aria-hidden glyph + visually-hidden text, which requires
the filter layer (raw HTML cannot be injected from LaTeX source).
Visible text also serves cognitive accessibility.

**Math-context**: text-only (12 uses).

---

## 26. \highlight — EDIT_TAGS to \textbf (both profiles); definition corrected

**CORRECTION to earlier working notes**: \highlight (workbook.sty
132-135) is NOT a color or highlighting device despite the name. It
is an INDENTED MINIPAGE — an inset-block layout device (linewidth
minus 55pt, 24pt side margins, 8pt parskip). Its salience mechanism
is spatial. The corpus's genuinely colored constructs are \hl
(yellow; Pandoc -> real <mark>, announced by NVDA 2023.1+/recent
JAWS by default), \goal (bold+skyblue, Pandoc-native expansion), and
raw \textcolor.

Usage (34 sites, text-only): optimization-strategy step labels
("Goal:", "Define variables:", "Critical points:", ...) and
mid-sentence phrases marking the strategic move. Mixed inline usage
rules out a block/div mapping. Verified zero \textbf inside any
argument or within ±200 chars — no bold conflation.

**Decision (Nicholas)**: EDIT_TAGS \highlight{ -> \textbf{ now.
Upgrade path logged under color-semantics/sentinel design: sentinel
-> span.strategy-step with CSS (and a docx character style), giving
dual coding (bold + color) per WCAG 1.4.1 redundant-cue guidance.
Accessibility context recorded: screen readers do not announce text
color OR bold by default; the reliable AT channels are words,
structure, and <mark>.

**Math-context**: text-only (34 uses; args may contain inline math).

---

## 27. enumeratecols — rename + column-count strip (both profiles)

Multi-column enumerate (11 files; forms: {n} bare, [label=...]{n},
[label=..., ref=...]{n}). Columns are print layout; reflowable HTML
wants a plain list. Label specs are KEPT because Pandoc's LaTeX
reader honors enumitem label= (correct list numbering in output;
unknown keys like ref= are skipped harmlessly).

**STANDING ENGINE FACT discovered here**: the engine's single_string
regex replacement uses a function replacer returning replaceString
literally — capture-group references ($1) DO NOT WORK. No-capture
designs required. Lookbehind (incl. variable-length) IS available
(V8).

**Four-pattern no-capture design (order matters)**:
(1) \end{enumeratecols} -> \end{enumerate} [plain string]
(2) \begin{enumeratecols} -> \begin{enumerate} [plain string]
(3) regex (?<=\\begin\{enumerate\})\{[0-9]+\} -> "" [bare form]
(4) regex (?<=\\begin\{enumerate\}\[[^\]]*\])\{[0-9]+\} -> "" [opts]
Patterns 3/4 fire only on the renamed sites; a genuine enumerate is
never followed by a braced digit group (guarded by test). Mode-pair
interplay: ws4-4 wraps enumeratecols in \probonly{...} — mode-pair
patterns run earlier in the array and unwrap/remove first, so only
the surviving form reaches these patterns.

**Math-context**: text-only (structural).

**Batch status**: profiles now 34 (problems) / 35 (solutions)
patterns; harness 78/78 (fixture 7 = 13 checks incl. the
newcommand-item catastrophe guard and genuine-enumerate-untouched
guard).

---
