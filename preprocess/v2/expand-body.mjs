// v2/expand-body.mjs — session 262. Fix B: every call of an author command in
// the body written out BEFORE the walk (sessions/EXPANDER-PLAN-s260.md,
// approved: Decision 1 B every call, 2 A, 3 A; DECISIONS 2026-10-24).
//
// Plain terms: Pandoc drops every \ifthenelse, so a command whose \ifthenelse
// asks about its own arguments lost the branch TeX prints. This step puts each
// call's arguments into its definition, chooses each branch for that call
// (the expander, v2/expand.mjs), and writes the result in place of the call
// in the author's text. The other fixes then run on that text, as on any
// other (M2: they already edit inside these calls, and some edits cross a
// call's edge, so writing calls out inside the walk would break them).
//
// What is written out: every call of a command defined in the author's own
// files, in the body (after \begin{document}, and in files read there), not
// inside a definition, not inside maths (the expander keeps those), and not a
// command that flagging tags at the call (Decision 3 A: its tag holds its
// source). A call the expander cannot settle stays exactly as written,
// arguments and all (invariant X1), and is reported with the reason.
// Three guards refuse a written-out text that would read differently where it
// lands: a command name that is not letters only (\@x: @ is not a letter in
// the body), a ] at the top level inside a [..] option (it would end the
// option), and a # parameter.
//
// Each piece of a definition site (v2/flag-calls.mjs findDefinitionSites)
// that the written text holds is found by its POSITION in the definition's
// body - the token at that place in the store's body is the token the
// expander emits (M3: the site's own token is not) - so flagging can tag it
// there with the site's ID.
//
// Pure: no file is read or written (the platform rule, v2/run.mjs).
import { createExpander } from "./expand.mjs";
import { readDefinition, isDefinitionForm, readArguments, groupText, FLAG_FORMS } from "./definition.mjs";
import { readGroup } from "./structure.mjs";
import { placeAt } from "./flag-calls.mjs";

const isDefAt = (t) => t.kind === "ControlWord" && (isDefinitionForm(t.name) || t.name === "global" || t.name === "long");
const LETTERS = /^[A-Za-z]+$/;

// The token range of a file's body: after its own \begin{document} when it has
// one, to its \end{document} or its end.
function bodyRange(tokens) {
  let from = 0, to = tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "ControlWord" || (t.name !== "begin" && t.name !== "end")) continue;
    const g = readGroup(tokens, i + 1);
    if (!g || groupText(tokens, g).trim() !== "document") continue;
    if (t.name === "begin" && from === 0) from = g.close + 1;
    else if (t.name === "end") { to = i; break; }
  }
  return [from, to];
}

// Why a written-out text cannot stand where the call was, or null.
function guard(x, own, inOption, store, source) {
  for (const t of x.emitted) {
    if (t.kind === "Parameter") return ["expand/refused-parameter", "its written-out text would hold a # parameter"];
    // a switch set at typesetting time (\circleitem's \setboolean{doCircle}{true},
    // read by \maybecircle as the label is set): design C, not in this build.
    // Written into the body it would also change the switches the reader
    // finds for the whole document, and with them every \ifthenelse the fold
    // settles. So the call stays as it is, and the list fix still sees it.
    if (t.kind === "ControlWord" && (FLAG_FORMS.has(t.name) || (store.flagSetter && store.flagSetter(t.name))))
      return ["expand/refused-switch", "its written-out text would set a switch (\\" + t.name + ") that TeX reads while typesetting; those are left for a later design"];
    if (t.kind === "ControlWord" && !own(t) && !LETTERS.test(t.name))
      return ["expand/refused-name", "its written-out text would name \\" + t.name + ", which reads differently in the body (only letters make a command name there)"];
  }
  // an environment opened in one call and closed in another (Math Ma ws20:
  // \probonly{\begin{enumeratecols}{3}} ... \probonly{\end{enumeratecols}}): TeX
  // reads it written out the same, but Pandoc then reads the author's
  // environment itself, and there it lost the question above the list
  // (_work/_s262-pandoc.txt). Hidden in the call, Pandoc kept it.
  // The call as the author wrote it counts too: \solonly{\begin{enumerate}} written
  // as nothing in the problem version still lost ws20's question (_s262_ws20b.mjs).
  const split = (ts, what) => {
    const open = [];
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k];
      if (t.kind !== "ControlWord" || (t.name !== "begin" && t.name !== "end")) continue;
      const g = readGroup(ts, k + 1);
      if (!g) continue;
      const env = groupText(ts, g).trim();
      if (t.name === "begin") open.push(env);
      else if (open.length && open[open.length - 1] === env) open.pop();
      else return ["expand/refused-environment", what + " closes \\end{" + env + "}, opened outside it; written out, Pandoc would read the environment differently"];
    }
    return open.length ? ["expand/refused-environment", what + " opens \\begin{" + open[open.length - 1] + "} and does not close it; written out, Pandoc would read the environment differently"] : null;
  };
  const s = split(x.emitted, "its written-out text") || split(source, "the call");
  if (s) return s;
  if (inOption) {
    let d = 0;
    for (const t of x.emitted) {
      if (t.kind === "BeginGroup") d++;
      else if (t.kind === "EndGroup") d--;
      else if (d === 0 && t.text === "]") return ["expand/refused-option", "it sits in a [..] option and its written-out text holds a ] that would end the option"];
    }
  }
  return null;
}

