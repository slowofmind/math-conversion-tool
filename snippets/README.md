# Snippet core, rebuilt on kernel notation (stage 3, track C)

[CLAUDE 2026-11-02, overnight] A BUILDING session, following the signed-off
plan `intent-briefing/OVERNIGHT-PLAN-20261102.md`, section 5, steps 1 to 5.
Only new files were added, all in this folder. No existing file was changed.
Nothing was committed, and nothing is wired into the platform editor.

## Summary

- **What it does.** The author selects some math, picks a concept, and the
  core writes kernel markup around the selection, for example
  `\MathMLintent{logarithm($a1,$a2)}{\log_{\MathMLarg{a2}{b}} \MathMLarg{a1}{x}}`.
  It uses the formal concept name and the operand names and order from the
  Reference tool's export (`math-conversion/intent-concepts.json`, track A).
  There are no macros, no shorthand, no literals and no spoken preview. When
  it cannot tell which parts are the operands, it asks the author to mark
  them. It does not guess.
- **Calculus and analysis**: the export has 192 concepts in this group.
  - 4 are marked "not used". The tool refuses them and names the
    replacement where there is one.
  - 145 have a LaTeX example. The tool labels **130** of them on its own,
    and asks the author to mark the operands for 15.
  - 43 have no LaTeX example. 42 of these now have hand-written fixtures
    using the usual textbook notation. The last one, `fixed-point`, has no
    known notation.
- **Tests**: all pass. The failing run was recorded first.
  - All 217 expected kernel texts were checked with the Baseline converter.
  - 608 core checks pass (the first run had 305 failures).
  - 416 converted outputs pass the render test, and all 4 deliberately bad
    texts were caught.
- **The old tool's faults are fixed, and each has tests:**
  - F1, operand order: an upper limit written first, a log base, and a sum
    with the upper limit first all keep the right order.
  - F3: existing kernel markup is recognised.
  - F4: an operand like `A_i` keeps its own superscript out (tested with
    `z_k^*`, `f_n'` and `e_1^2`).
- **Main surprise**: for several core calculus concepts, the number of
  operands in the export does not fit the textbook notation
  (`definite-integral`, `derivative`, `partial-derivative`, and `limit` with
  its body). The tool asks the author for these. How to label them is a
  decision for you (section 6).

## Contents

