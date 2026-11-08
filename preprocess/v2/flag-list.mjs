// v2/flag-list.mjs — session 257. WHICH commands are flagged: the first of
// the flagging build's three parts (DECISIONS 2026-10-24, option B and "the
// command list as data"; sessions/FLAGGING-PLAN-s257.md).
//
// Plain terms: some author commands draw something Pandoc cannot carry - an
// underlined blank, a TikZ icon, a dingbat. Rather than name each one, this
// follows every author definition in the reader's store down through the
// commands it uses until it meets one of a short list of "lossy building
// blocks". A new author command that draws is caught without being named.
// Two lists sit beside the automatic part, so a later interface can feed
// them: names to flag as well (\ding, which the course writes directly), and
// names never to flag (tikz-cd's tikzcd; reach does not pass through them).
//
// Measured in session 256 (_work/_s256_reach2.mjs, FLAGGING-MEASURE-s256.md
// section 1): this is that script's reach, with one change: an image is not a
// block. Pandoc keeps \includegraphics as an Image (_s256-looks.txt), so a tag
// would replace a working image with source text. Look-only styling (colour,
// boxes around words) is a later build (DECISIONS, "which commands").
//
// It reads nothing and changes nothing: the store is handed in.
import { readGroup } from "./structure.mjs";
import { groupText } from "./definition.mjs";
import { tokenize } from "./tokenizer.mjs";

const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };

export const DEFAULT_FLAG_LIST = freeze({
  // the lossy building blocks: name -> what is lost
  blocks: {
    commands: { tikz: "tikz", draw: "tikz", filldraw: "tikz", fill: "tikz", node: "tikz", path: "tikz", shade: "tikz",
                rule: "rule", hrulefill: "rule", dotfill: "rule",
                ding: "dingbat", dingline: "dingbat", dingfill: "dingbat", Pisymbol: "dingbat", Pifill: "dingbat", Piline: "dingbat",
                put: "picture", multiput: "picture" },
    environments: { tikzpicture: "tikz", pgfpicture: "tikz", picture: "picture", axis: "tikz", circuitikz: "tikz" },
    // every \pgf... command is TikZ's machinery, except these families
    prefix: { pgf: "tikz" },
    prefixExcept: ["pgfmath", "pgfplotsset", "pgfplotstable"],
    // \underline of nothing but a blank: Pandoc shows nothing, or fails on \parbox
    underline: ["underline", "uline"],
    blanks: ["parbox", "hspace", "phantom", "hphantom", "makebox", "hfill", "quad", "qquad"],
  },
  // flagged as well, with their argument shapes (no definition to read them from)
  alsoFlag: { ding: { optional: 0, mandatory: 1 } },
  // never flagged, and reach does not pass through them
  neverFlag: ["tikzcd"],
  // session 258 (option B): the box family, with argument shapes. Pandoc loses
  // the words inside them (s256); inside an author definition not tagged at
  // the call each call is a piece tagged where it sits. A box written directly
  // in text is left for a later build.
  boxes: { fbox: { optional: 0, mandatory: 1 }, framebox: { optional: 2, mandatory: 1 }, makebox: { optional: 2, mandatory: 1 },
           fcolorbox: { optional: 1, mandatory: 3 }, ovalbox: { optional: 0, mandatory: 1 }, Ovalbox: { optional: 0, mandatory: 1 } },
});

// The default list with a caller's additions: also-flag names added (or
// reshaped), never-flag names added. The blocks and boxes are the default's.
export function mergeFlagList(extra) {
  const d = DEFAULT_FLAG_LIST;
  if (!extra) return d;
  return { blocks: d.blocks, boxes: d.boxes, alsoFlag: Object.assign({}, d.alsoFlag, extra.alsoFlag || {}),
           neverFlag: [...d.neverFlag, ...(extra.neverFlag || [])] };
}

// Argument slots from a shape { optional, mandatory } (the also-flag list, the boxes).
export function slotsOf(shape) {
  const slots = [];
  for (let k = 0; k < (shape.optional || 0); k++) slots.push({ type: "optional", open: "[", close: "]" });
  for (let k = 0; k < (shape.mandatory || 0); k++) slots.push({ type: "mandatory" });
  return slots;
}

const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? groupText(ts, g).trim() : null; };

