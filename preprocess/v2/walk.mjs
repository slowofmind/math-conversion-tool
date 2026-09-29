// v2/walk.mjs — the DECIDE pass (DESIGN-V2 §3, §4.5, §7 Stage 5).
//
// Plain terms: the reader has already been over the document and knows
// everything about it. This is the second trip over the SAME tokens, with
// that finished knowledge in hand, asking each registered transform what it
// wants at each construct. Transforms describe actions (v2/decide.mjs); this
// module turns them into text edits (lib/edits.mjs) and applies them.
//
// ONE WALKER, USED TWICE. This drives walkDefinitions from v2/store.mjs — the
// same engine the reader drives — with its own hooks map and its own SCRATCH
// store for group tracking. Nothing here changes store.mjs, reader.mjs or
// definition.mjs, so gate R stays where it is. The scratch store must not be
// the reader's store: the second pass would otherwise rewrite the very
// knowledge it is supposed to be consulting.
//
// TWO ROUNDS. Round one walks every file; a transform may act at once, or
// record a decision for later. Round two walks the same files with the
// decision bag complete, for the cross-file cases (a star split declared in
// handout.sty rewriting a call site in a subfile). Round two is skipped
// entirely when no transform asked for it. This is v1's two-round pattern.
//
// THE DECIDE PASS COVERS THE WHOLE FILE, not only the body — a deliberate
// widening of DESIGN-conditional-evaluator §D, recorded at checkpoint 0,
// because at-letter, require-package, package-options and delimited-def all
// act on preamble and .sty constructs. That is where the damage is.
//
// Findings from the engine itself are silenced here (quietLeftOpen): the
// reader already reported an unclosed group on pass one, and reporting it
// again from pass two would double every such finding.
import { createStore, walkDefinitions } from "./store.mjs";
import { createEditList } from "../lib/edits.mjs";
import { toEdit, toFindings, ACTIONS } from "./decide.mjs";

export const ROUNDS = Object.freeze([1, 2]);

// ---- a transform ------------------------------------------------------
// { name, commands?, onFile?, rounds? }
//   name      required, unique; it becomes the `by` of every action
//   commands  { controlWordName: handler } — bare names, no backslash
//   onFile    handler called once per file, before its tokens are walked;
//             this is where a PREPEND lives, since nothing in the token
//             stream triggers it
//   rounds    which rounds to take part in; default [1]
// A handler returns either nothing, or the index to continue at. Returning
// an index means "I have consumed this span".
function checkTransform(t, seen) {
  if (!t || typeof t !== "object") throw new Error("walk: a transform must be an object");
  if (typeof t.name !== "string" || !t.name) throw new Error("walk: a transform needs a name");
  if (seen.has(t.name)) throw new Error("walk: two transforms are both named " + JSON.stringify(t.name));
  seen.add(t.name);
  const rounds = t.rounds || [1];
  if (!Array.isArray(rounds) || !rounds.length || rounds.some((r) => !ROUNDS.includes(r)))
    throw new Error("walk: " + t.name + " must declare rounds from " + JSON.stringify(ROUNDS));
  if (t.commands !== undefined && (typeof t.commands !== "object" || t.commands === null))
    throw new Error("walk: " + t.name + "'s `commands` must be an object of name -> handler");
  for (const [k, fn] of Object.entries(t.commands || {})) {
    if (typeof fn !== "function")
      throw new Error("walk: " + t.name + "'s handler for " + JSON.stringify(k) + " is not a function");
    if (k.startsWith("\\"))
      throw new Error("walk: " + t.name + " hooks " + JSON.stringify(k) + " — hook the bare " +
                      "control word name, without the backslash, as the tokens carry it");
  }
  if (t.onFile !== undefined && typeof t.onFile !== "function")
    throw new Error("walk: " + t.name + "'s `onFile` is not a function");
  if (!t.commands && !t.onFile)
    throw new Error("walk: " + t.name + " hooks nothing — give it `commands` or `onFile`");
  return { ...t, rounds };
}

