// make-fixtures.mjs — regenerates fixtures.json (plan Appendix C).
// Hand-written MathML fixtures are listed here verbatim. Intent fixtures are
// produced by the PLATFORM's own TeX->MathML bundle so they match real output:
//   node make-fixtures.mjs <path-to>/math-conversion/mathjax-bundle-intent.js
// (fixtures.json as committed was generated from commit a6eed16.)
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const hand = [
  ['quadratic', '<math display="block"><mi>x</mi><mo>=</mo><mfrac><mrow><mo>&#x2212;</mo><mi>b</mi><mo>&#xB1;</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>&#x2212;</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></math>'],
  ['integral-mspace', '<math><msubsup><mo>&#x222B;</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mspace width="0.2em"></mspace><mi>d</mi><mi>x</mi><mo>=</mo><mfrac><mn>1</mn><mn>3</mn></mfrac></math>'],
  ['sum-limits', '<math display="block"><munderover><mo>&#x2211;</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>k</mi><mo>=</mo><mfrac><mrow><mi>n</mi><mo stretchy="false">(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo stretchy="false">)</mo></mrow><mn>2</mn></mfrac></math>'],
  ['derivative', '<math><mfrac><mrow><mi>d</mi><mi>y</mi></mrow><mrow><mi>d</mi><mi>x</mi></mrow></mfrac><mo>=</mo><mn>3</mn><msup><mi>x</mi><mn>2</mn></msup></math>'],
  ['pair-no-intent', '<math><mo stretchy="false">(</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo stretchy="false">)</mo></math>'],
  ['pair-intent-inner', '<math><mrow intent="open-interval($a,$b)"><mo>(</mo><mi arg="a">a</mi><mo>,</mo><mi arg="b">b</mi><mo>)</mo></mrow></math>'],
  ['pair-intent-root', '<math intent="open-interval($a,$b)"><mo>(</mo><mi arg="a">a</mi><mo>,</mo><mi arg="b">b</mi><mo>)</mo></math>'],
  ['capitals', '<math><mi>A</mi><mo>+</mo><mi>B</mi><mo>=</mo><mi>C</mi></math>'],
  ['matrix-2x2', '<math><mrow><mo>(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo>)</mo></mrow></math>'],
  ['chem-h2o-plain', '<math><msub><mi mathvariant="normal">H</mi><mn>2</mn></msub><mi mathvariant="normal">O</mi></math>'],
  ['malformed', '<math><mfrac><mi>a</mi></math>'],
];
const tex = [
  ['intent-card', '\\card{S}'],
  ['intent-norm', '\\norm{v}'],
  ['intent-openint', '\\openint{a}{b}'],
  ['intent-closedint', '\\closedint{a}{b}'],
  ['intent-braket', '\\braket{a}{b}'],
  ['intent-ketbra', '\\ketbra{a}{b}'],
  ['intent-conj', '\\conj{z}'],
  ['intent-transp', '\\transp{A}'],
  ['intent-ce-h2o', '\\ce{H2O}'],
];
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node make-fixtures.mjs <mathjax-bundle-intent.js>'); process.exit(2); }
const { tex2mml } = await import(pathToFileURL(bundle).href);
const out = hand.map(([name, mathml]) => ({ name, source: 'hand', mathml }));
for (const [name, t] of tex) out.push({ name, source: 'platform tex2mml', tex: t, mathml: tex2mml(t, false) });
writeFileSync(new URL('./fixtures.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote', out.length, 'fixtures');