// expandBody({ files, project, reader, entry, capability, flagCommands, flagSites, packageFiles })
//   files         Map name -> the author's text (unchanged)
//   project, reader  classifyFiles and readDocument on those files
//   flagCommands  decideDefinitions' map (decision "call": not written out)
//   flagSites     findDefinitionSites' sites on those files
//   packageFiles  the files read as packages (never written out)
// Returns { files, changed, edits, calls, findings, written }:
//   files    Map name -> text with the calls written out
//   edits    Map name -> [{ start, end, text, name, pieces }] in the original
//            file's offsets, sorted; pieces: [{ eFrom, eTo, oFrom, oTo }], the
//            argument tokens' places in the written text (offset in `text`)
//            and in the original
//   calls    every call looked at: { file, name, kind, rule, span, reason }
//   findings for the report, located in the ORIGINAL files
//   written  [{ file, start, end, id, kind, piece, definition }]: each written
//            copy of a definition site, positions in the NEW text
export function expandBody({ files, project, reader, entry, capability, flagCommands = new Map(), flagSites = [], packageFiles = new Set() }) {
  const out = { files: new Map(files), changed: false, edits: new Map(), calls: [], findings: [], written: [] };
  const bodyFrom = reader.body ? reader.body.event : null;
  if (bodyFrom === null || bodyFrom === undefined) return out;
  const store = reader.store;
  // Decision 3 A: a command flagging tags at the call - its own definition draws
  // - stays a call; also when the author chose to leave it untagged
  const keep = (n) => { const c = flagCommands.get(n); return !!c && c.kind === "command" && (c.decision === "call" || (c.decision === "leave" && c.default === "call")); };
  const author = (n) => { const rec = store.lookup(n); return !!rec && !!rec.origin && files.has(rec.origin.file) && (rec.kind === "macro" || rec.kind === "alias"); };
  const ex = createExpander({ store, capability, flags: reader.summary.flags || {}, bodyFrom, textMode: true, keep });
  const hidden = reader.summary.hiddenEnvironments || [];

  // the definition sites by the token the store's body holds at their place
  const opens = new Map();                              // body token -> site
  for (const s of flagSites) {
    if (s.status !== "tag" && !["option", "ifthenelse", "branch"].includes(s.cause)) continue;
    if (s.definition === null || s.env) continue;
    const rec = store.lookup(s.definition);
    if (!rec || !Array.isArray(rec.body) || !rec.origin || rec.origin.file !== s.file) continue;
    const open = rec.body.find((t) => t.start === s.start), close = rec.body.find((t) => t.end === s.end);
    if (open && close) opens.set(open, { site: s, close });
  }

  const paths = [entry, ...reader.body.files.filter((p) => p !== entry)].filter((p) => files.has(p) && !packageFiles.has(p) && project.byPath.has(p));
  for (const f of paths) {
    const tokens = project.byPath.get(f).tokens, text = files.get(f);
    const own = new Set(tokens);
    const [from, to] = bodyRange(tokens);
    const edits = [];
    for (let i = from; i < to; i++) {
      const t = tokens[i];
      if (isDefAt(t)) { const d = readDefinition(tokens, i); if (d && d.close > i) { i = d.close; continue; } }
      if (t.kind !== "ControlWord" || !author(t.name)) continue;
      const skipTo = (end) => { while (i + 1 < tokens.length && tokens[i + 1].end <= end) i++; };
      if (keep(t.name)) {                               // Decision 3 A: the whole call stays, its tag holds it
        const rec = store.lookup(t.name);
        const r = Array.isArray(rec.params) ? readArguments(tokens, i + 1, rec.params) : null;
        if (r) i = r.next - 1;
        continue;
      }
      let x;
      try { x = ex.expandAt(tokens, i, { file: f }); }
      catch (e) { x = { kind: "refused", span: { start: t.start, end: t.end }, finding: { rule: "expand/refused-threw", level: "unsupported", message: "the expander threw: " + String(e && e.message) } }; }
      // the call's own tokens - its arguments, as the author wrote them here - are
      // the file's tokens inside its span (a definition in the same file is not)
      const mine = (e, s) => own.has(e) && e.start >= s.start && e.end <= s.end;
      if (x.kind === "expanded") {
        const g = guard(x, (e) => mine(e, x.span), placeAt(tokens, i, { store, hidden }).option, store,
                        tokens.slice(i, tokens.findIndex((y, k) => k >= i && y.end >= x.span.end) + 1));
        if (g) x = { kind: "refused", span: x.span, finding: { rule: g[0], level: "unsupported", message: f + " — left \\" + t.name + " alone: " + g[1] + " [" + g[0] + "]", detail: { name: t.name } } };
      }
      const span = x.span || { start: t.start, end: t.end };
      out.calls.push({ file: f, name: t.name, kind: x.kind, rule: x.kind === "expanded" ? x.rule : x.finding ? x.finding.rule : null, span,
                       reason: x.finding && x.finding.detail ? x.finding.detail.reason : undefined });
      if (x.kind === "refused") {
        out.findings.push({ rule: x.finding.rule, channel: "attention", level: x.finding.level || "unsupported", kind: "literal", file: f,
                            span: { start: span.start, end: span.end }, message: x.finding.message, detail: Object.assign({ name: t.name }, x.finding.detail) });
        skipTo(span.end);
        continue;
      }
      if (x.kind !== "expanded") { if (x.span) skipTo(x.span.end); continue; }
      // the argument tokens' places in the written text, and the definition sites in it
      const pieces = [], sites = [];
      x.emitted.forEach((e, k) => {
        if (mine(e, span)) pieces.push({ eFrom: x.starts[k], eTo: x.starts[k] + e.text.length, oFrom: e.start, oTo: e.end });
        const o = opens.get(e);
        if (!o) return;
        for (let j = k; j < x.emitted.length; j++)
          if (x.emitted[j] === o.close) { sites.push({ site: o.site, from: x.starts[k], to: x.starts[j] + o.close.text.length }); break; }
      });
      edits.push({ start: span.start, end: span.end, text: x.text, name: t.name, pieces, sites });
      const removed = x.rule === "expand/removed-empty";
      out.findings.push({ rule: x.rule, channel: removed ? "removed" : "changed", level: null, kind: "literal", file: f,
                          span: { start: span.start, end: span.end },
                          message: f + " — wrote out \\" + t.name + (removed ? " as nothing" : "") + ": its arguments in its definition, each \\ifthenelse settled for this call [" + x.rule + "]",
                          detail: Object.assign({ name: t.name, text: x.text }, x.detail) });
      skipTo(span.end);
    }
    if (!edits.length) continue;
    out.changed = true;
    out.edits.set(f, edits);
    let s = "", at = 0;
    for (const e of edits) {
      s += text.slice(at, e.start);
      const base = s.length;
      for (const w of e.sites)
        out.written.push({ file: f, start: base + w.from, end: base + w.to, id: w.site.id, kind: w.site.kind, piece: w.site.piece, definition: w.site.definition, call: e });
      e.at = base;
      s += e.text;
      at = e.end;
    }
    out.files.set(f, s + text.slice(at));
  }
  return out;
}

// mapper(edits) -> (file, pos, side) -> { pos, exact }: a position in the
// written-out text back to the author's original file. Outside a written-out
// call it moves by what the edits before it changed; inside one, an argument
// token goes back to its own place (exact) and anything else to the call's
// edge - its start for a span's start, its end for a span's end.
export function mapper(edits) {
  return (file, pos, side = "start") => {
    const es = edits.get(file);
    if (!es || !Number.isInteger(pos)) return { pos, exact: true };
    let shift = 0;
    for (const e of es) {
      const len = e.text.length, a = e.start + shift, b = a + len;
      if (pos < a || (pos === a && (side === "end" || !len))) return { pos: pos - shift, exact: true };
      if (pos < b || (pos === b && side === "end")) {
        const off = pos - a;
        const p = e.pieces.find((x) => (side === "end" ? x.eFrom < off && off <= x.eTo : x.eFrom <= off && off < x.eTo));
        if (p) return { pos: p.oFrom + (off - p.eFrom), exact: true };
        return { pos: side === "end" ? e.end : e.start, exact: false };
      }
      shift += len - (e.end - e.start);
    }
    return { pos: pos - shift, exact: true };
  };
}
