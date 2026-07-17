// mml-isotopes-browser.js — browser port of mml-isotopes.js.
// Identical logic; uses the browser's native DOMParser/XMLSerializer instead of
// @xmldom/xmldom. Rewrites mhchem fake isotope prescripts into real
// <mmultiscripts>/<mprescripts> so the XSL maps them to a correct Word m:sPre.

const MML_NS = 'http://www.w3.org/1998/Math/MathML';
const ISO_SIG = /^\{\\vphantom\{A\}\}\^\{\\hphantom\{([^{}]*)\}\}_\{\\hphantom\{([^{}]*)\}\}$/;

function nextElement(node) {
  let n = node.nextSibling;
  while (n && n.nodeType !== 1) n = n.nextSibling;
  return n;
}

function scriptNode(doc, text) {
  if (text === '') return doc.createElementNS(MML_NS, 'none');
  const tag = /^\d+$/.test(text) ? 'mn' : (/^[A-Za-z]+$/.test(text) ? 'mi' : 'mtext');
  const el = doc.createElementNS(MML_NS, tag);
  el.appendChild(doc.createTextNode(text));
  return el;
}

export function rewriteIsotopes(mml) {
  if (!mml.includes('\\hphantom{')) return mml;

  const doc = new DOMParser().parseFromString(mml, 'application/xml');
  const candidates = Array.from(doc.getElementsByTagName('msubsup'));

  for (const first of candidates) {
    if (!first.parentNode) continue;
    const sig = (first.getAttribute('data-latex') || '').match(ISO_SIG);
    if (!sig) continue;
    const mass = sig[1];
    const atomic = sig[2];

    let mspace = null;
    let n = nextElement(first);
    if (n && n.tagName === 'mspace') { mspace = n; n = nextElement(n); }
    const second = n;
    if (!second || second.tagName !== 'msubsup' ||
        !(second.getAttribute('data-latex') || '').includes('\\llap')) {
      continue;
    }
    const base = nextElement(second);
    if (!base) continue;

    const parent = first.parentNode;
    const mm = doc.createElementNS(MML_NS, 'mmultiscripts');
    mm.appendChild(base);
    mm.appendChild(doc.createElementNS(MML_NS, 'mprescripts'));
    mm.appendChild(scriptNode(doc, atomic));
    mm.appendChild(scriptNode(doc, mass));

    parent.insertBefore(mm, first);
    parent.removeChild(first);
    if (mspace && mspace.parentNode) mspace.parentNode.removeChild(mspace);
    if (second.parentNode) second.parentNode.removeChild(second);
  }

  return new XMLSerializer().serializeToString(doc);
}
