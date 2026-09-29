// v2/decide.mjs — the action menu (DESIGN-V2 §4.5).
//
// Plain terms: for each construct the walk meets, exactly one of six moves,
// preferring the ones that leave the author's text alone. This module is the
// VOCABULARY, not the walk. It does three things: it builds one well-formed
// action per move and refuses a malformed one at the moment it is made; it
// holds the two policies as named, swappable components (rule 53); and it
// turns a validated action into the edit and the findings it implies.
//
// An action is a DESCRIPTION. Nothing here touches text, and nothing here
// walks tokens — v2/walk.mjs does both.
//
// Three decisions from Nicholas, 2026-09-15, checkpoint 1b:
//  1. A tri-state query answering "some" (the rows for one name disagree) is
//     read CAUTIOUSLY and always reports. See CAUTIOUS below for why the
//     cautious direction is per-query and not one fixed answer.
//  2. The unknown-construct policy stays single — collect-and-report, rule 7 —
//     but carries a SEVERITY read out of the table's own meta block, because
//     an unknown inline command is dropped and its content destroyed while an
//     unknown environment keeps its body inside a Div. Not equally serious.
//  3. Prepend order is declared (PREPEND_RANKS), not inherited from the order
//     edits happen to be added in. lib/edits.mjs allows two zero-width edits
//     at offset 0 and resolves them by sort stability; v2/test/walk.mjs pins
//     that behaviour (S5-5), and walk does not rely on it.
//
// MEASURED BEFORE THIS FILE WAS WRITTEN (_work/_s5c1b_probe_some.mjs), over
// all 524 distinct names of the vendored table:
//   drops()                "some" for ZERO names  (46 all, 478 none)
//   unwraps()              "some" for ONE name: iftoggle  (9 all, 514 none)
//   droppedWithoutRawTex() "some" for ZERO names  (30 all, 494 none)
// So the handoff's example was right about iftoggle and wrong about the
// channel: its two rows agree that it does not drop, and disagree on whether
// Pandoc unwraps it (UNWRAP in the inline map, silent in the block map).
// The policy is written for any tri-state query, not for drops() alone.

export const ACTIONS = Object.freeze(
  ["LEAVE", "PREPEND", "REWRITE", "EXPAND", "REMOVE", "FLAG"]);

// §5.4: `level` applies to the attention channel only.
export const LEVELS = Object.freeze(["author-error", "unsupported", "undecidable"]);
export const CHANNELS = Object.freeze(["changed", "removed", "attention"]);
export const EDIT_KINDS = Object.freeze(["literal", "expanded"]);

// Declared order for everything that prepends at offset 0. Lower goes first
// in the output. at-letter must stay byte-identical to v1, where the literal
// "\makeatletter " is the very first thing in the file, so it takes rank 0 and
// nothing may be given a negative rank. A name absent here is refused rather
// than defaulted, so adding a prepend is a visible edit to this table.
export const PREPEND_RANKS = Object.freeze({
  "at-letter": 0,
  "newtheorem": 10,        // stage 6, \newtheorem declarations
  "stub": 20,              // stage 6, harmless stubs for absent packages
  "test-probe": 900,       // v2/test only; never in a shipping registry
  "test-probe-2": 910,
});

// The cautious reading of a tri-state answer, per query. This is not one
// fixed direction: it is always "assume the reading that leaves us LESS
// confident Pandoc handles this safely".
//   drops                "all"  — assume it does drop; content is at risk
//   droppedWithoutRawTex "all"  — assume the loss, since we do not set +raw_tex
//   unwraps              "none" — do NOT count on Pandoc keeping the content
export const CAUTIOUS = Object.freeze({
  drops: "all",
  droppedWithoutRawTex: "all",
  unwraps: "none",
});

// Unknown-branch policy (a conditional evaluating to `unknown`). Stage 5 has
// no evaluator, so these ship as components and data only — the default is
// recorded and fixtured, and nothing calls them. DESIGN-V2 §10.2 is open.
export const UNKNOWN_BRANCH_POLICIES = Object.freeze({
  "keep-else": Object.freeze({
    name: "keep-else", keep: "else", reports: true,
    why: "v1's behaviour: keep the else branch, report with the test and both branches quoted.",
  }),
  "preserve-both": Object.freeze({
    name: "preserve-both", keep: "both", reports: true,
    why: "The 2026-09-10 design's default: wrap each branch so Pandoc emits classed Divs.",
  }),
});

