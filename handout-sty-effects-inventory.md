# handout.sty — Inventory of Output Effects

Reference document cataloguing every "effect" the `handout.sty` package can
produce in PDF output, for planning HTML conversion strategies (Lua filters,
preamble macro substitution, or preprocessing/cleanup).

> **Provenance & caveat (added 2026-07-23).** Rescued verbatim from the
> April 7, 2026 session transcript ("LaTeX spacing command pandoc cannot
> parse"); the original file was written to that session's output area and
> never landed on disk. It analyzes ONE variant of handout.sty. The corpus
> contains THREE variants (md5-prefix / lines / locations):
> `287849d0ab` (405 lines) — shared by Ma Fall 2025, Ma Exams 2025, 1b Fall
> 2025, and Mb Spring 2025 (root + hw);
> `3ff619d8bb` (391 lines) — Ma Fall 2024 Lesson Summaries (most likely the
> variant this inventory describes, based on session timing);
> `53527a88f4` (223 lines) — a local copy inside Ma 2025 assessments\Exam 1.
> Before relying on any entry for a specific course, diff it against that
> course's variant. workbook.sty likewise has three variants (Ma 240 lines —
> the imagetable/split-env one; 1b 213; Mb 178).

Source file: `handout.sty` (from a math course content series).

---

## 1. Mode switching (package options)

Top-level switches that change what renders at all:

- **default (no option)** — problems shown, solutions/grading/workshop/wsplan hidden, `\probonly` content shown, `\solonly` hidden, `\note` hidden, learning checks shown (empty wrappers).
- **`sols`** — solutions shown with "Solution." bold lead-in; problems shown in italic (`\problemfont`); `\problemonly` blocks hidden; `\probonly` hidden, `\solonly` shown; problem-space suppressed; learning checks hidden.
- **`solsonly`** — problems entirely hidden; only solutions and `\solonly` content shown; `\htitle` suppressed and `\stitle` promoted to the visible title.
- **`nospace`** — problem-space suppression independent of sols mode; `\spaceonly` blocks hidden.
- **`showprobonly`** — forces `\probonly` / `problemonly` visible even in sols mode.
- **`grading`** — activates the `grading` environment as a blue `tcolorbox` with "Grading Notes." lead-in (otherwise hidden).
- **`workshop`** — activates the `workshop` environment as a yellow `tcolorbox` with "CA Notes." lead-in (otherwise hidden).
- **`wsplan`** — activates the `wsplan` environment as a gray `colorbox` minipage (otherwise hidden).
- **`notes`** — changes math and text fonts to Computer Modern Bright sans; activates `\note{...}` as a framed sans-serif sidebar (otherwise hidden).

## 2. Conditional content wrappers (inline)

Commands whose visibility flips based on mode:

- **`\probonly{...}`** — visible in problem mode, hidden in sols mode.
- **`\solonly{...}`** — hidden in problem mode, visible in sols mode.
- **`\spaceonly{...}`** — visible unless `nospace` is set.
- **`\answeronly{...}`** — always hidden (defined but empty).
- **`\answer{...}`** — currently passes through unchanged (commented-out version would bold it in sols mode).
- **`\note{...}`** — hidden unless `notes` option is set.
- **`\htitle{...}`** — large bold centered title, suppressed in `solsonly`.
- **`\stitle{...}`** — hidden except in `solsonly`, where it becomes the title.

## 3. Conditional environments

- **`problem`** — optional argument is vertical space to reserve after the problem (via `\pspace`); in default mode, problem renders normally then inserts space; in sols mode, problem renders in italic and no space is added.
- **`problemonly`** — visible in default mode, hidden in sols mode.
- **`solution`** — hidden by default; in sols mode, shown with bold "Solution." lead-in and `\solutionfont`.
- **`solutiononly`** — always hidden except in sols/solsonly.
- **`grading`** / **`workshop`** / **`wsplan`** — hidden unless corresponding option is set; each has a distinctive colored box treatment.
- **`learningCheck`**, **`learningCheckMC`**, **`learningCheckEssay`** — pass-through wrappers in default mode; hidden in sols mode.
- **`choices`** — always hidden (aliased to `comment`).
- **`warmup`** — pass-through with an `\hrule` appended at the end (problem-mode only).
- **`objectives`** — framed box, visible only in problem mode.
- **`Example`** — numbered "Example N." lead-in using the equation counter.

## 4. Vertical space insertion