1. [What was built](#1-what-was-built)
2. [How it decides, in plain words](#2-how-it-decides-in-plain-words)
3. [Which Calculus and analysis concepts are covered](#3-which-calculus-and-analysis-concepts-are-covered)
4. [Test results](#4-test-results)
5. [What surprised](#5-what-surprised)
6. [Decisions left for the morning](#6-decisions-left-for-the-morning)
7. [Limits, and what was not done](#7-limits-and-what-was-not-done)
8. [How to run](#8-how-to-run)

## 1. What was built

<details open>
<summary>Files in this folder</summary>

| File | What it is |
|---|---|
| `src/snippet-core.js` | The core. `createSnippetCore(export)` gives `apply`, `applyWithOperands` (the author marks ranges), `applyWithOperandTexts` (the author types each operand), `search`, `concept`, `groups`. Headless: text, selection and concept in; result out. |
| `src/latex-parse.js` | Finds the math in a document and reads it the way TeX groups it (rows, terms, scripts, commands, `\left...\right`, environments). |
| `src/checks.js` | Selection checks: empty, outside math, inside `\text`, inside an operator name, cutting braces / `\left...\right` / a command / a script, across table cells, already labelled (kernel and old shorthand). |
| `src/shapes.js` | Structure recognition: fences and bars, comma lists, function application, prefix operators, infix operators, large operators (sum, integral, limit), evaluation bars, scripts, command arguments. Also the order and arity logic. |
| `src/writer.js` | The kernel writer, with the measured brace rules. |
| `src/concepts.js` | Reads the export; forms and arities; the filterable concept search. |
| `demo.html` | Standalone test page: a text area, a button, a filterable list, Apply, and a "mark the operands" form. |
| `test/` | Fixtures, the fixture generator, the converter checks, the core tests, the render test, the coverage report, and every run's output (`test/runs/`). |
| `probes/probe-braces.mjs` | The measurement behind the brace rules (46 patterns, Baseline converter). |

The core is plain ES modules with no imports from outside this folder, so
the platform page could load it with `import('./snippets/src/snippet-core.js')`,
the same way `index.html` already loads its other modules.

</details>

## 2. How it decides, in plain words

<details open>
<summary>From selection to markup</summary>

1. **Check the selection.** It must be whole pieces of one piece of math. A
   refusal always says why, for example "The selection separates a
   superscript or subscript from what it belongs to."
2. **Read the structure.** Each shape offers possible readings: "the
   operands are these pieces". For example, in `\log_b x` the operand could
   be just `x`, or both `b` and `x`.
3. **Keep only readings with the right number of operands** for the concept.
   Some concepts have several forms in the export; for example `sum` can
   take 1, 2 or 3 operands. The reading picks the form.
4. **Do not drop content silently.** A reading that would leave letters or
   numbers outside every operand (so they would not be read aloud) is used
   only with evidence. The same goes for a script where the base or the
   script could be the operand (`e^x`). Evidence means either:
   - the concept's own example in the Reference tool, with the same shape and
     the same pieces marked; or
   - for scripts only, the concept's fixity ("postfix" means the base is the
     operand, "indexed" means the script is).
5. **Trust the Reference example over the tool.** If the example has the
   same shape but marks different pieces, that reading is dropped.
6. **Exactly one reading left: write it. Otherwise ask the author** to mark
   the operands, and say why.

**Operand order** comes from three sources, in this priority:
- the example, when it confirmed the reading;
- otherwise, the order in which the concept's wording mentions the operands.
  For "log base $a2 of $a1", the base is written first but is the second
  operand;
- otherwise, the reading order, with a warning shown to the author.

Subscripts always count before superscripts, however they are typed, so
`F\Big|^{1}_{0}` cannot flip into "from 1 to 0".

**Braces** (all measured in `probes/probe-braces-out.txt`). The writer adds
a pair of braces in these cases:
- around an operand that is an unbraced script or command argument (`x^2`,
  `\bar z`);
- around an operand that ends in a subscript when a superscript or prime
  follows (`z_k^*`);
- around an operand that is the whole selection;
- inside an operand that is itself a label;
- around the whole new label when it is an unbraced argument (`x^e`);
- around the whole new label when its subscript is followed by a
  superscript outside the selection (`e_1` in `e_1^2`);
- around the whole new label when it is written inside an existing operand.

**Operand names** come from the export as they are: `a1`, `a2` for core
concepts, `lower` and `upper` for intervals, and the open list's own names
such as `function`. A name that clashes with one already used by a
surrounding or inner label gets "-2" (so `a1-2`). The converter accepts
this; it was measured.

</details>

## 3. Which Calculus and analysis concepts are covered

<details open>
<summary>Concepts with a LaTeX example (145): 130 labelled on their own, 15 ask</summary>

The 130 are listed in `test/runs/20261102-4-coverage.txt`. They are pinned
in `test/fixtures/auto-coverage-calculus-analysis.json`, so a later change
that loses one fails the tests. For 118 of them the order was confirmed by
the example. The other 12 have no operands at all (symbols and constants).

The 15 that fall back to "mark the operands", and why. In every case the
example marks pieces that the tool cannot isolate, so asking is correct:

| Concept | Why the tool asks |
|---|---|
| bigeometric-integral | The example's operand `f` sits inside parentheses: `\int (f)`. |
| calderon-toeplitz-operator | Both operands sit in one subscript: `T_{b\psi}`. |
| forward-difference | The example marks `f` in `\Delta_h^n f(x)`; the tool would take `f(x)`. |
| gateaux-derivative | The operand `F` is glued to the `d`: `dF(u;\psi)`. |
| lower-dini-derivative, upper-dini-derivative | The operand is inside a braced head with a prime: `{f'_{-}}(t)`. |
| mellin-transform | Two bracket groups: `\mathcal{M}\{f\}(s)`. |
| multiple-integral | `\int \cdots \int f`. |
| pade-approximant | `[m/n]_f`: 3 operands in an unusual layout. |
| pointwise-convergent | The example shows 2 things (`f_n \to f`) for 1 operand. This is probably a data problem. |
| product-integral | `\prod f(x)^{dx}`. |
| quadratic-differential | `f(z)\,dz \otimes dz`. |
| real-prepolar | `{}^{\circ}{B}`: a script with no base. |
| schwarzian-derivative | `S(f)(x)`: two bracket groups. |
| sobolev-space | Both operands sit in one superscript: `W^{k,p}`. |

</details>

<details open>
<summary>Concepts with no LaTeX example (43): hand-written fixtures</summary>

**Labelled on their own:**
- intervals: closed-interval, open-interval (also `]a,b[`), open-closed-interval,
  closed-open-interval (also `\left[...\right)`);
- all 12 hyperbolic and arc-hyperbolic functions (`\sinh x`, `\cosh(2t)`,
  `\operatorname{arsinh}(x)` ...);
- logarithm with 1 or 2 operands (base order from the wording),
  natural-logarithm, exponential (`\exp(...)`), exponential-e;
- real-part, imaginary-part, complex-arg, complex-conjugate (`\overline{z}`,
  `\bar z`, `z^*`, `z_k^*`);
- prime-notation (`f'`, `y''`, `f_n'`), time-derivative (`\dot{x}`),
  gradient (`\nabla f`);
- evaluate, in five notations, with a warning that the order was not
  confirmed;
- evaluated-at;
- sum and product, with 1, 2 or 3 operands;
- limit (only `\lim_{x\to a}`, see section 6);
- tends-to, tends-to-from-above, tends-to-from-below;
- differential-d.

**The tool asks the author to mark the operands:**
- definite-integral, derivative and partial-derivative: the export's number
  of operands does not fit the notation (section 6);
- divergence, curl, laplacian, change and piecewise: the export records no
  number of operands;
- `e^x` as exponential: the base or the exponent could be the operand;
- `\sinh^{-1} x`: the -1 would go unread;
- limit with its body selected.

**Refused as "not used":** large-op, limit-inf, limit-sup,
logarithm-with-base.

**No fixture:** fixed-point. The data has no notation for it.

</details>

## 4. Test results

<details open>
<summary>All runs are saved in test/runs/</summary>

| Run | Result |
|---|---|
| `20261102-0-probe-braces.txt` | 46 brace patterns: 43 fine. The 3 failures are the expected merges (A_i^T, f_n', a label followed by a script), and braces fix each one. |
| `20261102-1-verify-fixtures.txt` | The expected kernel texts, checked with the Baseline converter before any core code: 210 pass, 0 fail. |
| `20261102-2-test-core-FAILING.txt` | The tests against a core with no shape finder or writer: 152 passed, **305 failed**. |
| `20261102-3-test-core-PASSING.txt` | After building: 587 passed, 0 failed. |
| `20261102-6-verify-fixtures-final.txt` | Final fixture set: **217 pass, 0 fail** (32 refusals have no text). |
| `20261102-7-test-core-final.txt` | Final: **608 passed, 0 failed**. 130 of 145 example fixtures labelled without help. |
| `20261102-8-test-render-final.txt` | Every ready output, converted in its document: **416 passed, 0 failed**; negative controls caught 4 of 4. |
| `20261102-4-coverage.txt` | What the core does with every fixture: status, shape, where the order came from, or the reason. |

The checks applied to every converted output (`test/lib/mathml.mjs`):
- the label carries the full intent value;
- each operand is exactly one element, holding exactly the text of the
  operand converted on its own (so nothing is swallowed or split);
- no label is lost;
- there is no converter error;
- the label covers the selected notation.

The demo page was driven by keyboard in the app's browser and works. I
tested: open the picker, filter, move to the list with Down arrow, apply
with Enter, get a refusal, use the "mark the operands" form, and close with
Escape. After every action, focus and the selection return to the text
area, and the status line reports what happened. **It has not been checked
with NVDA or JAWS.**

Fixtures added after the first passing run, each recorded failing before
its fix:
- 7 hand fixtures for concepts that had none: six hyperbolic functions and
  tends-to-from-below. They passed first time.
- 2 check fixtures and 4 typed-operand tests, written for the
  `\operatorname` fault in section 5. They failed first, then passed after
  the fix.

Fixture corrections, not loosenings, each recorded here:
- two operand occurrence numbers were wrong (the upper limit `2` in
  `\left[x^2\right]_0^2`, and the `t` in `\operatorname{arcoth} t`);
- the generated expected texts now keep the space that the generator itself
  adds to the source (`\cdot Y`).

</details>

## 5. What surprised

<details open>
<summary>Expected or not, and what each changes</summary>

1. **Not expected: a `$` inside a label value.** In
   `$\MathMLintent{absolute-value($a1)}{...}$`, my first math finder treated
   the `$` in `($a1)` as the end of the math. TeX does not, because the `$`
   sits inside braces. Fixed and tested. Other tools that search for `$...$`
   by plain text could have the same fault (see the follow-up in section 6).
2. **Not expected: typed operands could land inside a function name.**
   Typing `t` as the operand of `\operatorname{arcoth} t` first matched the
   "t" inside the name, and the core wrote
   `\operatorname{arco\MathMLarg{a1}{t}h}` without any warning. The core's
   own reading never did this; only the "author marks the operands" path
   could. Fixed:
   - text inside `\operatorname{...}` cannot be selected or marked;
   - part of a word inside a font command (`\mathrm{Log}`) is refused;
   - typed operands only match whole pieces of the math.
3. **Not expected: core arities against textbook notation.**
   - `definite-integral` takes 1 or 2 operands ("integral over $a1",
     "integral from $a1 to $a2").
   - `derivative` takes 3 (function, variable, order).
   - `limit` takes 1 ("limit as $a1").
   - `partial-derivative` takes "3 or more".

   So `\int_0^1 x^2\,dx` and `\frac{dy}{dx}` cannot be labelled without
   leaving something unread or inventing an operand, and the tool asks the
   author. Track A also flagged the arity changes for definite-integral and
   derivative.
4. **Not expected: removing the example markers can break the LaTeX.**
   `\cdot\arg{y}{Y}` became `\cdotY`, an unknown command. The converter
   check caught this in the fixture generator.
5. **Expected: the scripts that merge (F4).** Exactly the patterns the
   explainer predicted, and braces fix each one.
6. **Expected: `evaluate` has generated operand names** (a1, a2, a3) and no
   wording, as track A's note said. The tool uses the reading order
   (expression, lower limit, upper limit) and warns the author. Our own
   macro template in the Reference tool's annotations (`\evalfromto`) uses
   the same order.

</details>

## 6. Decisions left for the morning

<details open>
<summary>Questions for Nicholas (none blocked the night's work)</summary>

1. **Integrals, derivatives and limits.** How should these be labelled,
   given the core arities?
   - Option: label only the operator part, the way core's "limit as $a1"
     suggests: `\lim_{x\to a}` alone, or `\int_a^b` alone as
     "integral from $a1 to $a2". The tool already does this for `limit`.
   - Option: use our own concept names with more operands.
   - Option: leave them to the author.

   Today the tool asks the author for definite-integral, derivative and
   partial-derivative.
2. **Five concepts have no number of operands in the export:** curl,
   divergence, laplacian, change and piecewise. Should the Reference tool
   record one? For now the author marks the operands, named a1, a2 and so
   on, with a warning.
3. **`evaluate` order.** Please confirm expression, lower limit, upper limit,
   and consider giving the operands real names in the Reference tool.
4. **`tends-to-from-above` / `-from-below`.** For `x \to a^{+}`, the tool
   marks `a^{+}`, plus sign included, as the second operand. Core's wording
   ("$a1 tends to from above $a2") suggests just `a`. Is that acceptable, or
   should the `+` stay outside the operand?
5. **Warn on unread content when the author marks operands?** In the
   author's own marking, nothing warns when part of the label would go
   unread (for example, limit with its body). The core's own readings never
   do this.
6. **`e^x` and `\sinh^{-1} x`** fall back to "mark the operands" by design.
   Do you want rules for them, or keep asking?
7. **Operand names.** Is it acceptable to use the export's names as they
   are (`a1`, `lower`, `function`), with "-2" added on a clash?
8. **Wiring into the platform editor** (plan item 4, not started). It
   needs:
   - a "read the selection" call (offsets) and a "replace a range" call in
     `cm6-src/facade.js`, then an editor bundle rebuild and the `cm6-src`
     tests;
   - loading `math-conversion/intent-concepts.json` in the page;
   - a button and a keyboard shortcut, chosen by testing with NVDA and JAWS;
   - the picker panel. `demo.html` shows one way: native form controls,
     plus a typed-operand form, because the old harness's NVDA pass found
     typing operands works where selecting inside a read-only field did not;
   - one undo step per insertion in the editor's history.
9. **Retire the old harness snippet core?** (plan item 5)
10. **Reference-tool data to review** (from the 15 fallbacks): the
    pointwise-convergent example (2 things shown for 1 operand) and the
    product-integral example.
11. **Commits** (nothing is committed).

**Follow-up found in passing, not done:** check whether other tools that
find `$...$` math by plain text (the old harness's region finder, Intent
Scan) stop early at a `$` inside a kernel label value.

</details>

## 7. Limits, and what was not done

<details open>
<summary>Known limits</summary>

- Only the Calculus and analysis group has fixtures. The search and the
  core work for every group, but other groups have not been tested.
- The parser treats unknown commands as taking no arguments, so a user
  macro such as `\abs{x}` reads as `\abs` followed by `{x}`.
- Shapes not built: two operands in one script (`W^{k,p}`), a function with
  two bracket groups (`S(f)(x)`), and the multiple integral `\int\cdots\int`.
  These fall back to "mark the operands".
- No spoken preview, no macros, no literals, as the plan says.
- `demo.html` is a test page only. It needs the platform folder served over
  http.

</details>

## 8. How to run

<details open>
<summary>Commands (from this folder)</summary>

```bash
node test/gen-fixtures.mjs
```
```bash
node --no-warnings test/verify-fixtures.mjs
```
```bash
node --no-warnings test/test-core.mjs
```
```bash
node --no-warnings test/test-render.mjs
```
```bash
node --no-warnings test/report-coverage.mjs
```

The demo page: serve the platform folder (`pandoc-for-math-conversion`)
with `python -m http.server 8765 --bind 127.0.0.1`, which is the "static"
entry in its `.claude/launch.json`. Then open
`http://127.0.0.1:8765/snippets/demo.html`.

Re-run `gen-fixtures.mjs` and then `verify-fixtures.mjs` whenever the
concept export changes.

</details>