export const DEFAULT_POLICIES = Object.freeze({
  unknownBranch: "keep-else",
  unknownConstruct: "collect-and-report",
});

// ---- validation ---------------------------------------------------------
// A transform that describes an action wrongly should fail HERE, naming
// itself, not three steps later when the edit list applies.

const isStr = (v) => typeof v === "string" && v.length > 0;

function need(by, what, ok) {
  if (!ok) throw new Error("decide: action from " + (isStr(by) ? by : "(no `by`)") + ": " + what);
}

function checkBy(by) {
  if (!isStr(by)) throw new Error("decide: every action needs `by`, the transform's name");
  return by;
}

function checkSpan(by, span) {
  need(by, "`span` must be {start,end}", span && typeof span === "object");
  need(by, "span.start must be an integer", Number.isInteger(span.start));
  need(by, "span.end must be an integer", Number.isInteger(span.end));
  need(by, "span.end (" + span.end + ") is before span.start (" + span.start + ")", span.end >= span.start);
  need(by, "span.start must not be negative", span.start >= 0);
  return Object.freeze({ start: span.start, end: span.end });
}

function checkKind(by, kind, fallback) {
  const k = kind === undefined ? fallback : kind;
  need(by, "`kind` must be one of " + EDIT_KINDS.join(", ") + ", got " + JSON.stringify(k),
       EDIT_KINDS.includes(k));
  return k;
}

const frozen = (a) => Object.freeze(a);

// ---- the six moves ------------------------------------------------------
// Every action carries `by` (which transform) and, except LEAVE, `rule` (the
// rule name a report will group it under) and `note` (plain language, for a
// non-expert). `file` is optional and filled in by the walk when absent.

// Pandoc handles it properly. Do nothing. Most tokens.
export function leave({ by, rule, note, file } = {}) {
  checkBy(by);
  return frozen({ action: "LEAVE", by, rule: rule || null, note: note || "", file: file ?? null });
}

// Pandoc needs to have been told something. Add a declaration before the
// document body; the author's text is untouched.
export function prepend({ by, text, rank, rule, note, file } = {}) {
  checkBy(by);
  need(by, "PREPEND needs `text`, the declaration to add", isStr(text));
  need(by, "PREPEND needs `rule`", isStr(rule));
  const r = rank === undefined ? PREPEND_RANKS[by] : rank;
  need(by, "PREPEND needs a declared rank — add " + JSON.stringify(by) +
           " to decide.PREPEND_RANKS, or pass `rank` explicitly", Number.isInteger(r));
  need(by, "a prepend rank must not be negative (at-letter holds rank 0)", r >= 0);
  return frozen({ action: "PREPEND", by, text, rank: r, rule, note: note || "", file: file ?? null });
}

// Translate into an equivalent Pandoc handles.
export function rewrite({ by, span, replacement, rule, note, kind, file } = {}) {
  checkBy(by);
  const s = checkSpan(by, span);
  need(by, "REWRITE needs a string `replacement`", typeof replacement === "string");
  need(by, "REWRITE needs `rule`", isStr(rule));
  need(by, "an empty replacement is a deletion — use remove() so it is reported on the " +
           "removed channel, not silently on the changed one", replacement !== "");
  return frozen({ action: "REWRITE", by, span: s, replacement, rule,
                  note: note || "", kind: checkKind(by, kind, "literal"), file: file ?? null });
}

// Work the result out ourselves (§4.6) and splice it. Same shape as REWRITE;
// `kind` defaults to "expanded" so a report can separate what we computed
// from what we translated.
export function expand({ by, span, replacement, rule, note, kind, file } = {}) {
  const a = rewrite({ by, span, replacement, rule, note,
                      kind: checkKind(by, kind, "expanded"), file });
  return frozen({ ...a, action: "EXPAND" });
}

// Delete, and report the deletion on its own channel (§4.5). The message is
// required: a deletion nobody can read about is the one thing this engine
// must never do.
export function remove({ by, span, rule, message, note, file, detail } = {}) {
  checkBy(by);
  const s = checkSpan(by, span);
  need(by, "REMOVE needs `rule`", isStr(rule));
  need(by, "REMOVE needs `message` — a deletion is always reported", isStr(message));
  need(by, "REMOVE of a zero-width span deletes nothing", s.end > s.start);
  return frozen({ action: "REMOVE", by, span: s, replacement: "", rule, message,
                  note: note || message, file: file ?? null, detail: frozen(detail || {}) });
}

