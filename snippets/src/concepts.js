// src/concepts.js -- the concept list, read from the Reference tool's slim copy.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 steps 2-3 (first version, full export).
// [CLAUDE 2026-11-08] Rewritten for "slim layout 1" (math-conversion/intent-concepts-slim.json),
// build step 3. Decisions: intent-briefing/PLANNING-REFERENCE-SCHEMA-20261107.md, question 4, and
// chat 2026-11-08 [NICHOLAS 2026-11-08]: this module is the one gateway to the concept data; the
// snippet tool writes fixity into the markup; each concept's kernel forms (Reference
// data/concept-forms.js) give the intent value, the operand names and where each operand sits;
// concepts labelled "reads without markup" are hidden from search unless asked for.
// [CLAUDE 2026-11-08, later] [NICHOLAS 2026-11-08] Records with a `role` (Reference ruling 11,
// 2026-11-07: "internal" = names MathCAT's own rules produce; "property" = written `:name` on an
// element) are not concepts an author writes: never listed, never counted, and refused by
// checks.js checkConcept if asked for by name or key.
// Nothing about any concept is written here: names, operands, their order, arity, fixity, groups
// and source all come from the slim copy. The slim copy has no wording, levels or status.

export const LAYOUT = 'slim layout 1';

/** Index the slim copy: look concepts up by key ("custom:evaluate") or name.
 *  Throws when the file is not "slim layout 1": a different layout means the fields may differ. */
export function loadConceptIndex(slimJson) {
  const layout = slimJson?.meta?.layout;
  if (layout !== LAYOUT) throw new Error(`The concept list is "${layout ?? 'not labelled'}"; this snippet tool reads "${LAYOUT}". ` +
    'Rebuild the slim copy (Reference: node tools/export-slim.mjs --platform) or update the snippet tool.');
  const records = slimJson.concepts ?? [];
  const byKey = new Map(), byName = new Map();
  for (const r of records) {
    byKey.set(r.key ?? r.concept, r);
    if (!byName.has(r.concept)) byName.set(r.concept, []);
    byName.get(r.concept).push(r);
  }
  return {
    meta: slimJson.meta ?? {},
    records,
    get(k) {
      if (!k) return null;
      if (byKey.has(k)) return byKey.get(k);
      const same = byName.get(k);
      return same ? (same.find(r => !r.notUsed) ?? same[0]) : null;
    },
  };
}

/** "implies:infix($p,$q)" -> "implies:infix"; "set-of-primes:nofix" -> itself. */
export const headOf = intent => { const o = intent.indexOf('('); return o < 0 ? intent : intent.slice(0, o); };
const fixityIn = head => { const c = head.indexOf(':'); return c < 0 ? null : head.slice(c + 1); };

/** The concept's forms with a fixed number of operands, one per arity:
 *  [{ arity, operands:[names in concept order], fixity, head, intent, kernel, from }]
 *  head   what goes before the operand list in the intent value ("implies:infix");
 *  kernel the Reference's kernel notation (\MathMLintent{..}{{..\MathMLarg{n}{..}..}}) or null;
 *  from   'form' (a kernel form: names, fixity and operand positions are the Reference's),
 *         'variant' or 'record' (no kernel form: arity, names and fixity only).
 *  Kernel forms come first (the default one first). Empty when nothing records a fixed arity. */
export function formsOf(rec) {
  if (!rec) return [];
  const out = [];
  const kernels = [...(rec.forms ?? [])].sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0));
  for (const k of kernels) {
    const arity = k.operands.length;
    if (out.some(o => o.arity === arity)) continue;
    const head = headOf(k.intent);
    out.push({ arity, operands: k.operands, fixity: fixityIn(head), head, intent: k.intent, kernel: k.tex, from: 'form' });
  }
  const plain = (arity, operands, fixity, from) => ({ arity, operands: operands ?? [], fixity: fixity ?? null,
    head: fixity ? `${rec.concept}:${fixity}` : rec.concept, intent: null, kernel: null, from });
  for (const v of rec.variants ?? []) {
    if (typeof v.arity !== 'number' || out.some(o => o.arity === v.arity)) continue;
    out.push(plain(v.arity, v.operands, v.fixity ?? rec.fixity, 'variant'));
  }
  if (!out.length && typeof rec.arity === 'number') out.push(plain(rec.arity, rec.operands, rec.fixity, 'record'));
  return out;
}

