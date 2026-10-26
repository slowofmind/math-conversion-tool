// v2/flag-calls.mjs — session 257. FINDING the calls of flagged commands: the
// second of the flagging build's three parts (FLAGGING-PLAN-s257.md).
//
// Plain terms: this reads the author's files by tokens and lists every call
// of a flagged command (v2/flag-list.mjs), whatever the version: a call in a
// hidden solution, in a comment block or in an \ifthenelse branch is listed
// too (DECISIONS 2026-10-24, "inventory regardless of version"). For each it
// says WHERE it sits, because the tag's form depends on the place:
//   text         in running text: tagged
//   item         an author command that makes an \item: tagged as an item
//   option       inside a [..] option (a list's label=, an \item[..] marker,
//                an author macro's optional argument): Pandoc never shows a
//                tag there (s256 3b), and a \verb there stops pdflatex
//                (_work/_s257-verb.txt), so it is listed only
//   protected    right after \protect: TeX would expand the tag's \verb
//   maths        inside $..$ or a maths environment: Nicholas's separate
//                maths workflow; listed only
//   picture      inside a tikzpicture or another picture environment
//                (structure.mjs isPictureEnv): Pandoc keeps the whole
//                picture as raw TeX, so a tag there is never seen
//                (_work/_s257-pandoc.txt); listed only
//   environment  an author environment that draws: listed only for now
//   unreadable   its arguments cannot be read (not in braces)
//   nested       inside another flagged call: carried in that call's tag
// and whether THIS VERSION PRINTS it: yes; no (an environment this reading
// hides, a comment block, an argument the macro drops - \solonly in the
// problem version); depends (inside \ifthenelse).
//
// Calls are found by tokens: a definition statement is skipped whole; the
// arguments are read by the definition's own slots (readArguments). No
// regular expression decides where anything begins or ends.
//
// Session 258 (FLAGGING-PLAN2-s257.md, approved with option B): a command whose
// tag goes INSIDE its definition (v2/flag-list.mjs decideDefinitions) is still
// listed at every call, untagged there; findDefinitionSites lists the pieces
// inside the definitions - the "definition sites" - and each call names the
// sites its definition holds. Every site and every call has an ID found from
// its content, and flagTracker gives the rows that link them.
import { tokenize } from "./tokenizer.mjs";
import { readGroup, readBracket, matchEnvironment, findMath, isPictureEnv } from "./structure.mjs";
import { readDefinition, isDefinitionForm, readArguments, groupText } from "./definition.mjs";
import { DEFAULT_FLAG_LIST, slotsOf } from "./flag-list.mjs";
import { carriedSource } from "./transforms/flagging.mjs";
import { chooseBranch, ifThenState } from "./transforms/ifthen.mjs";

const envName = (ts, i) => { const g = readGroup(ts, i + 1); return g ? groupText(ts, g).trim() : null; };

// Does a macro's body use its parameter number k (#k)?
function usesParam(rec, k) {
  const body = Array.isArray(rec.body) ? rec.body : [];
  for (let j = 0; j + 1 < body.length; j++)
    if (body[j].kind === "Parameter" && body[j + 1].text === String(k)) return true;
  return false;
}

