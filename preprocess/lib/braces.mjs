// lib/braces.mjs — shared brace-matching over raw source text.
//
// Used wherever the AST can locate a construct but not delimit it:
// unified-latex argument nodes carry position: null, so group boundaries
// have to be recovered from the text. Honours \{ and \} escapes and
// %-to-end-of-line comments.

export function skipBlank(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "%") { while (i < text.length && text[i] !== "\n") i++; continue; }
    return i;
  }
}

// Read one {...} group at or after i. Returns {start, end, inner} or null.
export function readGroup(text, i) {
  i = skipBlank(text, i);
  if (text[i] !== "{") return null;
  const start = i;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") { j++; continue; }
    if (c === "%") { while (j < text.length && text[j] !== "\n") j++; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { start, end: j + 1, inner: text.slice(start + 1, j) };
    }
  }
  return null;
}

// Read n consecutive groups. Returns an array or null if any is missing.
export function readGroups(text, i, n) {
  const out = [];
  let at = i;
  for (let k = 0; k < n; k++) {
    const g = readGroup(text, at);
    if (!g) return null;
    out.push(g);
    at = g.end;
  }
  return out;
}

// Is this offset inside a %-comment on its line?
export function inComment(text, offset) {
  let i = text.lastIndexOf("\n", offset - 1) + 1;
  for (; i < offset; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "%") return true;
  }
  return false;
}

// Read one [...] group at or after i, respecting braces, escapes and
// comments. Returns {start, end, inner} or null.
export function readBracket(text, i) {
  i = skipBlank(text, i);
  if (text[i] !== "[") return null;
  const start = i;
  let brace = 0;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") { j++; continue; }
    if (c === "%") { while (j < text.length && text[j] !== "\n") j++; continue; }
    if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === "]" && brace === 0) {
      return { start, end: j + 1, inner: text.slice(start + 1, j) };
    }
  }
  return null;
}

// How many consecutive [...] groups follow position i?
export function countBrackets(text, i) {
  let n = 0, at = i;
  for (;;) {
    const b = readBracket(text, at);
    if (!b) return { count: n, end: at };
    n++;
    at = b.end;
  }
}