// What one token of a body draws directly: an example such as "\rule", or null.
function blockAt(ts, i, blocks) {
  const t = ts[i];
  if (!t || t.kind !== "ControlWord") return null;
  const n = t.name;
  if (n === "begin") { const e = envName(ts, i); return e !== null && Object.hasOwn(blocks.environments, e) ? "\\begin{" + e + "}" : null; }
  if (Object.hasOwn(blocks.commands, n)) return "\\" + n;
  for (const p of Object.keys(blocks.prefix))
    if (n.startsWith(p) && !blocks.prefixExcept.some((x) => n.startsWith(x))) return "\\" + n;
  if (blocks.underline.includes(n)) {
    let k = i + 1; while (ts[k] && ts[k].kind === "Space") k++;
    const g = readGroup(ts, k);
    if (g) {
      const inner = ts.slice(g.open + 1, g.close).filter((x) => x.kind !== "Space" && x.kind !== "Comment");
      const first = inner[0];
      if (!inner.length || (first.kind === "ControlWord" && blocks.blanks.includes(first.name)))
        return "\\" + n + "{" + (first ? "\\" + first.name : "") + "..}";
    }
  }
  return null;
}

// Does a body make an \item of the list it is used in: an \item at its top
// level, not inside an environment the body opens itself (Math Ma's
// \psreflection holds a whole enumerate with its own \item: session 257).
function makesItem(ts) {
  let depth = 0;
  for (const t of ts) {
    if (t.kind !== "ControlWord") continue;
    if (t.name === "begin") depth++;
    else if (t.name === "end") depth--;
    else if (t.name === "item" && depth <= 0) return true;
  }
  return false;
}

const bodyTokens = (rec) => {
  if (!rec || !rec.body) return [];
  if (Array.isArray(rec.body)) return rec.body;
  return [...(rec.body.beginBody || []), ...(rec.body.endBody || [])];
};

// flaggedCommands({ store, isAuthorFile, list })
//   store         the reader's finished store
//   isAuthorFile  file -> true when the file is one of this project's own
//   list          from mergeFlagList (default: DEFAULT_FLAG_LIST)
// Returns Map name -> { name, kind: "command"|"environment", slots, item,
//   reach }: slots are the definition's argument slots (v2/definition.mjs),
//   item says its body makes an \item, reach is the path down to the block
//   ("\fitb > \underline{\parbox..}").
export function flaggedCommands({ store, isAuthorFile, list = DEFAULT_FLAG_LIST } = {}) {
  const never = new Set(list.neverFlag);
  const memo = new Map();
  // the path from a name ("cmd:x" / "env:x") down to a block, or null
  const reach = (key, seen) => {
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return null;
    seen.add(key);
    const name = key.slice(4);
    let out = null;
    const rec = never.has(name) ? null : store.resolve(name).record;
    if (rec && (rec.kind === "environment") === key.startsWith("env:")) {
      const ts = bodyTokens(rec);
      for (let i = 0; i < ts.length && out === null; i++) out = blockAt(ts, i, list.blocks);
      for (let i = 0; i < ts.length && out === null; i++) {
        const t = ts[i];
        if (t.kind !== "ControlWord" || t.name === "end") continue;
        const sub = t.name === "begin" ? (envName(ts, i) === null ? null : "env:" + envName(ts, i)) : "cmd:" + t.name;
        if (!sub || sub === key || never.has(sub.slice(4))) continue;
        const p = reach(sub, seen);
        if (p !== null) out = (sub.startsWith("env:") ? "{" + sub.slice(4) + "}" : "\\" + sub.slice(4)) + " > " + p;
      }
    }
    memo.set(key, out);
    return out;
  };

  const out = new Map();
  for (const name of store.names()) {
    if (never.has(name)) continue;
    const own = store.lookup(name);
    if (!own || !own.origin || !isAuthorFile(own.origin.file)) continue;
    // a second name made with \let (\let\mfitb\fitb) takes its target's definition
    const rec = own.kind === "alias" ? store.resolve(name).record : own;
    if (!rec || (rec.kind !== "macro" && rec.kind !== "environment")) continue;
    const env = rec.kind === "environment";
    const path = reach((env ? "env:" : "cmd:") + name, new Set());
    if (path === null) continue;
    out.set(name, Object.freeze({ name, kind: env ? "environment" : "command", slots: rec.params || [],
      item: !env && makesItem(bodyTokens(rec)), reach: path }));
  }
  for (const [name, shape] of Object.entries(list.alsoFlag)) {
    if (never.has(name) || out.has(name)) continue;
    out.set(name, Object.freeze({ name, kind: "command", slots: slotsOf(shape), item: !!shape.item, reach: "on the also-flag list" }));
  }
  return out;
}

