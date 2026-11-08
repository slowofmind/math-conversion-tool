// v2/latex-names.mjs — which command names LaTeX itself, a class or a package
// defines. Step 4 of PLAN-REPORT-ORDER-s284 (session 288).
//
// Plain terms: the tool reads only the author's files and Pandoc's table, so on
// its own it cannot tell \vfill (LaTeX's own) from \fitb (the course's) or \ce
// (the package mhchem's). This is a fixed list made once from TeX Live by
// make-latex-names.mjs and shipped as data/latex-names.json; the tool reads it
// and never runs TeX. Steps 5 (commands nobody understands) and 6 ("redefined
// before defined", split by who defines the name) ask it.
//
// What the list holds (data/README.md has the rest): every name defined
// (a) before \documentclass (LaTeX's own, primitives included, plus what
// \begin{document} adds under article), (b) after each class the corpus loads,
// minus (a), and (c) after each package the corpus loads, loaded alone under
// article, minus article. Internal names (with @, or expl3's : and _) are left
// out. Limits: a package loaded with options or after another can define a
// little more or less; a class or package not in the corpus is not in the list.
//
// Zero dependencies, as capability.mjs: createLatexNames takes parsed JSON, so
// it runs in the browser; reading the file from disk is latex-names-node.mjs.

const bare = (name) => String(name || "").replace(/^\\/, "");

export function createLatexNames(data) {
  const kernel = new Set(data.kernel || []);
  const classes = new Map(Object.entries(data.classes || {}).map(([k, v]) => [k, new Set(v)]));
  const packages = new Map(Object.entries(data.packages || {}).map(([k, v]) => [k, new Set(v)]));
  return {
    meta: data.meta || {},
    version: (data.meta || {}).texlive || null,
    knowsClass: (c) => classes.has(c),
    knowsPackage: (p) => packages.has(p),
    // Every place in the list that defines the name, whatever the document loads.
    definedBy(name) {
      const n = bare(name);
      return {
        kernel: kernel.has(n),
        classes: [...classes].filter(([, s]) => s.has(n)).map(([k]) => k),
        packages: [...packages].filter(([, s]) => s.has(n)).map(([k]) => k),
      };
    },
    // Who defines the name for a document with this class and these packages
    // (in load order): LaTeX itself, then the class, then the first package
    // loaded that defines it. null: none of them (or not in the list).
    originOf(name, { documentclass, packages: loaded = [] } = {}) {
      const n = bare(name);
      if (kernel.has(n)) return { from: "kernel" };
      if (documentclass && classes.has(documentclass) && classes.get(documentclass).has(n)) return { from: "class", name: documentclass };
      for (const p of loaded) if (packages.has(p) && packages.get(p).has(n)) return { from: "package", name: p };
      return null;
    },
  };
}