// The zones of one token list: ranges of token indices with what they mean.
function zonesOf(tokens, { store, hidden }) {
  const zones = [];
  const add = (open, close, kind, why) => zones.push({ open, close, kind, why });
  for (const m of findMath(tokens)) add(m.open, m.close, "maths");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord") continue;
    if (isDefinitionForm(t.name) || t.name === "global" || t.name === "long") {
      const d = readDefinition(tokens, i);
      if (d && d.close > i) { add(i, d.close, "definition"); i = d.close; }
      continue;
    }
    if (t.name === "begin") {
      const name = envName(tokens, i);
      if (name !== null && isPictureEnv(name)) {
        const env = matchEnvironment(tokens, i);
        if (env) add(i, env.close, "picture");
      }
      if (name !== null && hidden.has(name)) {
        const env = matchEnvironment(tokens, i);
        if (env) add(i, env.close, "hidden", "inside \\begin{" + name + "}, which this version hides");
      }
      const g = readGroup(tokens, i + 1);
      const b = g ? readBracket(tokens, g.close + 1) : null;
      if (b) add(b.open, b.close, "option");
      continue;
    }
    if (t.name === "item") { const b = readBracket(tokens, i + 1); if (b) add(b.open, b.close, "option"); continue; }
    if (t.name === "ifthenelse") {
      let j = i + 1, last = i;
      for (let k = 0; k < 3; k++) { const g = readGroup(tokens, j); if (!g) break; last = g.close; j = g.close + 1; }
      if (last > i) add(i, last, "depends", "inside \\ifthenelse: which branch prints depends on the version");
      continue;
    }
    const rec = store && store.lookup(t.name);
    if (!rec || rec.kind !== "macro" || !rec.params || !rec.params.length) continue;
    const r = readArguments(tokens, i + 1, rec.params);
    if (!r) continue;
    r.args.forEach((a, k) => {                                   // every slot is a parameter, #1 first
      const slot = rec.params[k];
      if (!a || a.open === undefined) return;
      if (slot.type === "optional") add(a.open, a.close, "option");
      else if (slot.type === "mandatory" && !usesParam(rec, k + 1))
        add(a.open, a.close, "dropped", "in an argument \\" + t.name + " drops in this version");
    });
  }
  return zones;
}

// Session 262: the place of the token at index k, as callsIn names a call's -
// definition, picture, maths, option, protected or text - and whether it sits
// inside an \ifthenelse (depends) or a hidden environment. For a piece of a
// definition written out at a call (v2/expand-body.mjs), so it is tagged only
// where a call there would be. The zones are found once per token list.
const ZONES = new WeakMap();
export function placeAt(tokens, k, { store, hidden = [] } = {}) {
  let z = ZONES.get(tokens);
  if (!z) { z = zonesOf(tokens, { store, hidden: new Set(hidden) }); ZONES.set(tokens, z); }
  const here = z.filter((x) => x.open <= k && k <= x.close);
  let prev = k - 1;
  while (prev >= 0 && tokens[prev].kind === "Space") prev--;
  const place = here.some((x) => x.kind === "definition") ? "definition"
    : here.some((x) => x.kind === "picture") ? "picture"
    : here.some((x) => x.kind === "maths") ? "maths"
    : here.some((x) => x.kind === "option") ? "option"
    : prev >= 0 && tokens[prev].kind === "ControlWord" && tokens[prev].name === "protect" ? "protected" : "text";
  return { place, depends: here.some((x) => x.kind === "depends"), option: here.some((x) => x.kind === "option") };
}

// One call's arguments by its slots; the index of its last token, or null
// when they cannot be read (a mandatory argument not in braces counts as not
// read: one token of running text is not an argument anyone meant).
function callEnd(tokens, i, slots) {
  if (!slots.length) return i;
  const r = readArguments(tokens, i + 1, slots);
  if (!r) return null;
  let last = i;
  for (let k = 0; k < r.args.length; k++) {
    const a = r.args[k];
    if (slots[k].type === "mandatory" && (!a || !a.braced)) return null;
    if (a && a.open !== undefined && a.close >= last) last = a.close;
  }
  return last;
}