// ---- session 258: where each definition's tag goes (FLAGGING-PLAN2-s257.md) --
// The default rule, by structure only (plan section 1, measured as M1,
// _work/_s257-m1rule.txt):
//   call    the command's OWN definition holds a lossy building block (\fitb,
//           \axes, \check, \calculator): tagged where it is called, as in s257
//   inside  it reaches a block only THROUGH another flagged command
//           (\instructions -> \fitb, \calcitem -> \calculator), or (option B)
//           it is not flagged but its definition holds a box (\note's \fbox,
//           \maybecircle's \ovalbox): never wrapped whole; the pieces in its
//           definition are tagged there (v2/flag-calls.mjs findDefinitionSites)
//   leave   chosen only: tagged nowhere, and reach does not pass through it
//           (the "don't wrap that, it's fine" switch); its calls stay listed
// Choices arrive as data, { "\\name": "call" | "inside" | "leave" } beside
// per-site IDs (those are read by flag-calls); where they are kept between
// runs is the interface's decision, later.
export const CHOICES = Object.freeze(["call", "inside", "leave"]);

// ---- session 301: handout.sty's fill-in-the-blank (BLANKS-FILTER-PLAN-s300 step 1) --
// \fitb[words]{width}{answer} and its relatives draw a line holding the words
// (problems) or the answer in bold (solutions). Their calls get a tag of their
// own (v2/transforms/flagging.mjs) holding only what the version prints. Which
// definitions qualify is read from the definition itself: its body, token for
// token with blanks and comments aside, is one of handout.sty's three versions
// in the corpus (_work/_s300-count2.txt A: 22 files). A course's own \fitb
// written another way is flagged as before.
const FITB_3 = (ans, blank, frame) => String.raw`\ifmmode\renewcommand{\@fitbans}{` + ans + String.raw`$\bm{#3}$}\renewcommand{\@fitbblank}{` +
  blank + String.raw`$#1$}\else\renewcommand{\@fitbans}{` + ans + String.raw`\textbf{#3}}\renewcommand{\@fitbblank}{` + blank +
  String.raw`#1}\fi` + frame + String.raw`{\parbox[t]{#2}{\probonly{\@fitbblank}\solonly{\@fitbans}}}`;
const C = String.raw`\centering`, U = String.raw`\underline`, F = String.raw`\fbox`;
export const FITB_FORMS = Object.freeze([
  // \fitb (\mfitb is \let to it): Math Ma, Math Mb, Math 1b, ATC Math Ma
  { body: FITB_3("", "", U), words: 1, width: 2, answer: 3, blankAlign: "left", answerAlign: "left", box: false },
  // \cfitb as Math Mb, 1b and ATC Math Ma have it: the words centred too
  { body: FITB_3(C, C, U), words: 1, width: 2, answer: 3, blankAlign: "center", answerAlign: "center", box: false },
  // \cfitb as Math Ma has it: only the answer centred
  { body: FITB_3(C, "", U), words: 1, width: 2, answer: 3, blankAlign: "left", answerAlign: "center", box: false },
  // Math Ma's \fitbox and \cfitbox: a frame instead of the underline
  { body: FITB_3("", "", F), words: 1, width: 2, answer: 3, blankAlign: "left", answerAlign: "left", box: true },
  { body: FITB_3(C, "", F), words: 1, width: 2, answer: 3, blankAlign: "left", answerAlign: "center", box: true },
  // the older two-part \fitb{width}{answer} (ATC Math Ma's Exam 1 copy)
  { body: String.raw`\underline{\parbox[t]{#1}{\probonly{\ }\solonly{\textbf{#2}}}}`, words: null, width: 1, answer: 2, blankAlign: "left", answerAlign: "left", box: false },
].map((f) => Object.freeze(f)));
const shape = (ts) => ts.filter((t) => t.kind !== "Space" && t.kind !== "Newline" && t.kind !== "Comment").map((t) => t.text).join("\u0001");
const FORM_SHAPES = FITB_FORMS.map((f) => shape(tokenize(f.body, { profile: "style" }).tokens));
// Does a one-argument switch print its argument, by its meaning at the end of
// the reading (as list-carrier's solonlyPrints)? true / false, or null when it
// is not a macro of one argument (what prints cannot be read).
function switchPrints(store, name) {
  const rec = store.resolve(name).record;
  if (!rec || rec.kind !== "macro" || !Array.isArray(rec.body) || (rec.params || []).length !== 1 || rec.params[0].type !== "mandatory") return null;
  return rec.body.some((t, j) => t.kind === "Parameter" && rec.body[j + 1] && rec.body[j + 1].text === "1");
}
// handout.sty's meaning of a record, with what this version prints: the form's
// roles plus { slots, probonly, solonly }, or null.
export function fitbMeaning(store, rec) {
  if (!rec || rec.kind !== "macro" || !Array.isArray(rec.body)) return null;
  const k = FORM_SHAPES.indexOf(shape(rec.body));
  if (k < 0) return null;
  const f = FITB_FORMS[k], params = rec.params || [];
  if (params.length !== (f.words ? 3 : 2) || params.some((p, j) => p.type !== (f.words && j === 0 ? "optional" : "mandatory"))) return null;
  if (f.words && shape((rec.defaultOf || {})[0] || []) !== "\\ ") return null;
  const probonly = switchPrints(store, "probonly"), solonly = switchPrints(store, "solonly");
  if (probonly === null || solonly === null) return null;
  return Object.freeze({ ...f, slots: params, probonly, solonly });
}