// Nothing safe to do. Report with a reason and a category.
export function flag({ by, rule, level, message, span, file, detail } = {}) {
  checkBy(by);
  need(by, "FLAG needs `rule`", isStr(rule));
  need(by, "FLAG needs `message`, in plain language", isStr(message));
  need(by, "FLAG needs `level` — one of " + LEVELS.join(", ") + ", got " + JSON.stringify(level),
       LEVELS.includes(level));
  return frozen({ action: "FLAG", by, rule, level, message,
                  span: span ? checkSpan(by, span) : null,
                  file: file ?? null, detail: frozen(detail || {}) });
}

// ---- action -> edit, action -> findings ---------------------------------
// lib/edits.mjs is KEPT AS IS (DESIGN-V2 §9) and keeps only start, end,
// replacement, by and note. `rule` and `kind` therefore stay on the ACTION,
// which is the fuller record REPORT reads at stage 8 (judgement call S5-6:
// the alternative was widening a kept file, and it is not worth it).
export function toEdit(action) {
  if (!action || !ACTIONS.includes(action.action))
    throw new Error("decide: toEdit wants an action, got " + JSON.stringify(action));
  switch (action.action) {
    case "LEAVE": case "FLAG": return null;
    case "PREPEND":
      return { start: 0, end: 0, replacement: action.text, by: action.by, note: action.note };
    default:
      return { start: action.span.start, end: action.span.end,
               replacement: action.replacement, by: action.by, note: action.note };
  }
}

const finding = (rule, channel, level, span, file, message, detail, kind) =>
  ({ rule, channel, level: level ?? null, kind: kind || "literal",
     file: file ?? null, span: span || null, message, detail: detail || {} });

export function toFindings(action) {
  if (!action || !ACTIONS.includes(action.action))
    throw new Error("decide: toFindings wants an action, got " + JSON.stringify(action));
  const a = action;
  switch (a.action) {
    case "LEAVE": return [];
    case "FLAG":
      return [finding(a.rule, "attention", a.level, a.span, a.file, a.message, a.detail)];
    case "REMOVE":
      return [finding(a.rule, "removed", null, a.span, a.file, a.message, a.detail)];
    case "PREPEND":
      return [finding(a.rule, "changed", null, { start: 0, end: 0 }, a.file,
                      a.note || a.rule, { text: a.text, rank: a.rank })];
    default:
      return [finding(a.rule, "changed", null, a.span, a.file, a.note || a.rule,
                      { replacement: a.replacement }, a.kind)];
  }
}

// ---- decision 1: reading a tri-state answer ----------------------------
// ABSENCE IS NOT "none", AND MUST BE CHECKED FIRST. capability.drops() and
// its siblings return null for a name the table does not contain, and that is
// the DANGEROUS answer, not the safe one: an unrecognized inline command is
// dropped and its content destroyed. Code shaped `if (!verdict.value)` has
// the logic inverted, because "none" and null both read as falsy. So this
// returns `known` and `absent` as their own fields, and the suite pins it.
export function cautiousVerdict(capability, query, name, opts = {}) {
  if (!Object.prototype.hasOwnProperty.call(CAUTIOUS, query))
    throw new Error("decide: no cautious reading declared for query " + JSON.stringify(query) +
                    " — declare one in decide.CAUTIOUS, deliberately");
  if (typeof capability?.[query] !== "function")
    throw new Error("decide: the capability object has no " + query + "()");

  const answer = capability[query](name, opts);
  if (answer === null)
    return frozen({ answer: null, value: null, known: false, absent: true,
                    disagreed: false, findings: frozen([]) });
  if (answer !== "some")
    return frozen({ answer, value: answer, known: true, absent: false,
                    disagreed: false, findings: frozen([]) });

  // The rows for this name disagree. Read it cautiously AND always report:
  // acting silently on the worse row would hide a real ambiguity in the data,
  // and doing nothing at all would leave a known risk unhandled.
  const value = CAUTIOUS[query];
  const rows = capability.rowsFor(name, opts);
  const f = finding("capability/rows-disagree", "attention", "undecidable", null, null,
    "Pandoc's reader holds " + rows.length + " entries for \\" + String(name).replace(/^\\/, "") +
    " and they disagree about " + query + "; read as " + JSON.stringify(value) +
    ", the more cautious of the two. Narrowing by `kind` resolves it when the kind is known.",
    { name, query, readAs: value, kinds: rows.map((r) => r.kind),
      ast_nodes: rows.map((r) => r.ast_node) });
  return frozen({ answer: "some", value, known: true, absent: false,
                  disagreed: true, findings: frozen([f]) });
}