// Calls in one token list. base: offset added to every position (a comment
// block's body re-read on its own). Returns plain objects; the caller freezes.
function callsIn(tokens, file, text, commands, opts, base, hiddenWhy) {
  const zones = zonesOf(tokens, opts);
  const at = (i) => zones.filter((z) => z.open <= i && i <= z.close);
  const out = [];
  let outerEnd = -1, outerName = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "Region" && t.region === "verbatim-env" && t.name === "comment") {
      const s = text.slice(t.start, t.end);
      const open = s.indexOf("}") + 1, close = s.lastIndexOf("\\end");
      if (open > 0 && close > open) {
        const inner = tokenize(s.slice(open, close), { profile: opts.profile }).tokens;
        out.push(...callsIn(inner, file, s.slice(open, close), commands, opts, base + t.start + open, "inside \\begin{comment}"));
      }
      continue;
    }
    if (t.kind !== "ControlWord") continue;
    const here = at(i);
    if (here.some((z) => z.kind === "definition")) continue;
    let name = t.name, def = commands.get(name), env = false;
    if (name === "begin") {
      const e = envName(tokens, i);
      if (e === null || !commands.has(e) || commands.get(e).kind !== "environment") continue;
      name = e; def = commands.get(e); env = true;
    } else if (!def || def.kind !== "command") continue;

    let last = env ? readGroup(tokens, i + 1).close : callEnd(tokens, i, def.slots);
    const readable = last !== null;
    if (!readable) last = i;
    const start = tokens[i].start, end = tokens[last].end;
    let prev = i - 1;
    while (prev >= 0 && tokens[prev].kind === "Space") prev--;
    const place = start < outerEnd ? "nested"
      : env ? "environment"
      : here.some((z) => z.kind === "picture") ? "picture"
      : here.some((z) => z.kind === "maths") ? "maths"
      : here.some((z) => z.kind === "option") ? "option"
      : prev >= 0 && tokens[prev].kind === "ControlWord" && tokens[prev].name === "protect" ? "protected"
      : !readable ? "unreadable"
      : def.item ? "item" : "text";
    const no = hiddenWhy || (here.find((z) => z.kind === "hidden" || z.kind === "dropped") || {}).why;
    const dep = (here.find((z) => z.kind === "depends") || {}).why;
    const decision = def.decision || "call";
    out.push({ name, file, open: i, close: last, start: base + start, end: base + end, place,
               shown: no ? "no" : dep ? "depends" : "yes", shownWhy: no || dep || "",
               outer: place === "nested" ? outerName : null, inRegion: !!hiddenWhy, inDepends: !!dep,
               source: text.slice(start, end), reach: def.reach, decision });
    // only a call tagged whole carries the calls inside it (s258: the words of
    // an "inside" command's arguments reach Pandoc, so their calls are tagged)
    if (place !== "nested" && decision === "call" && end > outerEnd) { outerEnd = end; outerName = name; }
  }
  return out;
}

// The line an offset sits on, counted from 1.
const lineAt = (text, at) => { let n = 1; for (let j = text.indexOf("\n"); j >= 0 && j < at; j = text.indexOf("\n", j + 1)) n++; return n; };

// IDs found again by content (plan section 3): a letter and six digits from
// the file, the definition or command name, the source as \verb carries it
// and its number among identical ones in that file - so an edit elsewhere in
// the file does not move them. Six digits rather than a running count for
// that reason. No brackets: "[D1]" inside \item[..] ended the marker (M2).
function idMaker(letter) {
  const used = new Set(), seen = new Map();
  return (key) => {
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    let h = 0x811c9dc5;
    const s = key + "\u0001" + n;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
    let v = h % 1000000;
    while (used.has(v)) v = (v + 1) % 1000000;           // a clash in one run: the next free number
    used.add(v);
    return letter + String(v).padStart(6, "0");
  };
}

