// src/concepts.js — the concept list, read from the Reference tool's export.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5 steps 2-3. Reads
// math-conversion/intent-concepts.json (track A's export, plan section 2).
// Nothing about any concept is written here: names, operands, their order,
// arity, wording, groups and levels all come from the export.

/** Index the export: look concepts up by key ("custom:evaluate") or name. */
export function loadConceptIndex(exportJson) {
  const records = exportJson.concepts ?? [];
  const byKey = new Map(), byName = new Map();
  for (const r of records) {
    byKey.set(r.key ?? r.concept, r);
    if (!byName.has(r.concept)) byName.set(r.concept, []);
    byName.get(r.concept).push(r);
  }
  return {
    meta: exportJson.meta ?? {},
    records,
    get(k) {
      if (!k) return null;
      if (byKey.has(k)) return byKey.get(k);
      const same = byName.get(k);
      return same ? (same.find(r => !r.notUsed) ?? same[0]) : null;
    },
  };
}

const firstText = w => (Array.isArray(w) ? w[0] : w) ?? null;

/** The concept's forms with a fixed number of operands:
 *  [{ arity, operands:[names in concept order], wording, fixity }].
 *  Empty when the export records no fixed arity (curl, partial-derivative ...). */
export function formsOf(rec) {
  if (!rec) return [];
  const out = [];
  for (const f of rec.forms ?? []) {
    if (typeof f.arity !== 'number' || out.some(o => o.arity === f.arity)) continue;
    out.push({ arity: f.arity, operands: f.operands ?? [], wording: firstText(f.wording), fixity: f.fixity ?? rec.fixity ?? null });
  }
  if (!out.length && typeof rec.arity === 'number')
    out.push({ arity: rec.arity, operands: rec.operands ?? [], wording: firstText(rec.wording), fixity: rec.fixity ?? null });
  return out;
}

/** The order in which a wording template first mentions each operand, or
 *  null when it does not mention them all: "log base $a2 of $a1" -> ['a2','a1']. */
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
    status: rec.status,
    groups: rec.groups ?? [],
    levels: rec.levels ?? [],
    forms,
    arityText: forms.length ? forms.map(f => f.arity).join(' or ') : (rec.variableArity ? `${rec.variableArity}` : 'not recorded'),
    wording: firstText(rec.wording),
    notUsed: rec.notUsed ?? null,
  };
}

/**
 * Filter the list: query (name, wording, key), group, level. Not-used
 * concepts are left out unless includeNotUsed. Best matches first:
 * exact name, name starts with the query, every query word starts a name
 * word, name contains it, wording contains it.
 */
export function searchConcepts(index, query = '', { group = null, level = null, includeNotUsed = false, limit = Infinity } = {}) {
  const q = norm(query), qWords = q ? q.split(' ') : [];
  const hits = [];
  for (const r of index.records) {
    if (group && !(r.groups ?? []).includes(group)) continue;
    if (level && !(r.levels ?? []).includes(level)) continue;
    if (r.notUsed && !includeNotUsed) continue;
    const name = norm(r.concept), words = name.split(' ');
    let score;
    if (!q) score = 5;
    else if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (qWords.every(w => words.some(x => x.startsWith(w)))) score = words[0].startsWith(qWords[0]) ? 2 : 2.5;
    else if (name.includes(q)) score = 3;
    else if (norm(firstText(r.wording)).includes(q)) score = 4;
    else if (norm(r.key).includes(q)) score = 4;
    else continue;
    hits.push({ score, r });
  }
  hits.sort((a, b) => a.score - b.score || a.r.concept.localeCompare(b.r.concept) || String(a.r.key).localeCompare(String(b.r.key)));
  return hits.slice(0, limit).map(h => describe(h.r));
}

/** The subject groups that occur in the export, with counts. */
export function groupsIn(index) {
  const counts = new Map();
  for (const r of index.records) for (const g of r.groups ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
}
