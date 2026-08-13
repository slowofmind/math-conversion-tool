# Intent → macro → ambiguous-source mapping

Derived from `math-conversion/intent-vocabulary.json` v0.2.0 (2026-08-09).
Purpose: spec for (a) a realistic faculty-style sample file and (b) the
search-and-suggest tool.

**Columns**
- **Intent** — the concept name emitted as `intent="name($a,$b)"`.
- **Our macro** — what the author writes to get it. `—` means no macro:
  either the `physics` package owns the command name, or the notation is
  too context-dependent to wrap automatically.
- **Ambiguous source** — what faculty actually type today. This is the
  detection surface for the tool. Multiple forms per row are common.
- **T** — tier. 1 = fixes both MathCAT and SRE (MathCAT wrong or absent).
  2 = SRE-only gain (MathCAT already infers). 3 = both engines fine.

Tier 1 rows are where the accessibility win is. Tier 2 rows still help SRE
composed speech but are not urgent. Tier 3 exists for completeness.

---

## Concepts with a macro (25)

| Intent | Our macro | Ambiguous source | T |
|---|---|---|---|
| `absolute-value` | `\abs{x}` | `\|x\|`, `\left\|x\right\|`, `\lvert x\rvert` | 2 |
| `determinant` | `\determ{A}` | `\|A\|`, `\left\|A\right\|` | 2 |
| `cardinality` | `\card{S}` | `\|S\|`, `\#S`, `\lvert S\rvert` | **1** |
| `magnitude` | `\magn{v}` | `\|v\|`, `\|\vec{v}\|` | 2 |
| `modulus` | `\modulus{z}` | `\|z\|` | **1** |
| `norm` | `\norm{v}` | `\\|v\\|`, `\left\\|v\right\\|`, `\lVert v\rVert` | 2 |
| `subscripted-norm` | `\normsub{2}{v}` | `\\|v\\|_2`, `\\|v\\|_{L^2}` | 2 |
| `open-interval` | `\openint{a}{b}` | `(a,b)` | 2 |
| `closed-interval` | `\closedint{a}{b}` | `[a,b]` | 2 |
| `open-closed-interval` | `\opclint{a}{b}` | `(a,b]` | 2 |
| `closed-open-interval` | `\clopint{a}{b}` | `[a,b)` | 2 |
| `ordered-pair` | `\pair{a}{b}` | `(a,b)`, `(x,y)`, `(x_1,y_1)` | **1** |
| `gcd` | `\gcdof{a}{b}` | `(a,b)` in number theory | **1** |
| `binomial-coefficient` | `\binomc{n}{k}` | `\binom{n}{k}`, `{n \choose k}`, `\dbinom`, `\tbinom` | 2 |
| `inner-product` | `\ipof{u}{v}` | `\langle u,v\rangle`, `\left<u,v\right>` | **1** |
| `cross-product` | `\crossp{u}{v}` | `u \times v`, `\vec{u}\times\vec{v}` | 2 |
| `dot-product` | `\dotp{u}{v}` | `u \cdot v`, `\vec{u}\cdot\vec{v}` | 2 |
| `transpose` | `\transp{A}` | `A^T`, `A^{T}`, `A^\top`, `A^{\intercal}`, `A^{\mathsf{T}}` | 2 |
| `trace` | `\traceof{A}` | `\operatorname{tr}(A)`, `\mathrm{tr}(A)`, `\text{tr}(A)`, `\tr A` | 2 |
| `complex-conjugate` | `\conj{z}` | `\overline{z}`, `\bar{z}`, `z^*` | **1** |
| `line-segment` | `\lineseg{AB}` | `\overline{AB}` | 2 |
| `mean` | `\meanof{x}` | `\overline{x}`, `\bar{x}` | **1** |
| `set-complement` | `\complementof{A}` | `\overline{A}`, `A^c`, `A'` | **1** |
| `vector` | `\vecof{v}` | `\vec{v}`, `\mathbf{v}`, `\boldsymbol{v}` | 2 |
| `derivative` | `\deriv{y}{x}` | `\frac{dy}{dx}`, `\frac{\partial f}{\partial x}`, `\dv{y}{x}`, `y'` | **1** |
| `definite-integral` | `\defint{a}{b}{f(x)}{x}` | `\int_a^b f(x)\,dx`, `\int_{a}^{b} f(x)dx` | **1** |
| `set` | `\set{x \mid x>0}` | `\{x \mid x>0\}`, `\left\{\dots\right\}` | 3 |

---

## Concepts with no macro (14)

Either the `physics` package owns the command name (we deliberately do not
shadow it), or the notation is too context-dependent to wrap blind. For
these the author writes `\intent{...}{...}` explicitly, or the tool
suggests a wrapper.

