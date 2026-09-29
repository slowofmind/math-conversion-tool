// lib/edits.mjs — the edit channel.
//
// Every transform in this engine communicates by adding edits, never by
// rewriting text. An edit is a half-open span in BASELINE coordinates plus
// a replacement string. Edits are applied back-to-front so earlier offsets
// stay valid. Overlapping edits are a bug and are rejected loudly.

export function createEditList() {
  const items = [];

  function add({ start, end, replacement, by, note }) {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error(`edit from ${by}: start/end must be integers`);
    }
    if (end < start) {
      throw new Error(`edit from ${by}: end (${end}) before start (${start})`);
    }
    if (typeof replacement !== "string") {
      throw new Error(`edit from ${by}: replacement must be a string`);
    }
    items.push({ start, end, replacement, by: by || "unknown", note: note || "" });
  }

  // Touching spans are fine (end === next.start). True overlap is not.
  function validate() {
    const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (cur.start < prev.end) {
        throw new Error(
          `overlapping edits: [${prev.start},${prev.end}) from ${prev.by} ` +
          `and [${cur.start},${cur.end}) from ${cur.by}`
        );
      }
    }
    return sorted;
  }

  function apply(text) {
    const sorted = validate();
    let out = text;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const e = sorted[i];
      if (e.start > out.length || e.end > out.length) {
        throw new Error(`edit from ${e.by} out of range: [${e.start},${e.end}) ` +
          `but text length is ${out.length}`);
      }
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }
    return out;
  }

  function list() { return [...items]; }
  function count() { return items.length; }

  // Human-readable diff, for review UI and for debugging transforms.
  function describe(text, context = 18) {
    return validate().map((e) => {
      const before = text.slice(e.start, e.end);
      const lead = text.slice(Math.max(0, e.start - context), e.start);
      return {
        by: e.by, note: e.note, start: e.start, end: e.end,
        was: before, now: e.replacement,
        context: lead.replace(/\s+/g, " "),
      };
    });
  }

  return { add, validate, apply, list, count, describe };
}