// findFlagCalls({ files, commands, store, hidden, sites, choices })
//   files     [{ path, tokens, text, profile }]: the author's own files (no packages)
//   commands  from flaggedCommands, or decideDefinitions (s258: with decisions)
//   store     the reader's finished store (which macros drop an argument)
//   hidden    the environment names this reading hides
//   sites     from findDefinitionSites: each call of an "inside" command names
//             the sites in the definition it expands
//   choices   { "U<n>": "leave" } leaves one call untagged
// Returns the calls in file order, each { id, name, file, line, open, close,
//   start, end, place, shown, shownWhy, outer, inRegion, inDepends, source,
//   reach, decision, left, sites }; open and close are token indices in that
//   file's tokens (none inside a comment block: inRegion is true there).
export function findFlagCalls({ files = [], commands, store, hidden = [], sites = [], choices = {} } = {}) {
  const out = [];
  if (!commands || !commands.size) return out;
  const hid = new Set(hidden);
  const newId = idMaker("U");
  for (const f of files) {
    const calls = callsIn(f.tokens, f.path, f.text, commands, { store, hidden: hid, profile: f.profile }, 0, null);
    for (const c of calls) {
      c.id = newId(c.file + "\u0001" + c.name + "\u0001" + carriedSource(c.source));
      c.line = lineAt(f.text, c.start);
      c.left = c.decision === "leave" || choices[c.id] === "leave";
      c.leftWhy = c.decision === "leave" ? "left by choice (\\" + c.name + ")" : c.left ? "left by choice (this call, " + c.id + ")" : "";
      c.sites = c.decision === "inside" ? sitesOf(c.name, sites, store).map((s) => s.id) : [];
    }
    out.push(...calls);
  }
  return out;
}

// The sites in the definition a call of `name` expands: the statement the
// store keeps (its origin), or every statement of that name when the store
// does not say.
function sitesOf(name, sites, store) {
  const mine = sites.filter((s) => s.definition === name);
  const rec = store && store.resolve ? store.resolve(name).record : null;
  const o = rec && rec.origin;
  const exact = o ? mine.filter((s) => s.file === o.file && s.defStart === o.start) : [];
  return exact.length ? exact : mine;
}

// ---- definition sites (session 258) -----------------------------------------
const THREE = [{ type: "mandatory" }, { type: "mandatory" }, { type: "mandatory" }];

// The token ranges of every \ifthenelse and \DeclareOption in a file.
function conditionals(ts) {
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind !== "ControlWord") continue;
    if (t.name === "ifthenelse") {
      const r = readArguments(ts, i + 1, THREE);
      if (r && r.args[2]) out.push({ kind: "ifthenelse", open: i, close: r.args[2].close });
    } else if (t.name === "DeclareOption") {
      let j = i + 1;
      if (ts[j] && ts[j].kind === "Other" && ts[j].text === "*") j++;
      const g1 = readGroup(ts, j), g2 = g1 && ts[j].text !== "*" ? readGroup(ts, g1.close + 1) : null;
      const close = g2 ? g2.close : g1 ? g1.close : null;
      if (close !== null) out.push({ kind: "option", open: i, close });
    }
  }
  return out;
}

// The last token a piece's tag closes after: a piece ending in a command word
// takes the blanks TeX skips after it (M2 run 3), never past `limit`.
function tailIn(ts, last, limit) {
  if (ts[last].kind !== "ControlWord") return last;
  let j = last + 1;
  while (j <= limit && ts[j].kind === "Space") j++;
  if (j <= limit && ts[j].kind === "Newline") {
    let k = j + 1;
    while (k <= limit && ts[k].kind === "Space") k++;
    if (!(k <= limit && ts[k].kind === "Newline")) j++;
  }
  return j - 1;
}

const LISTED_DEF = {
  option: "the definition sits in a package option's code, which Pandoc ignores (it reads the package's base definition)",
  ifthenelse: "the definition sits inside an \\ifthenelse, so Pandoc never sees it as written",
  csname: "the definition's name is built with \\csname (or cannot be read), so Pandoc never reads it",
};

