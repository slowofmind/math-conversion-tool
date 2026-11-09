// test/fixtures/hand-calculus-analysis.mjs — hand-written fixtures.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 step 1. Written
// BEFORE the shape finder and the writer (tests first).
//
// Three kinds:
//   1. The calculus concepts the export gives NO LaTeX example for (core and
//      Harvard concepts: intervals, hyperbolic functions, log, sum, limit,
//      evaluation bars ...). Their LaTeX is the usual textbook notation.
//   2. Open-list concepts written differently from their example, to test
//      that the example's operand order carries over.
//   3. The selection checks, nesting, and brace cases.
// Every expected kernel text is checked by test/verify-fixtures.mjs with the
// Baseline converter before it is used.
//
// Fields: id, concept (name or export key), source, select (+ nth) or range,
//   expect: { status: 'ready'|'needs-operands'|'refused', code?, text?, warnings? }
//     text for 'needs-operands' = what the "author marks the operands" path
//     must write, given `operands`;
//   operands: [{ text, nth? }] in the concept's order (nth counts inside the
//     selection).
const R = String.raw;
const ready = (text, extra = {}) => ({ status: 'ready', text, ...extra });
const needs = (code, text, extra = {}) => ({ status: 'needs-operands', code, ...(text ? { text } : {}), ...extra });
const refused = code => ({ status: 'refused', code });
const ops = (...t) => t.map(x => (typeof x === 'string' ? { text: x } : x));

