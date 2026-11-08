// probes/probe-braces.mjs — where does the kernel writer need extra braces?
// [CLAUDE 2026-11-02] Track C, MEASURING. Read-only: converts each text with
// the platform's Baseline converter and runs the same checks the tests use.
// Run: node probes/probe-braces.mjs > probes/probe-braces-out.txt
import { checkKernel } from '../test/lib/mathml.mjs';

const cases = [
  // Script after an operand
  ['A^T, operand bare', String.raw`\MathMLintent{transpose($a)}{\MathMLarg{a}{A}^T}`, 'transpose($a)', { a: 'A' }, 'A^T'],
  ['A^T, operand braced', String.raw`\MathMLintent{transpose($a)}{{\MathMLarg{a}{A}}^T}`, 'transpose($a)', { a: 'A' }, 'A^T'],
  ['A_i^T, operand bare', String.raw`\MathMLintent{transpose($a)}{\MathMLarg{a}{A_i}^T}`, 'transpose($a)', { a: 'A_i' }, 'A_i^T'],
  ['A_i^T, operand braced', String.raw`\MathMLintent{transpose($a)}{{\MathMLarg{a}{A_i}}^T}`, 'transpose($a)', { a: 'A_i' }, 'A_i^T'],
  ["f', operand bare", String.raw`\MathMLintent{prime-notation($f)}{\MathMLarg{f}{f}'}`, 'prime-notation($f)', { f: 'f' }, "f'"],
  ["f_n', operand bare", String.raw`\MathMLintent{prime-notation($f)}{\MathMLarg{f}{f_n}'}`, 'prime-notation($f)', { f: 'f_n' }, "f_n'"],
  ["f_n', operand braced", String.raw`\MathMLintent{prime-notation($f)}{{\MathMLarg{f}{f_n}}'}`, 'prime-notation($f)', { f: 'f_n' }, "f_n'"],
  // Operand as a bare script argument (no braces in the source)
  ['norm _2, script operand bare', String.raw`\MathMLintent{subscripted-norm($v,$p)}{\|\MathMLarg{v}{v}\|_\MathMLarg{p}{2}}`, 'subscripted-norm($v,$p)', { v: 'v', p: '2' }, String.raw`\|v\|_2`],
  ['norm _2, script operand braced', String.raw`\MathMLintent{subscripted-norm($v,$p)}{\|\MathMLarg{v}{v}\|_{\MathMLarg{p}{2}}}`, 'subscripted-norm($v,$p)', { v: 'v', p: '2' }, String.raw`\|v\|_2`],
  // Unbraced command argument
  ['sqrt x, braced arg', String.raw`\MathMLintent{square-root($a)}{\sqrt{\MathMLarg{a}{x}}}`, 'square-root($a)', { a: 'x' }, String.raw`\sqrt x`],
  // A new label written inside an existing operand
  ['label inside arg, bare', String.raw`\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{\MathMLintent{transpose($b)}{\MathMLarg{b}{A}^T}}\right|}`, 'absolute-value($a)', { a: 'A^T' }, String.raw`\left|A^T\right|`],
  ['label inside arg, braced', String.raw`\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{{\MathMLintent{transpose($b)}{\MathMLarg{b}{A}^T}}}\right|}`, 'absolute-value($a)', { a: 'A^T' }, String.raw`\left|A^T\right|`],
  ['inner label of the braced case', String.raw`\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{{\MathMLintent{transpose($b)}{\MathMLarg{b}{A}^T}}}\right|}`, 'transpose($b)', { b: 'A' }, 'A^T'],
  // Existing label as an operand of a new label (selection contains it)
  ['existing label as operand, bare', String.raw`\MathMLintent{transpose($m)}{\MathMLarg{m}{\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{A}\right|}}^T}`, 'transpose($m)', { m: String.raw`\left|A\right|` }, String.raw`\left|A\right|^T`],
  ['existing label as operand, braced', String.raw`\MathMLintent{transpose($m)}{{\MathMLarg{m}{{\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{A}\right|}}}}^T}`, 'transpose($m)', { m: String.raw`\left|A\right|` }, String.raw`\left|A\right|^T`],
  ['existing label as operand, braced, inner', String.raw`\MathMLintent{transpose($m)}{{\MathMLarg{m}{{\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{A}\right|}}}}^T}`, 'absolute-value($a)', { a: 'A' }, String.raw`\left|A\right|`],
  ['existing label as only operand, unbraced arg body', String.raw`\MathMLintent{transpose($m)}{{\MathMLarg{m}{\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{A}\right|}}}^T}`, 'transpose($m)', { m: String.raw`\left|A\right|` }, String.raw`\left|A\right|^T`],
  // A label whose selection is followed by a script outside it
  ['label then ^T, A_i, bare', String.raw`\MathMLintent{x-sub($a)}{\MathMLarg{a}{x}_i}^T`, 'x-sub($a)', { a: 'x' }, 'x_i'],
  ['label then ^T, A_i, braced', String.raw`{\MathMLintent{x-sub($a)}{\MathMLarg{a}{x}_i}}^T`, 'x-sub($a)', { a: 'x' }, 'x_i'],
  ['label then ^2, |x|, bare', String.raw`\MathMLintent{absolute-value($a)}{\left|\MathMLarg{a}{x}\right|}^2`, 'absolute-value($a)', { a: 'x' }, String.raw`\left|x\right|`],
  // Whole body is the operand
  ['whole body operand, bare', String.raw`\MathMLintent{blue-box($a)}{\MathMLarg{a}{x+1}}`, 'blue-box($a)', { a: 'x+1' }, 'x+1'],
  ['whole body operand, braced', String.raw`\MathMLintent{blue-box($a)}{{\MathMLarg{a}{x+1}}}`, 'blue-box($a)', { a: 'x+1' }, 'x+1'],
  // Operand names
  ['operand names a1 a2', String.raw`\MathMLintent{open-interval($a1,$a2)}{(\MathMLarg{a1}{a},\MathMLarg{a2}{b})}`, 'open-interval($a1,$a2)', { a1: 'a', a2: 'b' }, '(a,b)'],
  ['operand name with hyphen', String.raw`\MathMLintent{open-interval($lower-end,$upper-end)}{(\MathMLarg{lower-end}{a},\MathMLarg{upper-end}{b})}`, 'open-interval($lower-end,$upper-end)', { 'lower-end': 'a', 'upper-end': 'b' }, '(a,b)'],
  // Calculus shapes
  ['function application', String.raw`\MathMLintent{real-part($value)}{\operatorname{Re}(\MathMLarg{value}{z})}`, 'real-part($value)', { value: 'z' }, String.raw`\operatorname{Re}(z)`],
  ['function, two items', String.raw`\MathMLintent{wronskian($f,$g)}{W(\MathMLarg{f}{f}, \MathMLarg{g}{g})}`, 'wronskian($f,$g)', { f: 'f', g: 'g' }, 'W(f, g)'],
  ['function, sub head', String.raw`\MathMLintent{dirichlet-kernel($number,$value)}{D_{\MathMLarg{number}{n}}(\MathMLarg{value}{x})}`, 'dirichlet-kernel($number,$value)', { number: 'n', value: 'x' }, 'D_{n}(x)'],
  ['sinh x no parens', String.raw`\MathMLintent{hyperbolic-sine($a)}{\sinh \MathMLarg{a}{x}}`, 'hyperbolic-sine($a)', { a: 'x' }, String.raw`\sinh x`],
  ['sinh(x+1)', String.raw`\MathMLintent{hyperbolic-sine($a)}{\sinh(\MathMLarg{a}{x+1})}`, 'hyperbolic-sine($a)', { a: 'x+1' }, String.raw`\sinh(x+1)`],
  ['prefix L{f}', String.raw`\MathMLintent{laplace-transform($function)}{\mathcal{L}\{\MathMLarg{function}{f}\}}`, 'laplace-transform($function)', { function: 'f' }, String.raw`\mathcal{L}\{f\}`],
  ['definite integral', String.raw`\MathMLintent{definite-integral($lower,$upper,$integrand,$variable)}{\int_{\MathMLarg{lower}{a}}^{\MathMLarg{upper}{b}}\MathMLarg{integrand}{f(x)}\,d\MathMLarg{variable}{x}}`, 'definite-integral($lower,$upper,$integrand,$variable)', { lower: 'a', upper: 'b', integrand: 'f(x)', variable: 'x' }, String.raw`\int_{a}^{b}f(x)\,dx`],
  ['definite integral, bare scripts', String.raw`\MathMLintent{definite-integral($lower,$upper,$integrand,$variable)}{\int_{\MathMLarg{lower}{0}}^{\MathMLarg{upper}{1}} \MathMLarg{integrand}{x^2} \, d\MathMLarg{variable}{x}}`, 'definite-integral($lower,$upper,$integrand,$variable)', { lower: '0', upper: '1', integrand: 'x^2', variable: 'x' }, String.raw`\int_0^1 x^2 \, dx`],
  ['limit', String.raw`\MathMLintent{limit($variable,$point,$expression)}{\lim_{\MathMLarg{variable}{x}\to \MathMLarg{point}{a}} \MathMLarg{expression}{f(x)}}`, 'limit($variable,$point,$expression)', { variable: 'x', point: 'a', expression: 'f(x)' }, String.raw`\lim_{x\to a} f(x)`],
  ['sum', String.raw`\MathMLintent{sum($index,$upper,$term)}{\sum_{\MathMLarg{index}{i=1}}^{\MathMLarg{upper}{n}} \MathMLarg{term}{a_i}}`, 'sum($index,$upper,$term)', { index: 'i=1', upper: 'n', term: 'a_i' }, String.raw`\sum_{i=1}^{n} a_i`],
  ['derivative frac', String.raw`\MathMLintent{derivative($f,$x)}{\frac{d\MathMLarg{f}{y}}{d\MathMLarg{x}{x}}}`, 'derivative($f,$x)', { f: 'y', x: 'x' }, String.raw`\frac{dy}{dx}`],
  ['partial derivative frac', String.raw`\MathMLintent{partial-derivative($f,$x)}{\frac{\partial \MathMLarg{f}{f}}{\partial \MathMLarg{x}{x}}}`, 'partial-derivative($f,$x)', { f: 'f', x: 'x' }, String.raw`\frac{\partial f}{\partial x}`],
  ['evaluate Big bar', String.raw`\MathMLintent{evaluate($f,$lo,$hi)}{\MathMLarg{f}{F(x)}\Big|_{\MathMLarg{lo}{0}}^{\MathMLarg{hi}{1}}}`, 'evaluate($f,$lo,$hi)', { f: 'F(x)', lo: '0', hi: '1' }, String.raw`F(x)\Big|_{0}^{1}`],
  ['evaluate Big bar upper first', String.raw`\MathMLintent{evaluate($f,$lo,$hi)}{\MathMLarg{f}{F}\Big|^{\MathMLarg{hi}{1}}_{\MathMLarg{lo}{0}}}`, 'evaluate($f,$lo,$hi)', { f: 'F', lo: '0', hi: '1' }, String.raw`F\Big|^{1}_{0}`],
  ['evaluate brackets', String.raw`\MathMLintent{evaluate($f,$lo,$hi)}{\left[\MathMLarg{f}{F(x)}\right]_{\MathMLarg{lo}{a}}^{\MathMLarg{hi}{b}}}`, 'evaluate($f,$lo,$hi)', { f: 'F(x)', lo: 'a', hi: 'b' }, String.raw`\left[F(x)\right]_{a}^{b}`],
  ['hat accent', String.raw`\MathMLintent{fourier-transform($function)}{\hat{\MathMLarg{function}{f}}}`, 'fourier-transform($function)', { function: 'f' }, String.raw`\hat{f}`],
  ['overline accent', String.raw`\MathMLintent{complex-conjugate($value)}{\overline{\MathMLarg{value}{z}}}`, 'complex-conjugate($value)', { value: 'z' }, String.raw`\overline{z}`],
  ['label mid-row', String.raw`2\MathMLintent{absolute-value($a)}{|\MathMLarg{a}{x}|}+1`, 'absolute-value($a)', { a: 'x' }, '|x|'],
  ['infix', String.raw`\MathMLintent{convolution($x,$y)}{\MathMLarg{x}{f} * \MathMLarg{y}{g}}`, 'convolution($x,$y)', { x: 'f', y: 'g' }, 'f * g'],
  ['infix inside a sum', String.raw`h + \MathMLintent{convolution($x,$y)}{\MathMLarg{x}{f} * \MathMLarg{y}{g}}`, 'convolution($x,$y)', { x: 'f', y: 'g' }, 'f * g'],
  ['dot accent time derivative', String.raw`\MathMLintent{time-derivative($a)}{\dot{\MathMLarg{a}{x}}}`, 'time-derivative($a)', { a: 'x' }, String.raw`\dot{x}`],
  ['nullary', String.raw`\MathMLintent{euler-constant}{\gamma}`, 'euler-constant', {}, String.raw`\gamma`],
];

for (const [label, kernel, value, operands, notation] of cases) {
  const r = await checkKernel({ kernel, value, operands, notation });
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${label}\n     ${kernel}\n     ${r.summary}`);
  for (const p of r.problems) console.log(`     - ${p}`);
}