| Intent | Why no macro | Ambiguous source | T |
|---|---|---|---|
| `braket` | physics owns `\braket`, `\ip` | `\langle\phi\|\psi\rangle`, `\braket{\phi}{\psi}` | **1** |
| `ket` | physics owns `\ket` | `\|\psi\rangle`, `\ket{\psi}` | **1** |
| `bra` | physics owns `\bra` | `\langle\psi\|`, `\bra{\psi}` | **1** |
| `expectation-value` | physics owns `\expval`, `\ev` | `\langle\psi\|A\|\psi\rangle`, `\expval{A}{\psi}`, `\langle A\rangle` | **1** |
| `ketbra` | physics owns `\ketbra`, `\outerproduct`, `\dyad`, `\op` | `\|\psi\rangle\langle\phi\|`, `\ketbra{\psi}{\phi}` | **1** |
| `matrix-element` | physics owns `\mel`, `\matrixelement` | `\langle m\|A\|n\rangle`, `\mel{m}{A}{n}` | **1** |
| `time-derivative` | context-dependent | `\dot{x}`, `\ddot{x}` | **1** |
| `fixed-point` | same notation as `optimal-solution` | `x^*`, `x^{*}` | **1** |
| `optimal-solution` | same notation as `fixed-point` | `x^*`, `x^{*}` | **1** |
| `gradient` | `\nabla` is also divergence / curl / covariant derivative | `\nabla f`, `\grad f` | **1** |
| `concentration` | collides with interval and matrix brackets | `[X]`, `[\ce{H+}]`, `[\mathrm{H^+}]` | **1** |
| `cardinality-of-set-builder` | placeholder, probably redundant | — | 3 |

Note `binomial-coefficient` carries `mathcatName: "binomial"` — the build's
`MATHCAT_NAMES` switch decides which name reaches the intent attribute.

---

## Collision groups — why this is suggest, not replace

The mapping is **one notation to many concepts**. A detector that fires on
`|X|` cannot know which of five readings the author meant. These groups are
the tool's real work: detect the notation, then present the candidates.

| Notation | Candidate intents | MathCAT's default guess |
|---|---|---|
| `\|X\|` | absolute-value · determinant · cardinality · magnitude · modulus | determinant if `X` is all-uppercase `<mi>`, else absolute-value |
| `(a,b)` | open-interval · ordered-pair · gcd · point · cycle | open-interval |
| `[a,b]` | closed-interval · commutator · matrix-row · equivalence-class · **concentration** | closed-interval |
| `\overline{X}` | complex-conjugate · line-segment · mean · set-complement · repeating-decimal | line-segment or repeating-decimal by content |
| `x^*` | fixed-point · optimal-solution | absent |
| `X^T` | transpose · power | transpose |
| `f'` | derivative · prime-notation · transpose · set-complement | says "prime" |
| `\langle a\|b\rangle` | inner-product · braket · expectation-value · ket · bra | absent — reads the bar as "divides" |

### Highest-value detections

Ranked by how often the default guess is wrong on real course material:

1. **`|S|` for set cardinality** — read as "determinant of S" because `S` is
   uppercase. Ubiquitous in discrete maths and set theory. The single
   highest-value entry in the vocabulary.
2. **`\overline{AB}` for complex conjugate** — read as line-segment. The
   canonical W3C example of the problem.
3. **`(a,b)` as a point or tuple** — read as open-interval. Very common in
   coordinate geometry.
4. **Anything bra-ket** — no inference at all; the bar is read as "divides",
   which is actively misleading.
5. **`[X]` chemical concentration** — read as a closed interval.

### Consequences for the tool

- **Never auto-replace.** Every collision-group hit needs an author decision.
  Only a notation with exactly one candidate could be safely automatic, and
  almost none are.
- **Rank by context, don't guess.** Uppercase single letter inside bars leans
  cardinality or determinant; `\vec` or bold leans magnitude; a `z` leans
  modulus. These are priors for ordering the suggestions, not answers.
- **Course context is a strong prior.** `x^*` is fixed-point in APMTH 108 and
  optimal-solution in APMTH 121 — same notation, different course. A
  per-document or per-course default would resolve a lot of hits cheaply.
- **Report, don't rewrite, on first pass.** A worklist of file/line/notation/
  candidates is more useful than an edited file, and matches how the
  classification harness already works.
- **Some sources are already unambiguous** and should not be flagged:
  `\det(A)`, `\gcd(a,b)`, `\operatorname{tr}(A)` are fine as written for
  MathCAT. They are Tier 2 SRE-only gains at best.

---

## Glossary — plain names for the moving parts

Use these names in documentation and when explaining the system. The
jargon on the left appears in source comments and upstream docs.