- **`\pspace{dim}`** — inserts `\vspace{dim}`, with special handling: if the argument begins with `\vfill` or `\newpage`, emits that directly; if it begins with `\stretch`, emits `\vspace{dim}\newpage`; otherwise plain `\vspace`. Used as the tail of every `problem` environment.
- **`problem[dim]`** — the optional argument becomes the `\pspace` call at environment end.
- **`\continueproblem{content}`** — wraps content in a `framed` box; problem-mode only.
- **`\psreflection[nocite]{content}`** — produces a full reflection page with pre-sized `\vspace{1.5in}` blocks and a trailing `\vfill`, followed by a `\newpage`; problem-mode only.
- **`\psrnewpage`** — alias for `\newpage` used inside reflection pages.

## 5. Fill-in-the-blank commands

These are the ones where problem vs. sols output differs *within* a single command call:

- **`\fitb[blank][width]{answer}`** — underlined parbox of the given width; in problem mode shows the optional blank placeholder (default: a space), in sols mode shows the answer bolded (or bold math if in math mode). `\mfitb` is an alias.
- **`\cfitb[blank][width]{answer}`** — same as `\fitb` but content is centered inside the parbox.

## 6. Circling / bubbling (answer-key markers)

- **`\circleitem`** — a list `\item` that triggers the `doCircle` flag; used with `\maybecircle` to mark the correct choice.
- **`\plainitem`** — a list `\item` that clears the `doCircle` flag.
- **`\maybecircle[cond]{content}`** — in problem mode shows content plain; in sols mode wraps content in an `\ovalbox` if `cond` is true (typically the `doCircle` flag set by `\circleitem`).
- **`\maybebubble[cond]`** — large open circle (`$\Circle$`) in problem mode; in sols mode, filled circle (`$\CIRCLE$`) if `cond` is true, else open circle. Used by the `tf` environment.

## 7. Multiple choice and true/false

- **`mc{letter}`** environment — underlined parbox at left for the answer letter (blank in problem mode, bold letter in sols mode), followed by a right-hand minipage for the question stem with `parskip=8pt`.
- **`tf{T|F}`** environment — two parboxes containing `\maybebubble` calls for True and False (filled appropriately in sols mode); followed by a minipage for the statement; font switches to `\tffont` in sols mode.
- **`\tfheading`** — a list-item header that prints "True False" in `\tffont`.

## 8. Font switching hooks

- **`\problemfont`** — defaults to italic; applied to problem bodies in sols mode.
- **`\solutionfont`** — defaults to empty; applied to solution bodies in sols mode.
- **`\tffont`** — defaults to empty; applied to true/false headings and statements.

## 9. Miscellaneous

- **`\firstChar{arg}`** — internal helper to peek at the first character/token of an argument; used for `\pspace` dispatch and `tf` T/F detection.
- **`framed`** environment — redefined to respect `\textwidth - \linewidth` margin adjustment, used by `\continueproblem` and `objectives`.
- **`\shortintertext{...}`** — short-version of amsmath's `\intertext`, for brief comments inside display math.
- **`\currentbgcolor`** — tracks current box background color (white / shadecolor / yellow) so nested boxes can adapt; used internally by `grading` and `workshop`.

---

## Related deferred idea: vspace → HTML

From earlier brainstorming, to be revisited when working on spacing:

- Map `\vspace`, `\bigskip`, `\medskip`, `\smallskip`, `\vfill`, and custom space commands to `<div class="answer-space-*" aria-hidden="true"></div>` via a Lua filter.
- Use bucketed sizes (small/medium/large) rather than exact dimensions.
- Use `em`-based CSS so spacing scales with font size.
- `\vfill` maps to a large fixed height (~8em) since HTML has no page-fill concept.
- Pandoc's `latex_macros` extension should expand `\newcommand`-defined wrappers first so custom aliases get caught.

---

## Next steps

Work through the inventory one section at a time and decide, for each effect, whether to handle it via:

1. **Lua filter** — catches `RawBlock`/`RawInline` in Pandoc's AST and rewrites to HTML.
2. **Preamble macro substitution** — define simplified versions of the commands in a preamble Pandoc can read and expand via `latex_macros`.
3. **Preprocessing/cleanup** — regex or brace-aware string manipulation before Pandoc runs.

The mode-switching question (section 1) is the biggest architectural decision: whether to produce one HTML output or two (problem version + solution version), which shapes how everything else is handled.

*(2026-07-23 addendum, corrected same day: the split-environment hazard — environments whose begin/end bodies open and close tabular/framed/tcolorbox across the two halves — is Pandoc-fatal only when the definition is TOP-LEVEL in the .sty (option-block definitions are swallowed unparsed) AND the environment is used. Live in handout.sty: `mc`, `tf`, `objectives`. NOT live: `grading`, `workshop`, `wsplan` (their split redefinitions sit inside `\DeclareOption` blocks; their top-level selves are inert comment-aliases → Div fallback). See HANDOFF.md "Corrections to the record (2026-07-23)".)*
