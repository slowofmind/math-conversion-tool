//
// Plain terms: a lookup table of what Pandoc's LaTeX reader does with each
// thing it knows about, so that "leave this alone" is a checked answer
// rather than a hope. 539 rows of data, no cleverness. Ask it three things:
// do you know this name, what do the rows say, and does Pandoc throw the
// content away.
//
// This is the CAPABILITY TABLE of DESIGN-V2 §3 and §5.5. DECIDE (§4.5)
// consults it to tell LEAVE from action; stage 6's expander uses it as the
// redefinition guard (rule 8); stage 7's VERIFY uses it to classify what
// Pandoc reports. The data is vendored at data/pandoc-latex-reader-index.json
// — see data/README.md for provenance and for two properties of the data
// that shape this module's API.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not synthesise the survey's
// five-way verdict vocabulary (FULL / SHORTCUT / PARTIAL / ABSENT /
// CORRUPTS). Those words are not a column in the data; deriving them from
// ast_node plus raw_tex is a judgement call, and the only consumer that
// needs the five-way answer is stage 7. Stage 5 asks the narrow questions
// it can answer exactly (judgement call: Stage 5, S5-1).
//
// TWO FACTS ABOUT THE DATA THAT THE API HAS TO RESPECT.
//
// 1. A NAME IS NOT UNIQUE. 524 distinct names over 539 rows. Fifteen names
//    hold more than one row because the same name sits in more than one of
//    Pandoc's dispatch maps: `textcolor` is inline AND block, `hspace` is
//    in treatAsBlock AND treatAsInline, `input` is in rest AND
//    blockCommands. The meta block says these duplicates are intentional.
//    So rowsFor() returns a LIST, and drops() answers "all", "some" or
//    "none" rather than a bare boolean — because "some" is a real state
//    and a caller that needs one row must say which kind it means.
//
// 2. ast_node IS PROSE, NOT AN ENUM. 185 distinct values, mostly
//    descriptive ("Span (acronym-label/form)", "Str (combined char)").
//    Only the structural verdicts are stable tokens — DROP, UNWRAP, META —
//    and even DROP appears as "DROP (from body)" and "DROP (standalone)".
//    This module tests for those tokens as whole words and reads nothing
//    else out of the string.
//
// THE ASYMMETRY THAT MATTERS MOST IS ABOUT WHAT IS *NOT* IN THE TABLE.
// An unrecognized inline command is DROPPED and its content destroyed; an
// unrecognized environment becomes a Div with its body still parsed. So
// silence from this table means different things for different shapes, and
// unknownFallback() exists so a caller cannot forget that.
//
// Zero dependencies: this module imports nothing at all. createCapability()
// is pure and takes parsed JSON, so it works in the browser, which fetches
// the table itself. Reading the table from disk is Node's job and lives in
// capability-node.mjs (TABLE_PATH, loadCapability), split out at PLAN-9
// step B, session 44. v2/test/capability.mjs B1 to B4 keep it that way.

// The row count at the time of vendoring. Checked, not assumed: if the
// table is regenerated this is the first thing that fails, and updating it
// is a visible edit — the same handling as gate T's 6,144.
export const EXPECTED_ROWS = 539;

// The ten columns every row carries (data/README.md).
export const COLUMNS = ["name", "latex_form", "kind", "source_map",
  "source_file", "args", "ast_node", "html_outcome", "raw_tex", "notes"];

// The three shapes an unrecognized construct can take, which is the axis
// the fallback depends on. Keyed to the meta block's own field names.
export const UNKNOWN_SHAPES = ["inline_command", "block_command", "environment"];

// A control word may arrive with or without its backslash; the table keys
// are bare. Tokens from v2/tokenizer.mjs carry `name` bare already, but a
// caller reading a name out of source text may not, and silently missing
// every lookup would be the worst possible failure mode here.
const key = (name) => {
  let s = String(name ?? "");
  while (s.startsWith("\\")) s = s.slice(1);
  return s;
};

// DROP / UNWRAP / META as whole words, so "DROP (standalone)" counts and a
// row whose prose merely contains the letters does not.
const hasVerdict = (astNode, word) =>
  new RegExp("(^|[^A-Za-z])" + word + "([^A-Za-z]|$)").test(String(astNode ?? ""));