export const fixtures = [
  // ---- 1. Core and Harvard concepts with no LaTeX example -----------------
  // Intervals (fenced list). Names lower/upper come from the core list.
  { id: 'closed-interval', concept: 'closed-interval', source: R`$x\in[0,1]$`, select: R`[0,1]`,
    expect: ready(R`\MathMLintent{closed-interval:function($lower,$upper)}{[\MathMLarg{lower}{0},\MathMLarg{upper}{1}]}`), operands: ops('0', '1') },
  { id: 'open-interval', concept: 'open-interval', source: R`$(a, b)$`, select: R`(a, b)`,
    expect: ready(R`\MathMLintent{open-interval:function($lower,$upper)}{(\MathMLarg{lower}{a}, \MathMLarg{upper}{b})}`), operands: ops('a', 'b') },
  { id: 'open-interval-european', concept: 'open-interval', source: R`$]a,b[$`, select: R`]a,b[`,
    expect: ready(R`\MathMLintent{open-interval:function($lower,$upper)}{]\MathMLarg{lower}{a},\MathMLarg{upper}{b}[}`), operands: ops('a', 'b') },
  { id: 'open-closed-interval', concept: 'custom:open-closed-interval', source: R`$(0, 1]$`, select: R`(0, 1]`,
    expect: ready(R`\MathMLintent{open-closed-interval:function($lower,$upper)}{(\MathMLarg{lower}{0}, \MathMLarg{upper}{1}]}`), operands: ops('0', '1') },
  { id: 'closed-open-interval', concept: 'custom:closed-open-interval', source: R`$[0,1)$`, select: R`[0,1)`,
    expect: ready(R`\MathMLintent{closed-open-interval:function($lower,$upper)}{[\MathMLarg{lower}{0},\MathMLarg{upper}{1})}`), operands: ops('0', '1') },
  { id: 'closed-open-interval-sized', concept: 'closed-open-interval', source: R`$t \in \left[0, \frac{1}{2}\right)$`, select: R`\left[0, \frac{1}{2}\right)`,
    expect: ready(R`\MathMLintent{closed-open-interval:function($lower,$upper)}{\left[\MathMLarg{lower}{0}, \MathMLarg{upper}{\frac{1}{2}}\right)}`), operands: ops('0', R`\frac{1}{2}`) },
  { id: 'open-interval-longer-operands', concept: 'open-interval', source: R`$(x+1, y^2)$`, select: R`(x+1, y^2)`,
    expect: ready(R`\MathMLintent{open-interval:function($lower,$upper)}{(\MathMLarg{lower}{x+1}, \MathMLarg{upper}{y^2})}`), operands: ops('x+1', 'y^2') },
  { id: 'open-interval-nested-comma', concept: 'open-closed-interval', source: R`$(f(a, b), c]$`, select: R`(f(a, b), c]`,
    expect: ready(R`\MathMLintent{open-closed-interval:function($lower,$upper)}{(\MathMLarg{lower}{f(a, b)}, \MathMLarg{upper}{c}]}`), operands: ops('f(a, b)', 'c') },

  // Hyperbolic functions (function application or prefix operator).
  { id: 'sinh-prefix', concept: 'hyperbolic-sine', source: R`$\sinh x$`, select: R`\sinh x`,
    expect: ready(R`\MathMLintent{hyperbolic-sine:function($a1)}{\sinh \MathMLarg{a1}{x}}`), operands: ops('x') },
  { id: 'cosh-parens', concept: 'hyperbolic-cosine', source: R`$y=\cosh(2t)$`, select: R`\cosh(2t)`,
    expect: ready(R`\MathMLintent{hyperbolic-cosine:function($a1)}{\cosh(\MathMLarg{a1}{2t})}`), operands: ops('2t') },
  { id: 'tanh-left-right', concept: 'hyperbolic-tangent', source: R`$\tanh\left(\frac{x}{2}\right)$`, select: R`\tanh\left(\frac{x}{2}\right)`,
    expect: ready(R`\MathMLintent{hyperbolic-tangent:function($a1)}{\tanh\left(\MathMLarg{a1}{\frac{x}{2}}\right)}`), operands: ops(R`\frac{x}{2}`) },
  { id: 'sech-operatorname', concept: 'hyperbolic-secant', source: R`$\operatorname{sech} u$`, select: R`\operatorname{sech} u`,
    expect: ready(R`\MathMLintent{hyperbolic-secant:function($a1)}{\operatorname{sech} \MathMLarg{a1}{u}}`), operands: ops('u') },
  { id: 'coth-prefix', concept: 'hyperbolic-cotangent', source: R`$\coth z$`, select: R`\coth z`,
    expect: ready(R`\MathMLintent{hyperbolic-cotangent:function($a1)}{\coth \MathMLarg{a1}{z}}`), operands: ops('z') },
  { id: 'arsinh-operatorname', concept: 'arc-hyperbolic-sine', source: R`$\operatorname{arsinh}(x)$`, select: R`\operatorname{arsinh}(x)`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-sine:function($value)}{\operatorname{arsinh}(\MathMLarg{value}{x})}`), operands: ops('x') },
  // Added after the first passing run, to cover every hyperbolic concept in the group.
  { id: 'csch-operatorname', concept: 'hyperbolic-cosecant', source: R`$\operatorname{csch} x$`, select: R`\operatorname{csch} x`,
    expect: ready(R`\MathMLintent{hyperbolic-cosecant:function($a1)}{\operatorname{csch} \MathMLarg{a1}{x}}`), operands: ops('x') },
  { id: 'arcosh-operatorname', concept: 'arc-hyperbolic-cosine', source: R`$\operatorname{arcosh} x$`, select: R`\operatorname{arcosh} x`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-cosine:function($value)}{\operatorname{arcosh} \MathMLarg{value}{x}}`), operands: ops('x') },
  { id: 'artanh-parens', concept: 'arc-hyperbolic-tangent', source: R`$\operatorname{artanh}(v/c)$`, select: R`\operatorname{artanh}(v/c)`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-tangent:function($value)}{\operatorname{artanh}(\MathMLarg{value}{v/c})}`), operands: ops('v/c') },
  { id: 'arsech-operatorname', concept: 'arc-hyperbolic-secant', source: R`$\operatorname{arsech} y$`, select: R`\operatorname{arsech} y`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-secant:function($value)}{\operatorname{arsech} \MathMLarg{value}{y}}`), operands: ops('y') },
  { id: 'arcsch-parens', concept: 'arc-hyperbolic-cosecant', source: R`$\operatorname{arcsch}(2x)$`, select: R`\operatorname{arcsch}(2x)`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-cosecant:function($value)}{\operatorname{arcsch}(\MathMLarg{value}{2x})}`), operands: ops('2x') },
  { id: 'arcoth-operatorname', concept: 'arc-hyperbolic-cotangent', source: R`$\operatorname{arcoth} t$`, select: R`\operatorname{arcoth} t`,
    expect: ready(R`\MathMLintent{arc-hyperbolic-cotangent:function($value)}{\operatorname{arcoth} \MathMLarg{value}{t}}`), operands: ops({ text: 't', nth: 3 }) },
  // \sinh^{-1} x: the -1 would not be read if only x were the operand, so the tool asks.
  { id: 'sinh-inverse-script', concept: 'arc-hyperbolic-sine', source: R`$\sinh^{-1} x$`, select: R`\sinh^{-1} x`,
    expect: needs('lossy', R`\MathMLintent{arc-hyperbolic-sine:function($value)}{\sinh^{-1} \MathMLarg{value}{x}}`), operands: ops('x') },

  // Logarithms. logarithm($a1,$a2) is "log base $a2 of $a1": the base is
  // written FIRST but is the SECOND operand (order from the wording).
  { id: 'log-prefix', concept: 'logarithm', source: R`$\log x$`, select: R`\log x`,
    expect: ready(R`\MathMLintent{logarithm:function($a1)}{\log \MathMLarg{a1}{x}}`), operands: ops('x') },
  { id: 'log-base', concept: 'logarithm', source: R`$\log_b x$`, select: R`\log_b x`,
    expect: ready(R`\MathMLintent{logarithm:function($a1,$a2)}{\log_{\MathMLarg{a2}{b}} \MathMLarg{a1}{x}}`), operands: ops('x', 'b') },
  { id: 'log-base-parens', concept: 'logarithm', source: R`$\log_{2}(n+1)$`, select: R`\log_{2}(n+1)`,
    expect: ready(R`\MathMLintent{logarithm:function($a1,$a2)}{\log_{\MathMLarg{a2}{2}}(\MathMLarg{a1}{n+1})}`), operands: ops('n+1', '2') },
  { id: 'ln-parens', concept: 'natural-logarithm', source: R`$\ln(1+x)$`, select: R`\ln(1+x)`,
    expect: ready(R`\MathMLintent{natural-logarithm:function($a1)}{\ln(\MathMLarg{a1}{1+x})}`), operands: ops('1+x') },
  { id: 'ln-prefix', concept: 'natural-logarithm', source: R`$\ln x$`, select: R`\ln x`,
    expect: ready(R`\MathMLintent{natural-logarithm:function($a1)}{\ln \MathMLarg{a1}{x}}`), operands: ops('x') },
  { id: 'exp-parens', concept: 'exponential', source: R`$\exp(-x^2)$`, select: R`\exp(-x^2)`,
    expect: ready(R`\MathMLintent{exponential:function($a1)}{\exp(\MathMLarg{a1}{-x^2})}`), operands: ops('-x^2') },
  // e^x: base or exponent? The tool cannot know, so it asks.
  { id: 'exp-e-power', concept: 'exponential', source: R`$e^{x}$`, select: R`e^{x}`,
    expect: needs(null, R`\MathMLintent{exponential:function($a1)}{e^{\MathMLarg{a1}{x}}}`), operands: ops('x') },
  { id: 'exponential-e-base', concept: 'exponential-e', source: R`$e^{x}$`, select: 'e',
    expect: ready(R`\MathMLintent{exponential-e:nofix}{e}`), operands: [] },

  // Complex numbers.
  { id: 'real-part-prefix', concept: 'real-part', source: R`$\Re z$`, select: R`\Re z`,
    expect: ready(R`\MathMLintent{real-part:function($value)}{\Re \MathMLarg{value}{z}}`), operands: ops('z') },
  { id: 'imaginary-part-parens', concept: 'imaginary-part', source: R`$\operatorname{Im}(z+w)$`, select: R`\operatorname{Im}(z+w)`,
    expect: ready(R`\MathMLintent{imaginary-part:function($a1)}{\operatorname{Im}(\MathMLarg{a1}{z+w})}`), operands: ops('z+w') },
  { id: 'complex-arg-prefix', concept: 'complex-arg', source: R`$\arg z$`, select: R`\arg z`,
    expect: ready(R`\MathMLintent{complex-arg:function($a1)}{\arg \MathMLarg{a1}{z}}`), operands: ops('z') },
  { id: 'conjugate-overline', concept: 'complex-conjugate', source: R`$\overline{z}$`, select: R`\overline{z}`,
    expect: ready(R`\MathMLintent{complex-conjugate:function($value)}{\overline{\MathMLarg{value}{z}}}`), operands: ops('z') },
  { id: 'conjugate-bar-unbraced', concept: 'complex-conjugate', source: R`$\bar z$`, select: R`\bar z`,
    expect: ready(R`\MathMLintent{complex-conjugate:function($value)}{\bar {\MathMLarg{value}{z}}}`), operands: ops('z') },
  { id: 'conjugate-star', concept: 'complex-conjugate', source: R`$z^*$`, select: R`z^*`,
    expect: ready(R`\MathMLintent{complex-conjugate:function($value)}{\MathMLarg{value}{z}^*}`), operands: ops('z') },
  // F4: an operand with its own subscript, then a superscript: braces needed.
  { id: 'conjugate-star-subscripted', concept: 'complex-conjugate', source: R`$z_k^*$`, select: R`z_k^*`,
    expect: ready(R`\MathMLintent{complex-conjugate:function($value)}{{\MathMLarg{value}{z_k}}^*}`), operands: ops('z_k') },

  // Derivatives written with primes and dots.
  { id: 'prime', concept: 'prime-notation', source: R`$f'(x)$`, select: R`f'`,
    expect: ready(R`\MathMLintent{prime-notation:postfix($a)}{\MathMLarg{a}{f}'}`), operands: ops('f') },
  { id: 'prime-double', concept: 'prime-notation', source: R`$y''$`, select: R`y''`,
    expect: ready(R`\MathMLintent{prime-notation:postfix($a)}{\MathMLarg{a}{y}''}`), operands: ops('y') },
  { id: 'prime-subscripted', concept: 'prime-notation', source: R`$f_n'$`, select: R`f_n'`,
    expect: ready(R`\MathMLintent{prime-notation:postfix($a)}{{\MathMLarg{a}{f_n}}'}`), operands: ops('f_n') },
  { id: 'time-derivative-dot', concept: 'time-derivative', source: R`$\dot{x}=v$`, select: R`\dot{x}`,
    expect: ready(R`\MathMLintent{time-derivative:function($a)}{\dot{\MathMLarg{a}{x}}}`), operands: ops('x') },
  { id: 'gradient-nabla', concept: 'gradient', source: R`$\nabla f$`, select: R`\nabla f`,
    expect: ready(R`\MathMLintent{gradient:function($a1)}{\nabla \MathMLarg{a1}{f}}`), operands: ops('f') },

  // Evaluation bars. evaluate has generated operand names (a1..a3) and no
  // wording, so its order is the reading order: expression, lower, upper,
  // with a warning. The upper limit written first must NOT flip (F1).
  // [CLAUDE 2026-11-08] evaluate now has a kernel form, which confirms the operand order: no order-unconfirmed warning.
  { id: 'evaluate-big-bar', concept: 'evaluate', source: R`$F(x)\Big|_{0}^{1}$`, select: R`F(x)\Big|_{0}^{1}`,
    expect: ready(R`\MathMLintent{evaluate:function($expr,$lower,$upper)}{\MathMLarg{expr}{F(x)}\Big|_{\MathMLarg{lower}{0}}^{\MathMLarg{upper}{1}}}`), operands: ops('F(x)', '0', '1') },
  { id: 'evaluate-upper-first', concept: 'evaluate', source: R`$F\Big|^{1}_{0}$`, select: R`F\Big|^{1}_{0}`,
    expect: ready(R`\MathMLintent{evaluate:function($expr,$lower,$upper)}{\MathMLarg{expr}{F}\Big|^{\MathMLarg{upper}{1}}_{\MathMLarg{lower}{0}}}`), operands: ops('F', '0', '1') },
  { id: 'evaluate-left-dot', concept: 'evaluate', source: R`$\left.F(x)\right|_a^b$`, select: R`\left.F(x)\right|_a^b`,
    expect: ready(R`\MathMLintent{evaluate:function($expr,$lower,$upper)}{\left.\MathMLarg{expr}{F(x)}\right|_{\MathMLarg{lower}{a}}^{\MathMLarg{upper}{b}}}`), operands: ops('F(x)', 'a', 'b') },
  { id: 'evaluate-brackets', concept: 'evaluate', source: R`$\left[x^2\right]_{0}^{2}$`, select: R`\left[x^2\right]_{0}^{2}`,
    expect: ready(R`\MathMLintent{evaluate:function($expr,$lower,$upper)}{\left[\MathMLarg{expr}{x^2}\right]_{\MathMLarg{lower}{0}}^{\MathMLarg{upper}{2}}}`), operands: ops('x^2', '0', { text: '2', nth: 2 }) },
  { id: 'evaluate-plain-bar-bare-scripts', concept: 'evaluate', source: R`$F|_0^1$`, select: R`F|_0^1`,
    expect: ready(R`\MathMLintent{evaluate:function($expr,$lower,$upper)}{\MathMLarg{expr}{F}|_{\MathMLarg{lower}{0}}^{\MathMLarg{upper}{1}}}`), operands: ops('F', '0', '1') },
  { id: 'evaluated-at', concept: 'evaluated-at', source: R`$f(x)\big|_{x=0}$`, select: R`f(x)\big|_{x=0}`,
    expect: ready(R`\MathMLintent{evaluated-at:infix($a1,$a2)}{\MathMLarg{a1}{f(x)}\big|_{\MathMLarg{a2}{x=0}}}`), operands: ops('f(x)', 'x=0') },

  // Sums, products, limits: the number of operands picks the core form.
  { id: 'sum-from-to', concept: 'sum', source: R`$\sum_{i=1}^{n} a_i$`, select: R`\sum_{i=1}^{n} a_i`,
    expect: ready(R`\MathMLintent{sum:function($a1,$a2,$a3)}{\sum_{\MathMLarg{a1}{i=1}}^{\MathMLarg{a2}{n}} \MathMLarg{a3}{a_i}}`), operands: ops('i=1', 'n', 'a_i') },
  { id: 'sum-upper-first', concept: 'sum', source: R`$\sum^{n}_{i=1} a_i$`, select: R`\sum^{n}_{i=1} a_i`,
    expect: ready(R`\MathMLintent{sum:function($a1,$a2,$a3)}{\sum^{\MathMLarg{a2}{n}}_{\MathMLarg{a1}{i=1}} \MathMLarg{a3}{a_i}}`), operands: ops('i=1', 'n', 'a_i') },
  { id: 'sum-over', concept: 'sum', source: R`$\sum_{k} b_k$`, select: R`\sum_{k} b_k`,
    expect: ready(R`\MathMLintent{sum:function($a1,$a2)}{\sum_{\MathMLarg{a1}{k}} \MathMLarg{a2}{b_k}}`), operands: ops('k', { text: 'b_k' }) },
  { id: 'sum-plain', concept: 'sum', source: R`$\sum a_n$`, select: R`\sum a_n`,
    expect: ready(R`\MathMLintent{sum:function($a1)}{\sum \MathMLarg{a1}{a_n}}`), operands: ops('a_n') },
  { id: 'product-from-to', concept: 'product', source: R`$\prod_{k=1}^{n} k$`, select: R`\prod_{k=1}^{n} k`,
    expect: ready(R`\MathMLintent{product:function($a1,$a2,$a3)}{\prod_{\MathMLarg{a1}{k=1}}^{\MathMLarg{a2}{n}} \MathMLarg{a3}{k}}`), operands: ops('k=1', 'n', { text: 'k', nth: 2 }) },
  // limit is "limit as $a1" (core, one operand): only \lim_{...} is labelled.
  { id: 'limit-operator', concept: 'limit', source: R`$\lim_{x\to 0} \frac{\sin x}{x}$`, select: R`\lim_{x\to 0}`,
    expect: ready(R`\MathMLintent{limit:prefix($a1)}{\lim_{\MathMLarg{a1}{x\to 0}}}`), operands: ops(R`x\to 0`) },
  { id: 'limit-with-body', concept: 'limit', source: R`$\lim_{x\to 0} \frac{\sin x}{x}$`, select: R`\lim_{x\to 0} \frac{\sin x}{x}`,
    expect: needs(null) },
  { id: 'tends-to', concept: 'tends-to', source: R`$n\to\infty$`, select: R`n\to\infty`,
    expect: ready(R`\MathMLintent{tends-to:infix($a1,$a2)}{\MathMLarg{a1}{n}\to\MathMLarg{a2}{\infty}}`), operands: ops('n', R`\infty`) },
  // [CLAUDE 2026-11-08, later] the + / - is notation, not part of the second part [NICHOLAS 2026-11-08]
  // (reading test: "x tends to from above a superscript plus"). The shape finder reads a^{+} as one piece,
  // so the kernel form disagrees and the core asks; the author marks x and a.
  { id: 'tends-to-from-above', concept: 'tends-to-from-above', source: R`$x \to a^{+}$`, select: R`x \to a^{+}`,
    expect: needs('example-disagrees', R`\MathMLintent{tends-to-from-above:infix($a1,$a2)}{\MathMLarg{a1}{x} \to \MathMLarg{a2}{a}^{+}}`), operands: ops('x', 'a') },
  { id: 'tends-to-from-below', concept: 'tends-to-from-below', source: R`$x \to a^{-}$`, select: R`x \to a^{-}`,
    expect: needs('example-disagrees', R`\MathMLintent{tends-to-from-below:infix($a1,$a2)}{\MathMLarg{a1}{x} \to \MathMLarg{a2}{a}^{-}}`), operands: ops('x', 'a') },
  { id: 'differential-d', concept: 'differential-d', source: R`$\int f(x)\,dx$`, select: 'd', nth: 1,
    expect: ready(R`\MathMLintent{differential-d:nofix}{d}`), operands: [] },

  // Concepts whose core arity does not fit the usual notation: the tool asks.
  { id: 'definite-integral', concept: 'definite-integral', source: R`$\int_0^1 x^2\,dx$`, select: R`\int_0^1 x^2\,dx`, expect: needs(null) },
  { id: 'derivative-leibniz', concept: 'derivative', source: R`$\frac{dy}{dx}$`, select: R`\frac{dy}{dx}`, expect: needs(null) },
  { id: 'partial-derivative', concept: 'partial-derivative', source: R`$\frac{\partial f}{\partial x}$`, select: R`\frac{\partial f}{\partial x}`, expect: needs('arity-unknown') },
  // [CLAUDE 2026-11-08] divergence now has a kernel form (one part, W3C rule), but no shape reads
  // \nabla\cdot as a prefix, so the selection shows 2 parts: still needs-operands, reason arity-mismatch.
  { id: 'divergence', concept: 'divergence', source: R`$\nabla\cdot\mathbf{F}$`, select: R`\nabla\cdot\mathbf{F}`, expect: needs('arity-mismatch') },
  { id: 'curl', concept: 'curl', source: R`$\nabla\times\mathbf{F}$`, select: R`\nabla\times\mathbf{F}`, expect: needs('arity-unknown') },
  { id: 'laplacian', concept: 'laplacian', source: R`$\nabla^2 u$`, select: R`\nabla^2 u`, expect: needs('arity-unknown') },
  // [CLAUDE 2026-11-08] change now has a kernel form (\Delta \MathMLarg{quantity}{x}, prefix), which
  // confirms the reading: the core labels it without help.
  { id: 'change', concept: 'change', source: R`$\Delta x$`, select: R`\Delta x`,
    expect: ready(R`\MathMLintent{change:prefix($quantity)}{\Delta \MathMLarg{quantity}{x}}`), operands: ops('x') },
  // [CLAUDE 2026-11-08, later] piecewise has role "property" (Reference ruling 11, 2026-11-07): written
  // ":piecewise" on an element, not a concept with parts, so the snippet tool refuses it [NICHOLAS 2026-11-08].
  // (Was needs('arity-unknown') before the ruling.)
  { id: 'piecewise', concept: 'piecewise', source: R`$f(x)=\begin{cases} 1 & x>0 \\ 0 & x\le 0 \end{cases}$`,
    select: R`\begin{cases} 1 & x>0 \\ 0 & x\le 0 \end{cases}`, expect: refused('not-a-concept') },

  // "Not used" concepts are refused, naming the replacement.
  { id: 'not-used-large-op', concept: 'large-op', source: R`$\sum_i a_i$`, select: R`\sum_i a_i`, expect: refused('not-used') },
  { id: 'not-used-limit-sup', concept: 'limit-sup', source: R`$\limsup a_n$`, select: R`\limsup a_n`, expect: refused('not-used') },
  { id: 'not-used-limit-inf', concept: 'limit-inf', source: R`$\liminf a_n$`, select: R`\liminf a_n`, expect: refused('not-used') },
  { id: 'not-used-log-base', concept: 'logarithm-with-base', source: R`$\log_b x$`, select: R`\log_b x`, expect: refused('not-used') },

  // ---- 2. Open-list concepts written differently from their example -------
  { id: 'bergman-space-other-letters', concept: 'bergman-space', source: R`$A^{p}(\Omega)$`, select: R`A^{p}(\Omega)`,
    expect: ready(R`\MathMLintent{bergman-space:infix($power,$space)}{A^{\MathMLarg{power}{p}}(\MathMLarg{space}{\Omega})}`), operands: ops('p', R`\Omega`) },
  { id: 'dirichlet-kernel-other-letters', concept: 'dirichlet-kernel', source: R`$D_{N}(t)$`, select: R`D_{N}(t)`,
    expect: ready(R`\MathMLintent{dirichlet-kernel:function($number,$value)}{D_{\MathMLarg{number}{N}}(\MathMLarg{value}{t})}`), operands: ops('N', 't') },
  { id: 'wronskian-subscripts', concept: 'wronskian', source: R`$W(y_1, y_2)$`, select: R`W(y_1, y_2)`,
    expect: ready(R`\MathMLintent{wronskian:function($f,$g)}{W(\MathMLarg{f}{y_1}, \MathMLarg{g}{y_2})}`), operands: ops('y_1', 'y_2') },
  { id: 'hardy-space-number', concept: 'hardy-space', source: R`$H^{2}$`, select: R`H^{2}`,
    expect: ready(R`\MathMLintent{hardy-space:function($exponent)}{H^{\MathMLarg{exponent}{2}}}`), operands: ops('2') },
  { id: 'fourier-hat-g', concept: 'fourier-transform', source: R`$\hat{g}$`, select: R`\hat{g}`,
    expect: ready(R`\MathMLintent{fourier-transform:function($function)}{\hat{\MathMLarg{function}{g}}}`), operands: ops('g') },
  { id: 'laplace-transform-y', concept: 'laplace-transform', source: R`$\mathcal{L}\{y\}$`, select: R`\mathcal{L}\{y\}`,
    expect: ready(R`\MathMLintent{laplace-transform:function($function)}{\mathcal{L}\{\MathMLarg{function}{y}\}}`), operands: ops('y') },
  { id: 'convolution-other-letters', concept: 'convolution', source: R`$(g * h)(t)$`, select: R`g * h`,
    expect: ready(R`\MathMLintent{convolution:infix($x,$y)}{\MathMLarg{x}{g} * \MathMLarg{y}{h}}`), operands: ops('g', 'h') },
  { id: 'uniformly-convergent', concept: 'uniformly-convergent', source: R`$f_n \rightrightarrows f$`, select: R`f_n \rightrightarrows f`,
    expect: ready(R`\MathMLintent{uniformly-convergent:infix($function,$limit)}{\MathMLarg{function}{f_n} \rightrightarrows \MathMLarg{limit}{f}}`), operands: ops('f_n', { text: 'f', nth: 2 }) },
  // The export's example marks only f in \Delta_h^n f(x); the tool would take
  // f(x), so it disagrees with the example and asks instead of guessing.
  { id: 'forward-difference-other-letters', concept: 'forward-difference', source: R`$\Delta_{h}^{n} g(x)$`, select: R`\Delta_{h}^{n} g(x)`,
    expect: needs('example-disagrees', R`\MathMLintent{forward-difference:function($step,$order,$function)}{\Delta_{\MathMLarg{step}{h}}^{\MathMLarg{order}{n}} \MathMLarg{function}{g}(x)}`), operands: ops('h', 'n', 'g') },

  // ---- 3. Selection checks --------------------------------------------------
  { id: 'check-empty', concept: 'hyperbolic-sine', source: R`$\sinh x$`, range: [3, 3], expect: refused('empty-selection') },
  { id: 'check-spaces-only', concept: 'hyperbolic-sine', source: R`$a +   b$`, range: [4, 7], expect: refused('empty-selection') },
  { id: 'check-unknown-concept', concept: 'no-such-concept', source: R`$x$`, select: 'x', expect: refused('unknown-concept') },
  { id: 'check-outside-math', concept: 'hyperbolic-sine', source: R`Let $x$ be real`, select: 'Let', expect: refused('not-in-math') },
  { id: 'check-two-regions', concept: 'hyperbolic-sine', source: R`$a$ and $b$`, select: R`a$ and $b`, expect: refused('not-in-math') },
  { id: 'check-in-text', concept: 'hyperbolic-sine', source: R`$x \text{ if } y$`, select: 'if', expect: refused('in-text') },
  { id: 'check-cuts-braces', concept: 'open-interval', source: R`$\frac{a}{b}$`, select: R`a}{b`, expect: refused('cuts-structure') },
  { id: 'check-cuts-left-right', concept: 'open-interval', source: R`$\left( x + y \right)$`, select: R`\left( x`, expect: refused('cuts-structure') },
  { id: 'check-cuts-command', concept: 'open-interval', source: R`$\frac{a}{b}$`, select: R`\frac{a}`, expect: refused('cuts-command') },
  { id: 'check-cuts-script', concept: 'complex-conjugate', source: R`$A^{T}_{i} B$`, select: R`A^{T}`, expect: refused('cuts-script') },
  { id: 'check-table-cells', concept: 'open-interval', source: R`$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$`, select: R`a & b`, expect: refused('table-cells') },
  // Added after the typed-operand path wrote \operatorname{arco\MathMLarg{a1}{t}h}:
  // a function name is not math to label, and part of a word in a font command is refused.
  { id: 'check-in-operator-name', concept: 'hyperbolic-sine', source: R`$\operatorname{arcoth} t$`, range: [19, 20], expect: refused('in-name') },
  { id: 'check-cuts-font-word', concept: 'hyperbolic-sine', source: R`$\mathrm{Log}(z)$`, select: 'o', expect: refused('cuts-name') },
  { id: 'check-math-does-not-parse', concept: 'open-interval', source: R`$\left( x + y$`, select: 'x', expect: refused('math-does-not-parse') },
  // F3: kernel markup already there.
  { id: 'check-labelled-whole-command', concept: 'absolute-value', source: R`$\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}$`,
    select: R`\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}`, expect: refused('already-labelled') },
  { id: 'check-labelled-notation', concept: 'absolute-value', source: R`$\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}$`,
    select: R`\left|\MathMLarg{a1}{x}\right|`, expect: refused('already-labelled') },
  { id: 'check-labelled-operand-command', concept: 'absolute-value', source: R`$\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}$`,
    select: R`\MathMLarg{a1}{x}`, expect: refused('already-labelled') },
  { id: 'check-labelled-shorthand', concept: 'absolute-value', source: R`$\intent{absolute-value}{|\iarg{x}|}$`,
    select: R`|\iarg{x}|`, expect: refused('already-labelled') },
  { id: 'check-in-label-name', concept: 'absolute-value', source: R`$\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}$`,
    select: 'absolute-value', expect: refused('in-label') },

  // ---- Nesting and braces ---------------------------------------------------
  // Labelling inside an existing operand: braces round the new label, and
  // operand names that do not clash with the outer label's.
  { id: 'nest-inside-operand', concept: 'hyperbolic-sine', source: R`$\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{\sinh x}\right|}$`,
    select: R`\sinh x`, expect: ready(R`{\MathMLintent{hyperbolic-sine:function($a1-2)}{\sinh \MathMLarg{a1-2}{x}}}`), operands: ops('x') },
  // An existing label as the operand of a new one: braces round the old label.
  { id: 'nest-label-as-operand', concept: 'hyperbolic-sine', source: R`$\sinh \MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}$`,
    select: R`\sinh \MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}`,
    expect: ready(R`\MathMLintent{hyperbolic-sine:function($a1-2)}{\sinh \MathMLarg{a1-2}{{\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}}}}`),
    operands: ops(R`\MathMLintent{absolute-value($a1)}{\left|\MathMLarg{a1}{x}\right|}`) },
  // A label written as an unbraced superscript or command argument needs braces.
  { id: 'brace-label-as-bare-script', concept: 'exponential-e', source: R`$x^e$`, select: 'e',
    expect: ready(R`{\MathMLintent{exponential-e:nofix}{e}}`), operands: [] },
  { id: 'brace-label-as-bare-argument', concept: 'exponential-e', source: R`$\sqrt e$`, select: 'e',
    expect: ready(R`{\MathMLintent{exponential-e:nofix}{e}}`), operands: [] },
  // A label whose own subscript is followed by a superscript outside it (e_1^2,
  // selecting e_1): braces, or the ^2 would merge into the label (measured).
  { id: 'brace-label-before-script', concept: 'exponential-e', source: R`$e_1^2$`, select: 'e_1',
    expect: ready(R`{\MathMLintent{exponential-e:nofix}{e_1}}`), operands: [] },
  // Whitespace round the selection is ignored.
  { id: 'selection-trimmed', concept: 'hyperbolic-sine', source: R`$y = \sinh x $`, select: R` \sinh x `,
    expect: ready(R`\MathMLintent{hyperbolic-sine:function($a1)}{\sinh \MathMLarg{a1}{x}}`), operands: ops('x') },
];