// ---- decision 2: the unknown-construct policy --------------------------
// collect-and-report (rule 7) — one policy, never rendering source into the
// output, but carrying a severity, because the consequence of being unknown
// is not uniform. The severity and the rule are derived from the SHAPE and
// from whether the construct had content; the sentence describing what Pandoc
// will do is read out of the table's meta block rather than restated here, so
// the data stays the source.
export function collectAndReport(capability) {
  if (typeof capability?.unknownFallback !== "function")
    throw new Error("decide: collect-and-report needs a capability object");

  // inline/block command WITH content  -> the content is destroyed: serious
  // inline/block command with nothing  -> only the command is lost
  // environment                        -> body survives inside a Div
  function classify(shape, hasContent) {
    if (shape === "environment")
      return { severity: "wrapper-only", rule: "unknown/environment-wrapped" };
    return hasContent
      ? { severity: "content-loss", rule: "unknown/command-content-lost" }
      : { severity: "wrapper-only", rule: "unknown/command-dropped" };
  }

  function decideUnknown({ by, name, shape, hasContent = false, span, file, detail } = {}) {
    const pandoc = capability.unknownFallback(shape);   // throws on a shape it cannot model
    const c = classify(shape, !!hasContent);
    const bare = String(name ?? "").replace(/^\\/, "");
    const message = c.severity === "content-loss"
      ? "Pandoc's LaTeX reader does not know \\" + bare + ", so it drops the command AND the " +
        "text inside it. Nothing here is safe to substitute, so it is reported instead."
      : shape === "environment"
        ? "Pandoc's LaTeX reader does not know the " + bare + " environment; the body survives " +
          "inside a plain container but the environment's own meaning is lost."
        : "Pandoc's LaTeX reader does not know \\" + bare + "; it is dropped. It carried no " +
          "content, so nothing the author wrote is lost with it.";
    return flag({ by, rule: c.rule, level: "unsupported", message, span, file,
                  detail: { name: bare, shape, hasContent: !!hasContent,
                            severity: c.severity, pandoc, ...(detail || {}) } });
  }

  return frozen({ name: "collect-and-report", rendersSource: false,
                  severities: frozen(["content-loss", "wrapper-only"]),
                  classify, decide: decideUnknown });
}

// ---- the menu, assembled -----------------------------------------------
// createDecide is what a transform is handed. It is pure: no walking, no
// text, no I/O. Swapping a policy is a constructor argument, so a test can
// name which policy was in force (rule 53).
export function createDecide({ capability, policies } = {}) {
  if (!capability) throw new Error("decide: createDecide needs a capability object");
  const chosen = { ...DEFAULT_POLICIES, ...(policies || {}) };

  if (!UNKNOWN_BRANCH_POLICIES[chosen.unknownBranch])
    throw new Error("decide: unknown-branch policy must be one of " +
                    Object.keys(UNKNOWN_BRANCH_POLICIES).join(", ") +
                    ", got " + JSON.stringify(chosen.unknownBranch));
  if (chosen.unknownConstruct !== "collect-and-report")
    throw new Error("decide: the only unknown-construct policy is collect-and-report (rule 7); " +
                    "got " + JSON.stringify(chosen.unknownConstruct));

  const unknownConstruct = collectAndReport(capability);
  const unknownBranch = UNKNOWN_BRANCH_POLICIES[chosen.unknownBranch];

  return frozen({
    capability,
    policies: frozen({ unknownBranch, unknownConstruct }),
    policyNames: frozen({ unknownBranch: unknownBranch.name, unknownConstruct: unknownConstruct.name }),
    // the six moves
    leave, prepend, rewrite, expand, remove, flag,
    // decision 1 and decision 2
    cautious: (query, name, opts) => cautiousVerdict(capability, query, name, opts),
    unknown: (args) => unknownConstruct.decide(args),
    // conversion
    toEdit, toFindings,
  });
}