// Rows whose raw_tex says the construct survives ONLY with +raw_tex, and
// is otherwise dropped. Our pipeline does not enable +raw_tex, so for us
// these behave as drops — but they are reported separately, because the
// remedy is different: a flag, not a rewrite.
const RAW_TEX_OR_DROP = new Set(["raw_if_on_else_drop", "rawblock_if_on_else_drop"]);

function tally(rows, pred) {
  const n = rows.filter(pred).length;
  if (!rows.length) return null;
  return n === 0 ? "none" : n === rows.length ? "all" : "some";
}

// json: the parsed table ({ meta, constructs }). Pure — no file system, no
// globals — so the browser bundle can hand it an inlined object.
export function createCapability(json, options = {}) {
  const t = json || {};
  const meta = t.meta || {};
  const rows = Array.isArray(t.constructs) ? t.constructs : null;
  if (!rows) throw new Error("capability: table has no `constructs` array");

  if (options.strict !== false) {
    if (rows.length !== EXPECTED_ROWS)
      throw new Error("capability: expected " + EXPECTED_ROWS + " rows, table has " + rows.length +
                      " — if the table was regenerated, update EXPECTED_ROWS deliberately");
    if (meta.row_count !== undefined && meta.row_count !== rows.length)
      throw new Error("capability: meta.row_count " + meta.row_count + " disagrees with " +
                      rows.length + " rows");
  }

  // name -> rows, built once. Frozen on the way out so a consumer cannot
  // edit the table in place; the tokens rule (helpers never mutate) applies
  // here for the same reason.
  const byName = new Map();
  for (const r of rows) {
    const k = key(r.name);
    const a = byName.get(k);
    if (a) a.push(r); else byName.set(k, [r]);
  }
  for (const [, a] of byName) Object.freeze(a);
  const NONE = Object.freeze([]);

  // Every row for this name, optionally narrowed to one kind. Returns a
  // frozen array, empty when the reader does not know the name at all.
  function rowsFor(name, opts = {}) {
    const a = byName.get(key(name)) || NONE;
    if (!opts.kind) return a;
    return Object.freeze(a.filter((r) => r.kind === opts.kind));
  }

  // Does Pandoc's LaTeX reader know this name?  Silence here is the
  // question unknownFallback() answers.
  const recognized = (name, opts) => rowsFor(name, opts).length > 0;

  // "all" | "some" | "none" — or null when the name is not in the table,
  // which is NOT the same as "none" and must not be collapsed into it.
  // "some" means the rows disagree, which happens for real: `input` is
  // read-and-parsed in one map and read-and-parsed in the other, while
  // `hspace` is DROP in both. A caller that cannot act on "some" should
  // pass { kind } and ask again rather than guess.
  function drops(name, opts = {}) {
    const a = rowsFor(name, opts);
    return tally(a, (r) => hasVerdict(r.ast_node, "DROP"));
  }

  // Rows that survive only under +raw_tex. We do not enable it, so these
  // are losses too — but the honest remedy is a flag, not a rewrite, so
  // they are counted on their own channel.
  function droppedWithoutRawTex(name, opts = {}) {
    const a = rowsFor(name, opts);
    return tally(a, (r) => RAW_TEX_OR_DROP.has(String(r.raw_tex)));
  }

  // Pandoc unwraps the construct and keeps the argument's content.
  function unwraps(name, opts = {}) {
    const a = rowsFor(name, opts);
    return tally(a, (r) => hasVerdict(r.ast_node, "UNWRAP"));
  }

  // What happens to something the table does NOT contain. The whole reason
  // this exists: an unknown inline command is dropped and its content
  // destroyed, an unknown environment keeps its body inside a Div. Reads
  // the meta block rather than restating it, so the data stays the source.
  function unknownFallback(shape) {
    const f = meta.fallbacks_for_UNrecognized || {};
    const s = String(shape ?? "");
    if (!UNKNOWN_SHAPES.includes(s))
      throw new Error("capability: unknownFallback wants one of " + UNKNOWN_SHAPES.join(", ") +
                      ", got " + JSON.stringify(shape));
    return f["unknown_" + s] ?? null;
  }

  // The documented meaning of a raw_tex value, for reports.
  const rawTexMeaning = (value) => (meta.raw_tex_values || {})[String(value)] ?? null;

  return {
    meta, size: rows.length, names: () => byName.size,
    rowsFor, recognized, drops, droppedWithoutRawTex, unwraps,
    unknownFallback, rawTexMeaning,
    // Every row, frozen. For sweeps and for VERIFY in stage 7.
    all: () => Object.freeze(rows.slice()),
  };
}