// findDefinitionSites({ files, commands, store, list, choices, flags })
//   files     [{ path, tokens, text }]: every file the document reads that is
//             the author's, packages INCLUDED (the tags go in their -pp copies)
//   commands  from decideDefinitions
//   flags     the reader's flags: an \ifthenelse inside a definition is folded
//             by the ifthen fix with these, so a piece in a branch it removes
//             is listed, and one in the branch it keeps is tagged through it
//   choices   { "D<n>": "leave" } leaves one site untagged
// A piece is a call of a command tagged at the call, inside a definition whose
// decision is "inside"; or a box-family call inside any author definition not
// tagged at the call or left. Returns the sites in file order, each { id,
// file, line, definition, env, piece, kind (call | box), source, start, end,
// open, close, tail, defStart, status (tag | listed), why, viaIfthen, outer }.
export function findDefinitionSites({ files = [], commands = new Map(), list = DEFAULT_FLAG_LIST, choices = {}, flags = {} } = {}) {
  const out = [];
  const boxes = list.boxes || {};
  const state = ifThenState(flags);
  for (const f of files) {
    const ts = f.tokens, at = new Map(ts.map((t, k) => [t, k]));
    const conds = conditionals(ts);
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t.kind !== "ControlWord" || !(isDefinitionForm(t.name) || t.name === "global" || t.name === "long")) continue;
      const d = readDefinition(ts, i);
      if (!d || d.close <= i) continue;
      const name = d.def ? d.def.name : null;
      const info = name !== null ? commands.get(name) : null;
      i = d.close;
      if (name !== null && (!info || info.decision !== "inside")) continue;
      if (d.def && d.def.kind !== "macro" && d.def.kind !== "environment") continue;
      // the body parts as token index ranges
      const body = !d.def ? [[d.open + 1, d.close]]
        : (Array.isArray(d.def.body) ? [d.def.body] : [d.def.body.beginBody || [], d.def.body.endBody || []])
            .filter((p) => p.length).map((p) => [at.get(p[0]), at.get(p[p.length - 1])]);
      const around = conds.filter((c) => c.open < d.open && d.close <= c.close);
      const defWhy = name === null ? LISTED_DEF.csname : around.length ? LISTED_DEF[around[0].kind] : "";
      const inner = conds.filter((c) => c.kind === "ifthenelse" && d.open < c.open && c.close <= d.close);
      for (const [a, b] of body) {
        let outer = null;
        for (let k = a; k <= b; k++) {
          const p = ts[k];
          if (p.kind !== "ControlWord") continue;
          const c = commands.get(p.name);
          const call = c && c.kind === "command" && c.decision === "call" ? c : null;
          if (!call && !Object.hasOwn(boxes, p.name)) continue;
          const slots = call ? call.slots : slotsOf(boxes[p.name]);
          const r = slots.length ? readArguments(ts, k + 1, slots) : { args: [] };
          let last = k, readable = !!r;
          if (r) for (let m = 0; m < r.args.length; m++) {
            const g = r.args[m];
            if (slots[m].type === "mandatory" && (!g || !g.braced)) readable = false;
            if (g && g.open !== undefined && g.close > last) last = g.close;
          }
          if (last > b) readable = false;
          if (!readable) last = k;
          // an \ifthenelse inside the definition: the piece is kept only if it
          // sits in the branch the fold keeps at every level around it
          const ifs = inner.filter((x) => x.open < k && last <= x.close);
          let kept = true, limit = b;
          for (const x of ifs) {
            const ch = chooseBranch(ts, x.open, state);
            if (!ch || !ch.keep || k < ch.keep[0] || last > ch.keep[1]) { kept = false; break; }
            limit = Math.min(limit, ch.keep[1]);
          }
          const tail = readable ? tailIn(ts, last, limit) : k;
          const site = { file: f.path, line: lineAt(f.text, p.start), definition: name, env: !!(d.def && d.def.kind === "environment"),
                         piece: p.name, kind: call ? "call" : "box", source: f.text.slice(p.start, ts[last].end),
                         start: p.start, end: ts[last].end, open: k, close: last, tail, defStart: ts[d.open].start,
                         status: "tag", why: "", viaIfthen: ifs.length > 0, outer: null };
          // s262: `cause` names why a site is listed, for the written-out copies
          // (v2/expand-body.mjs): a piece in a branch or in option code can still
          // be written out at a call, the others cannot be wrapped there either
          if (outer && k <= outer.close) { site.status = "listed"; site.outer = outer; site.cause = "outer"; }   // inside another piece
          else if (defWhy) { site.status = "listed"; site.why = defWhy; site.cause = name === null ? "csname" : around[0].kind; }
          else if (!readable) { site.status = "listed"; site.cause = "unreadable"; site.why = "its argument is not in braces inside the definition (the course's framed: an \\fbox opened in one place and closed in another), so it cannot be wrapped"; }
          else if (!kept) { site.status = "listed"; site.cause = "branch"; site.why = "it sits in an \\ifthenelse branch the \\ifthenelse fix removes from the -pp copy (it keeps the ELSE branch when the test cannot be settled), so Pandoc never sees it"; }
          if (!site.outer) outer = site;
          out.push(site);
        }
      }
    }
  }
  const newId = idMaker("D");
  for (const s of out)
    s.id = newId(s.file + "\u0001" + (s.definition === null ? "line " + s.line : s.definition) + "\u0001" + carriedSource(s.source));
  for (const s of out)
    if (s.status === "tag" && choices[s.id] === "leave") { s.status = "listed"; s.cause = "choice"; s.why = "left by choice (this site, " + s.id + ")"; }
  for (const s of out)
    if (s.outer) s.why = s.outer.status === "tag" ? "carried inside the tag of " + s.outer.id + " (\\" + s.outer.piece + ")"
      : "inside \\" + s.outer.piece + " (" + s.outer.id + "), which is not tagged: " + s.outer.why;
  return out;
}

