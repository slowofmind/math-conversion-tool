// test/lib/fixtures.mjs — load the fixture files and turn a fixture's
// "select / nth" description into document offsets.
// [CLAUDE 2026-11-02] Track C, overnight plan section 5.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, '../fixtures');
export const EXPORT = join(HERE, '../../../math-conversion/intent-concepts.json');

/** Hand-written fixtures (an .mjs module, for String.raw) plus the generated
 *  example fixtures (JSON). */
export async function loadFixtures(group = 'calculus-analysis') {
  const ex = JSON.parse(readFileSync(join(FIXTURES, `examples-${group}.json`), 'utf8'));
  const handPath = join(FIXTURES, `hand-${group}.mjs`);
  const hand = existsSync(handPath) ? (await import(pathToFileURL(handPath).href)).fixtures : [];
  return { examples: ex.fixtures, hand, all: [...hand, ...ex.fixtures], skipped: ex.skipped };
}

export function loadExport() {
  return JSON.parse(readFileSync(EXPORT, 'utf8'));
}

/** Start of the nth (1-based) occurrence of needle in hay at or after from. */
export function nthIndex(hay, needle, nth = 1, from = 0) {
  let i = from - 1;
  for (let k = 0; k < nth; k++) { i = hay.indexOf(needle, i + 1); if (i < 0) return -1; }
  return i;
}

/** The fixture's selection as { start, end } in fx.source. */
export function selectionOf(fx) {
  if (fx.range) return { start: fx.range[0], end: fx.range[1] };
  const s = nthIndex(fx.source, fx.select, fx.nth ?? 1);
  if (s < 0) throw new Error(`${fx.id}: "${fx.select}" not found in the source`);
  return { start: s, end: s + fx.select.length };
}

/** The fixture's operands as document ranges, in concept order. */
export function operandRangesOf(fx, sel) {
  return (fx.operands ?? []).map(o => {
    const s = nthIndex(fx.source, o.text, o.nth ?? 1, sel.start);
    if (s < 0) throw new Error(`${fx.id}: operand "${o.text}" not found`);
    return { start: s, end: s + o.text.length };
  });
}
