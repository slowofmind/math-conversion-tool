// css-lite.mjs — minimal CSS reader for T3: rules and one level of @media.
export function parseCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; let i = 0;
  function block(media) {
    while (i < css.length) {
      const open = css.indexOf('{', i), close = css.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) return;
      const head = css.slice(i, open).trim(); i = open + 1;
      if (head.startsWith('@media')) { block(head); continue; }
      const end = css.indexOf('}', i); const body = css.slice(i, end); i = end + 1;
      const decls = {};
      for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
      for (const sel of head.split(',')) out.push({ media: media || null, sel: sel.trim().replace(/\s+/g, ' '), decls });
    }
  }
  block(null);
  return out;
}
// Resolve var(--x) recursively against a variable map.
export function resolve(v, vars, depth = 0) {
  if (depth > 20) throw new Error('var loop');
  return v.replace(/var\((--[\w-]+)\)/g, (_, n) => vars[n] === undefined ? `UNDEFINED(${n})` : resolve(vars[n], vars, depth + 1))
          .replace(/\s+/g, ' ').replace(/\s*!\s*important/, ' !important').trim();
}
// Effective declarations (vars resolved) for `sel` in light or dark scheme.
export function effective(rules, sel, dark) {
  const vars = {};
  for (const r of rules) if (r.sel === ':root' && (!r.media || (dark && /dark/.test(r.media)))) Object.assign(vars, r.decls);
  const decls = {};
  for (const r of rules) if (r.sel === sel && (!r.media || (dark && /dark/.test(r.media)))) Object.assign(decls, r.decls);
  const res = {}; for (const [k, v] of Object.entries(decls)) res[k] = resolve(v, vars);
  return res;
}