// ---- the report's entries (design item 3) -----------------------------------
// Shaped like surface.mjs's dropped entries - { rule, name, file, span, note }
// - so other streams (names nothing defines and Pandoc does not know, the
// Pandoc log) can join the same list later; plus the flag's own fields.
const LEFT = {
  option: "inside a [..] option: Pandoc shows no tag there, and a \\verb there stops pdflatex",
  protected: "right after \\protect: TeX would expand the tag's \\verb",
  maths: "inside maths, a separate workflow: Pandoc would keep a tag there only as maths text",
  picture: "inside a picture (tikzpicture and the like): Pandoc keeps the whole picture as raw TeX, so a tag there is never seen",
  environment: "an environment: its tag form is not built yet",
  unreadable: "its arguments are not in braces, so where the call ends cannot be read",
};
function whyLeft(c) {
  if (c.place === "nested") return "carried inside the tag of \\" + c.outer;
  if (LEFT[c.place]) return LEFT[c.place];
  if (c.why) return c.why;
  if (c.inRegion) return "inside \\begin{comment}, which neither TeX nor Pandoc reads";
  if (c.inDepends) return "inside \\ifthenelse, which another fix settles; no tag is written inside it";
  return "the tool did not reach it to write the tag";
}

// A call of an "inside" command: not tagged at the call, the pieces of its
// definition are (session 258).
const insideUse = (c) => !c.tagged && c.place !== "nested" && !c.left && c.decision === "inside";
function whyInside(c, sites) {
  const mine = sites.filter((s) => c.sites.includes(s.id));
  const tagged = mine.filter((s) => s.tagged).map((s) => s.id);
  return tagged.length ? "its words reach Pandoc; the pieces inside its definition are tagged there instead: " + tagged.join(", ")
    : "its words reach Pandoc; its definition holds no piece a tag could be written around" + (mine.length ? " (" + mine.map((s) => s.id).join(", ") + " listed)" : "");
}

// flagEntries(calls, sites) -> { entries, byName, total, sites }, after the
// transform has marked each call and site tagged or not. Nothing is written
// anywhere. Rules: flag/tagged, flag/inside (s258: tagged inside its
// definition), flag/left; a site's: flag/site-tagged, flag/site-left.
// Session 262: a call written out at the call (v2/expand-body.mjs) - decision
// "expanded" - is rule flag/expanded; its sites are the definition sites whose
// written copies it holds.
function expandedEntry(c, sites) {
  const tagged = sites.filter((s) => c.sites.includes(s.id)).map((s) => s.id);
  const why = "it is written out in the -pp copy, its arguments in its definition" + (c.left
    ? "; the pieces of its definition in that text are " + c.leftWhy.replace(/^left/, "left untagged")
    : tagged.length ? "; the pieces of its definition in that text are tagged there with their IDs: " + tagged.join(", ") : "");
  const said = "\\" + c.name;
  return Object.freeze({
    rule: "flag/expanded", name: c.name, file: c.file, span: Object.freeze({ start: c.start, end: c.end }),
    note: said + " draws something Pandoc cannot carry (" + c.reach + "). It is " + why.slice(6) + ".",
    place: c.place, shown: c.shown, why, tagged: false, source: c.source, reach: c.reach,
  });
}

