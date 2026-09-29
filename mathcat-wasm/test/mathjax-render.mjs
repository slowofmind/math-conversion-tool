// mathjax-render.mjs — renders MathML with the real MathJax 4.1.3 (Node, liteDOM)
// so T2 harvests from genuine <mjx-container> output, with hidden MathML on
// (MathCat Compatible mode) or off (MathJax speech mode).
//
// Windows: MathJax's Node loader builds component paths from the package's
// filesystem path, and Node's ESM loader rejects "C:\..." as a specifier.
// Giving the loader a file:// URL for the mathjax package fixes that and is
// harmless on Linux/macOS.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let MJ = null;
export async function renderMathJax(mathml, { assistive }) {
  if (!MJ) {
    const mjDir = dirname(require.resolve('mathjax/package.json'));
    MJ = await require('mathjax').init({
      loader: {
        paths: { mathjax: pathToFileURL(mjDir).href },
        load: ['input/mml', 'output/chtml', 'a11y/assistive-mml', 'adaptors/liteDOM'],
      },
    });
  }
  const doc = MJ.startup.document;
  doc.options.enableAssistiveMml = assistive;
  const node = MJ.mathml2chtml(mathml);
  return MJ.startup.adaptor.outerHTML(node);
}