/** Every kernel form of the concept (a concept may have several notations for one arity, e.g.
 *  \log_b x and \log_b(x)), in the formsOf entry shape. formsOf keeps one per arity for WRITING
 *  (the names and head are the same); this list is for EVIDENCE (shapes.js formEvidence).
 *  [CLAUDE 2026-11-08] */
export function kernelFormsOf(rec) {
  return (rec?.forms ?? []).map(k => {
    const head = headOf(k.intent);
    return { arity: k.operands.length, operands: k.operands, fixity: fixityIn(head), head, intent: k.intent, kernel: k.tex, from: 'form' };
  });
}

/** The order in which a wording template first mentions each operand, or null.
 *  [CLAUDE 2026-11-08] Not used by the core since slim layout 1 (the slim copy carries no wording;
 *  operand order comes from the kernel forms). Kept for snippets/probes/probe-wording-order-20261108.mjs. */
export function mentionOrder(wording, names) {
  if (!wording || !names.length) return null;
  const at = names.map(n => {
    const m = new RegExp(`\\$${n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w-])`).exec(wording);
    return m ? m.index : -1;
  });
  if (at.some(i => i < 0)) return null;
  return names.map((n, i) => [n, at[i]]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
}

const norm = s => String(s ?? '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A plain description of a record for lists and messages. */
export function describe(rec) {
  const forms = formsOf(rec);
  return {
    key: rec.key ?? rec.concept,
    concept: rec.concept,
    label: rec.concept.replace(/-/g, ' '),
    source: rec.source,
    groups: rec.groups ?? [],
    forms,
    hasKernelForm: forms.some(f => f.from === 'form'),
    arityText: forms.length ? forms.map(f => f.arity).join(' or ') : (rec.variableArity ? `${rec.variableArity}` : 'not recorded'),
    readsWithoutMarkup: !!rec.readsWithoutMarkup,
    notUsed: rec.notUsed ?? null,
    held: rec.held ?? null,
    role: rec.role ?? null,
  };
}

/**
 * Filter the list: query (name, key), subject group, source ('core' | 'open' | 'custom').
 * Left out unless asked for: not-used concepts, and concepts labelled "reads without markup".
 * Never listed: records with a role (MathCAT internal names, intent properties).
 * Best matches first: exact name, name starts with the query, every query word starts a name
 * word, name contains it, key contains it.
 */
export function searchConcepts(index, query = '', { group = null, source = null, includeNotUsed = false,
  includeReadsWithoutMarkup = false, limit = Infinity } = {}) {
  const q = norm(query), qWords = q ? q.split(' ') : [];
  const hits = [];
  for (const r of index.records) {
    if (r.role) continue;
    if (group && !(r.groups ?? []).includes(group)) continue;
    if (source && r.source !== source) continue;
    if (r.notUsed && !includeNotUsed) continue;
    if (r.readsWithoutMarkup && !includeReadsWithoutMarkup) continue;
    const name = norm(r.concept), words = name.split(' ');
    let score;
    if (!q) score = 5;
    else if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (qWords.every(w => words.some(x => x.startsWith(w)))) score = words[0].startsWith(qWords[0]) ? 2 : 2.5;
    else if (name.includes(q)) score = 3;
    else if (norm(r.key).includes(q)) score = 4;
    else continue;
    hits.push({ score, r });
  }
  hits.sort((a, b) => a.score - b.score || a.r.concept.localeCompare(b.r.concept) || String(a.r.key).localeCompare(String(b.r.key)));
  return hits.slice(0, limit).map(h => describe(h.r));
}

/** The subject groups that occur in the list, with counts (records with a role are not counted:
 *  search never lists them). */
export function groupsIn(index) {
  const counts = new Map();
  for (const r of index.records) if (!r.role) for (const g of r.groups ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
}

/** The sources that occur in the list, with counts (records with a role are not counted). */
export function sourcesIn(index) {
  const counts = new Map();
  for (const r of index.records) if (!r.role) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