// ---- the driver -------------------------------------------------------
// runWalk({ files, state, decide, transforms })
//   files       [{ path, tokens, text? }] — the document's chain, in order
//   state       the reader's FINISHED store, read-only to transforms
//   decide      from createDecide()
//   transforms  the registry for this run
export function runWalk({ files, state = null, decide, transforms = [] } = {}) {
  if (!Array.isArray(files)) throw new Error("walk: `files` must be an array of { path, tokens }");
  if (!decide || typeof decide.toEdit !== "function")
    throw new Error("walk: runWalk needs the object from createDecide()");
  for (const f of files) {
    if (!f || typeof f.path !== "string" || !f.path) throw new Error("walk: every file needs a path");
    if (!Array.isArray(f.tokens)) throw new Error("walk: " + f.path + " has no token array");
  }

  const seen = new Set();
  const list = transforms.map((t) => checkTransform(t, seen));
  const wantsRound2 = list.some((t) => t.rounds.includes(2));
  const rounds = wantsRound2 ? [1, 2] : [1];

  const decisions = new Map();          // the cross-file bag: round 1 writes, round 2 reads
  const records = [];                   // { action, file, round, by }
  const byFile = new Map();
  for (const f of files) byFile.set(f.path, { actions: [], findings: [], prepends: [], edits: null });

  let seq = 0;
  const receive = (t, file, round, action) => {
    if (!action) return;
    if (!ACTIONS.includes(action.action))
      throw new Error("walk: " + t.name + " emitted something that is not an action: " +
                      JSON.stringify(action));
    if (action.by !== t.name)
      throw new Error("walk: " + t.name + " emitted an action stamped " +
                      JSON.stringify(action.by) + " — a transform may only act under its own name");
    const rec = { action, file, round, by: t.name, seq: seq++ };
    records.push(rec);
    const slot = byFile.get(file);
    slot.actions.push(action);
    for (const f of toFindings(action)) slot.findings.push({ ...f, file: f.file ?? file });
    if (action.action === "PREPEND") slot.prepends.push(rec);
  };
  const emitter = (t, file, round) => (action) => {
    if (Array.isArray(action)) { for (const a of action) receive(t, file, round, a); return; }
    receive(t, file, round, action);
  };

  // P1 (PLAN-8 §4, session 31). The engine's findings are collected ONCE PER
  // FILE PER RUN, not once per file per ROUND. walkDefinitions is driven again
  // in round two over the same tokens with a fresh scratch store, so it
  // re-derives the IDENTICAL findings; pushing them unconditionally reported
  // every engine complaint twice whenever any transform asked for round two —
  // nine became eighteen on the Math Ma worksheet. Round one's are kept and
  // the repeat is dropped. Pinned by v2/test/finding-count.mjs, the first
  // suite in the project to assert a finding COUNT, which is exactly why this
  // survived from the day round two was built.
  const engineFindingsByFile = new Map();   // file path -> findings; the first round to run wins

  for (const round of rounds) {
    const active = list.filter((t) => t.rounds.includes(round));
    if (!active.length) continue;

    for (const f of files) {
      // A FRESH scratch store per file per round: walk's own group tracking,
      // never the reader's finished state.
      const scratch = createStore();
      const base = { tokens: f.tokens, file: f.path, state, scratch, decide,
                     capability: decide.capability, decisions, round };

      for (const t of active) {
        if (t.onFile) t.onFile({ ...base, emit: emitter(t, f.path, round) });
      }

      const commands = new Map();
      for (const t of active) {
        for (const [name, fn] of Object.entries(t.commands || {})) {
          const prior = commands.get(name);
          const emit = emitter(t, f.path, round);
          // Several transforms may hook the same name. They run in registry
          // order; the FIRST one to return an index consumes the span, and
          // the rest still get to look.
          const step = (ctx) => {
            const next = fn({ ...base, ...ctx, token: ctx.tokens[ctx.i], emit });
            if (next === undefined || next === null) return undefined;
            if (!Number.isInteger(next))
              throw new Error("walk: " + t.name + "'s handler for \\" + name +
                              " returned " + JSON.stringify(next) +
                              " — return nothing, or the integer index to continue at");
            // walkDefinitions does `i = next` and continues. An index that is
            // not past the current one loops for ever with no error, so it is
            // refused here rather than hanging the run.
            if (next <= ctx.i)
              throw new Error("walk: " + t.name + "'s handler for \\" + name + " returned index " +
                              next + " at index " + ctx.i + " — an index must move forward, " +
                              "or the walk never terminates");
            return next;
          };
          commands.set(name, prior ? ((ctx) => { const a = prior(ctx); const b = step(ctx); return a ?? b; }) : step);
        }
      }

      const r = walkDefinitions(f.tokens, f.path, scratch, { commands, quietLeftOpen: true });
      // First round only: round two would re-derive the same list (P1).
      if (!engineFindingsByFile.has(f.path)) engineFindingsByFile.set(f.path, r.findings);
    }
  }

  // ---- actions become edits -------------------------------------------
  // DECISION 3 (Nicholas, 2026-09-15). lib/edits.mjs allows two zero-width
  // edits at offset 0 — `end === next.start` is the touching case, and 0 < 0
  // is false — and resolves their order by the stability of its sort. That
  // behaviour is pinned in v2/test/walk.mjs (S5-5), but NOT relied on here:
  // every prepend for a file is combined into ONE edit at offset 0, ordered
  // by its declared rank. at-letter holds rank 0, so "\makeatletter " stays
  // the first thing in the file and its output remains byte-identical to v1.
  for (const f of files) {
    const slot = byFile.get(f.path);
    const edits = createEditList();

    for (const a of slot.actions) {
      if (a.action === "PREPEND") continue;
      const e = decide.toEdit(a);
      if (e) edits.add(e);
    }

    if (slot.prepends.length) {
      const ordered = [...slot.prepends].sort(
        (x, y) => x.action.rank - y.action.rank || x.seq - y.seq);
      const names = ordered.map((r) => r.by);
      edits.add({
        start: 0, end: 0,
        replacement: ordered.map((r) => r.action.text).join(""),
        by: names.length === 1 ? names[0] : "walk:prepend[" + names.join(",") + "]",
        note: ordered.map((r) => r.action.note || r.action.rule).join(" | "),
      });
      slot.prependOrder = names;
    }

    slot.edits = edits;
    slot.apply = (text) => edits.apply(text);
  }

  const findings = [];
  for (const f of files) for (const x of byFile.get(f.path).findings) findings.push(x);
  for (const perFile of engineFindingsByFile.values()) for (const x of perFile) findings.push(x);

  return {
    rounds: rounds.length, ranRound2: rounds.includes(2),
    transforms: list.map((t) => t.name),
    byFile, decisions, findings, records,
    actions: records.map((r) => r.action),
    apply(pathName, text) {
      const slot = byFile.get(pathName);
      if (!slot) throw new Error("walk: nothing was walked for " + pathName);
      return slot.apply(text);
    },
  };
}