| Jargon | Plain name | What it is |
|---|---|---|
| SRE (Speech Rule Engine) | **MathJax's speech engine** | Builds a spoken sentence inside the page |
| MathCAT | **NVDA's math reader** | Built into NVDA 2026.1+; reads MathML directly |
| worker patch / rules shim | **speech-rule pack** | Six rules we merge into MathJax's speech engine so it understands our markup |
| `intent=` / `arg=` | **MathCAT channel** | Attributes NVDA's math reader consumes |
| `ext-open` / `ext-arity` / `ext-argname` | **MathJax channel** | Attributes the speech-rule pack consumes |
| assistive MathML | **hidden-MathML mode** | Real MathML hidden in the page |
| aria-label speech | **MathJax-speech mode** | MathJax writes the sentence; NVDA relays it |

## The two channels — who does the talking

One authoring action (`\intent{...}` or a shortcut macro) writes **both**
channels into the same MathML. They are consumed by different engines in
**different modes** — never both at once.

**Hidden-MathML mode** — NVDA's math reader does the talking. It reads the
MathML and uses the `intent=` attributes. Works offline from static MathML;
needs nothing else shipped.

**MathJax-speech mode** — MathJax does the talking. Its speech engine builds
a sentence into `aria-label`; NVDA just reads that string aloud and never
sees the MathML. Our `ext-*` attributes only reach it via the
**speech-rule pack**, delivered by `filters/mathjax-intent-toggle.lua`.

Which mode a reader is in determines which channel matters. This is why a
concept can be harmless in one mode and badly wrong in the other.

## Annotation policy (decided 2026-08-10)

**Annotate ambiguous notation always, even where an engine already infers
correctly.** Rationale: uniform rule, simpler to teach, pins behaviour
against engine updates, and removes reliance on typographic guesses (e.g.
MathCAT's `|X|` rule keys on whether the content is uppercase).

Dependency: this is safe **when the concept name is one MathCAT recognises**
(`source: "mathcat"`). Coined names are read literally by MathCAT
("braket of a comma b", verified 2026-08-05). Prefer MathCAT-sourced names;
treat coined names as a deliberate trade.

Consequence: engine-behaviour tracking is no longer used to decide *whether*
to annotate. It is used to **rank the suggest tool's output** and to explain
the payoff to faculty.

## Proposed tracking change — record both engines

The vocabulary currently has one structured field, `mathcat`, with values
`infers` / `wrong` / `absent`. There is **no equivalent field for MathJax's
speech engine**. Its behaviour is recorded only as prose in `notes` and
`priority`, where a tool cannot read it.

Proposal: add a parallel `sre` field with the same three values, so each
concept records what happens **in each mode, unaided**:

```json
"mathcat": "infers",     // NVDA's math reader, no annotation
"sre":     "wrong",      // MathJax's speech engine, no annotation
```

Ranking then falls out of the pair, rather than using MathCAT as a proxy
for both:

| mathcat | sre | Meaning | Suggest-tool rank |
|---|---|---|---|
| wrong / absent | wrong / absent | broken in both modes | **highest** |
| infers | wrong / absent | fine for NVDA, wrong in MathJax-speech | **high** |
| wrong / absent | infers | wrong for NVDA, fine in MathJax-speech | **high** |
| infers | infers | both already correct | low — still annotate, but rank last |

### Why the old "Tier" column was misleading

Tier was derived from `mathcat` alone, so a concept could be Tier 2 ("SRE-only
gain") while being badly wrong in MathJax-speech mode. The clearest example
is in the vocabulary already:

> **`norm`** — tier 2, mathcat `infers`. *"SRE alone says 'the metric of',
> which is wrong."*

Under the old scheme that ranks low. It should rank high: for any reader in
MathJax-speech mode — MathJax 4's default — the unaided reading is wrong.

### Current state of SRE knowledge: mostly untested

Behaviour of MathJax's speech engine is documented for only a handful of
notations. Everything else is **unknown**, and should be marked so rather
than guessed:

| Notation | MathJax speech engine, unaided | Source |
|---|---|---|
| `\|X\|` double bars (norm) | "the metric of" — **wrong** | vocabulary note |
| `⟨a\|b⟩` | reads the bar as "divides" — **wrong** | notation `angle-bar-angle` |
| `⟨m\|A\|n⟩` | reads both bars as "divides" — **wrong** | notation `angle-bar-bar-angle` |
| everything else | **untested** | — |

Filling this in is an empirical job, not a reasoning job. The NVDA bridge
now makes it cheap: render each notation twice (unaided and annotated), in
each mode, and capture what is actually spoken. That produces real values
for both fields and doubles as a regression baseline.