const authorRecord = (store, name, isAuthorFile) => {
  const own = store.lookup(name);
  if (!own || !own.origin || !isAuthorFile(own.origin.file)) return null;
  const rec = own.kind === "alias" ? store.resolve(name).record : own;
  return rec && (rec.kind === "macro" || rec.kind === "environment") ? rec : null;
};

// decideDefinitions({ store, isAuthorFile, list, choices })
// Returns Map name -> flaggedCommands' fields plus { decision, default, holds, fitb }:
//   decision  call | inside | leave (the choice when one is given, else the default)
//   holds     block (its own body draws) | flagged (reaches through another
//             flagged command) | box (holds only a box) | listed (also-flag) |
//             fitb (s301: handout.sty's fill-in-the-blank; tagged at the call)
//   fitb      fitbMeaning's roles and what this version prints, or null
export function decideDefinitions({ store, isAuthorFile, list = DEFAULT_FLAG_LIST, choices = {} } = {}) {
  const chosen = (name) => (CHOICES.includes(choices["\\" + name]) ? choices["\\" + name] : null);
  const left = Object.keys(choices).filter((k) => k.startsWith("\\") && choices[k] === "leave").map((k) => k.slice(1));
  const full = flaggedCommands({ store, isAuthorFile, list });
  const reached = left.length ? flaggedCommands({ store, isAuthorFile, list: { ...list, neverFlag: [...list.neverFlag, ...left] } }) : full;
  const boxes = list.boxes || {};
  const out = new Map();
  const names = new Set([...full.keys(), ...store.names()]);
  for (const name of names) {
    if (list.neverFlag.includes(name)) continue;
    const rec = authorRecord(store, name, isAuthorFile);
    const ts = bodyTokens(rec);
    const direct = ts.some((_, i) => blockAt(ts, i, list.blocks) !== null);
    const box = ts.find((t) => t.kind === "ControlWord" && Object.hasOwn(boxes, t.name));
    const f = full.get(name);
    const isLeft = chosen(name) === "leave";
    // flagged only through a command left by choice: as if it drew nothing
    const flagged = f && (isLeft || reached.has(name)) ? f : null;
    // s301: handout.sty's fill-in-the-blank is tagged at its call, whatever it
    // draws with (\fitbox's \fbox included); its tag holds what the version prints
    const fitb = rec ? fitbMeaning(store, rec) : null;
    if (!flagged && !box && !fitb) continue;
    const holds = fitb ? "fitb" : !flagged ? "box" : !rec ? "listed" : direct ? "block" : "flagged";
    const dflt = holds === "block" || holds === "listed" || holds === "fitb" ? "call" : "inside";
    const env = rec ? rec.kind === "environment" : false;
    out.set(name, Object.freeze({
      name, kind: flagged ? flagged.kind : env ? "environment" : "command",
      slots: flagged ? flagged.slots : rec.params || [], item: flagged ? flagged.item : !env && makesItem(ts),
      reach: flagged ? flagged.reach : fitb ? "handout.sty's fill-in-the-blank line" : "holds \\" + box.name,
      decision: chosen(name) || dflt, default: dflt, holds, fitb }));
  }
  return out;
}