export function flagEntries(calls, sites = []) {
  const entries = calls.map((c) => {
    if (c.decision === "expanded") return expandedEntry(c, sites);
    // why no tag was written, and why this version does not (or may not) print it
    const inside = insideUse(c);
    const parts = c.tagged ? [] : [inside ? whyInside(c, sites) : c.left && c.place !== "nested" ? c.leftWhy : whyLeft(c)];
    if (c.shownWhy && !parts.includes(c.shownWhy)) parts.push(c.shownWhy);
    const why = parts.join("; ");
    const said = c.place === "environment" ? "\\begin{" + c.name + "}" : "\\" + c.name;
    return Object.freeze({
      rule: c.tagged ? "flag/tagged" : inside ? "flag/inside" : "flag/left",
      name: c.name, file: c.file, span: Object.freeze({ start: c.start, end: c.end }),
      note: said + " draws something Pandoc cannot carry (" + c.reach + "). " + (c.tagged
        ? "The -pp copy keeps it for TeX and gives Pandoc a tag holding its source, for a later step to replace."
        : inside ? "It is left whole: " + why + "."
        : "It is listed here and left as it is: " + why + "."),
      place: c.place, shown: c.shown, why, tagged: !!c.tagged, source: c.source, reach: c.reach,
    });
  });
  const counts = new Map();
  for (const e of entries) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  const byName = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name, count]) => Object.freeze({ name, count }));
  const siteRows = sites.map((s) => Object.freeze({
    rule: s.tagged ? "flag/site-tagged" : "flag/site-left", id: s.id, file: s.file, line: s.line,
    span: Object.freeze({ start: s.start, end: s.end }), definition: s.definition, env: s.env, piece: s.piece, kind: s.kind,
    status: s.tagged ? "tagged" : "listed", why: s.tagged ? "" : s.why || "the tool did not reach it to write the tag",
    tagged: !!s.tagged, source: s.source, written: s.written || 0,   // s262: its tagged copies in written-out calls
    uses: Object.freeze(calls.filter((c) => c.sites && c.sites.includes(s.id)).map((c) => Object.freeze({ id: c.id, file: c.file, span: Object.freeze({ start: c.start, end: c.end }) }))),
  }));
  return Object.freeze({ entries: Object.freeze(entries), byName: Object.freeze(byName), total: entries.length, sites: Object.freeze(siteRows) });
}

// flagTracker(calls, sites) -> { definitions, uses }: one row per site with
// its stable ID (plan section 3). Definition rows link to the calls that
// expand them, use rows to the definition sites they expand. `decision` is the
// definition's; `replacement` is the slot the HTML replacement module will
// fill, unused in this build.
export function flagTracker(calls, sites = []) {
  const definitions = sites.map((s) => Object.freeze({
    id: s.id, file: s.file, line: s.line, definition: s.definition, env: s.env, piece: s.piece, kind: s.kind, source: s.source,
    status: s.tagged ? "tagged" : "listed", why: s.tagged ? "" : s.why, written: s.written || 0,
    uses: Object.freeze(calls.filter((c) => c.sites && c.sites.includes(s.id)).map((c) => c.id)), replacement: null }));
  const uses = calls.map((c) => Object.freeze({
    id: c.id, file: c.file, line: c.line, name: c.name, source: c.source, place: c.place, shown: c.shown,
    decision: c.decision === "expanded" ? "expanded" : c.left ? "leave" : c.decision, tagged: !!c.tagged, sites: Object.freeze([...(c.sites || [])]), replacement: null }));
  return Object.freeze({ definitions: Object.freeze(definitions), uses: Object.freeze(uses) });
}
