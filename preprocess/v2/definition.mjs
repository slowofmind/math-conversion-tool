// v2/definition.mjs — Stage 3 of the v2 rebuild. DESIGN-V2 §4.3, §5.2.
//
// Plain terms: given the tokens of a file and the index of one token, say
// whether a defining statement starts there — \def, \newcommand, \let,
// \NewDocumentCommand, \newenvironment and their relatives — and if so,
// where it ends and what it defines. The answer is a Definition record
// (§5.2 plus `form`, the defining command). Nothing here changes a token
// and nothing here remembers anything between calls: remembering is
// v2/store.mjs's job.
//
// The defining commands are DATA (FORMS below): one row per command, each
// naming the shape it is read with and the clash rule the store applies.
// Recognition never keys on a course's own macro names (DESIGN-V2 §0).
//
// Refuse rather than guess: a recognised statement whose meaning cannot be
// read — a run-time \csname name, a braced name holding two tokens, an
// out-of-order #2#1, a missing body — returns { def: null } with a finding
// saying why, and still reports open/close so a walk can step over it.
//
// Reference shapes read before writing (README, Stage 3 entries):
//   Pandoc  Readers/LaTeX/Macro.hs  argspecPattern 151–155 (Symbol/Word
//           delimiters only), letmacro 61–78, newcommand 157–190,
//           newenvironment, checkGlobal (knows only \global)
//   KaTeX   parameter-text parser, KATEX-ANALYSIS.md Part 2
//   TeX     \let <cs><equals><one optional space><token>; an unbraced
//           argument is exactly one token (decision 3)
//
// Findings (§5.4) raised here all start "definition/". Slot shapes are §5.2's.
// Zero dependencies and no regular expressions (DESIGN-V2 §6).

import { skipSpaces, skipSp, readGroup, readBracket } from "./structure.mjs";

// ---- the table of defining commands -----------------------------------
// read   how the statement is read:  def | cmd | env | xcmd | xenv | let |
//        copy | envcopy | paired | opaque (with `slots`)
// clash  what the store does when the name already exists:
//        overwrite | ignore (+ store/already-defined) | renew (unknown name
//        → defined + store/renew-undefined) | provide (known name → no-op) |
//        robust (overwrite + store/pandoc-ignores-redefinition, C3)
// global true for the forms that always write through (\gdef, \xdef)
const ROW = (form, read, clash, extra) => Object.assign({ form, read, clash, global: false }, extra || {});
export const FORMS = new Map([
  ["def", ROW("def", "def", "overwrite")],  ["gdef", ROW("gdef", "def", "overwrite", { global: true })],
  ["edef", ROW("edef", "def", "overwrite")], ["xdef", ROW("xdef", "def", "overwrite", { global: true })],
  ["newcommand", ROW("newcommand", "cmd", "ignore")],
  ["renewcommand", ROW("renewcommand", "cmd", "renew")],
  ["providecommand", ROW("providecommand", "cmd", "provide")],
  ["DeclareRobustCommand", ROW("DeclareRobustCommand", "cmd", "robust")],
  ["DeclareMathOperator", ROW("DeclareMathOperator", "cmd", "ignore", { operator: true })],
  ["newrobustcmd", ROW("newrobustcmd", "cmd", "ignore")],          // etoolbox (D4)
  ["renewrobustcmd", ROW("renewrobustcmd", "cmd", "renew")],
  ["providerobustcmd", ROW("providerobustcmd", "cmd", "provide")],
  ["newenvironment", ROW("newenvironment", "env", "ignore")],
  ["renewenvironment", ROW("renewenvironment", "env", "renew")],
  ["provideenvironment", ROW("provideenvironment", "env", "provide")],
  ["NewDocumentCommand", ROW("NewDocumentCommand", "xcmd", "ignore")],
  ["RenewDocumentCommand", ROW("RenewDocumentCommand", "xcmd", "renew")],
  ["ProvideDocumentCommand", ROW("ProvideDocumentCommand", "xcmd", "provide")],
  ["DeclareDocumentCommand", ROW("DeclareDocumentCommand", "xcmd", "overwrite")],
  ["NewExpandableDocumentCommand", ROW("NewExpandableDocumentCommand", "xcmd", "ignore")],
  ["RenewExpandableDocumentCommand", ROW("RenewExpandableDocumentCommand", "xcmd", "renew")],
  ["ProvideExpandableDocumentCommand", ROW("ProvideExpandableDocumentCommand", "xcmd", "provide")],
  ["DeclareExpandableDocumentCommand", ROW("DeclareExpandableDocumentCommand", "xcmd", "overwrite")],
  ["NewDocumentEnvironment", ROW("NewDocumentEnvironment", "xenv", "ignore")],
  ["RenewDocumentEnvironment", ROW("RenewDocumentEnvironment", "xenv", "renew")],
  ["ProvideDocumentEnvironment", ROW("ProvideDocumentEnvironment", "xenv", "provide")],
  ["DeclareDocumentEnvironment", ROW("DeclareDocumentEnvironment", "xenv", "overwrite")],
  ["let", ROW("let", "let", "overwrite")],
  ["NewCommandCopy", ROW("NewCommandCopy", "copy", "ignore")],           // D4: the \let shape
  ["RenewCommandCopy", ROW("RenewCommandCopy", "copy", "renew")],
  ["DeclareCommandCopy", ROW("DeclareCommandCopy", "copy", "overwrite")],
  ["NewEnvironmentCopy", ROW("NewEnvironmentCopy", "envcopy", "ignore")],
  ["RenewEnvironmentCopy", ROW("RenewEnvironmentCopy", "envcopy", "renew")],
  ["DeclareEnvironmentCopy", ROW("DeclareEnvironmentCopy", "envcopy", "overwrite")],
  ["DeclarePairedDelimiter", ROW("DeclarePairedDelimiter", "paired", "ignore")],   // mathtools, 259 uses
  // Decision 6: opaque rows. Their own arguments are a Slot list so the walk
  // steps over the whole statement and never walks into a title or a body.
  ["newtheorem", ROW("newtheorem", "opaque", "ignore", { star: true, slots: ["m", "o", "m", "o"] })],
  ["newcounter", ROW("newcounter", "opaque", "ignore", { slots: ["m", "o"] })],
  ["newlength", ROW("newlength", "opaque", "ignore", { slots: ["m"] })],
  ["newsavebox", ROW("newsavebox", "opaque", "ignore", { slots: ["m"] })],
  ["futurelet", ROW("futurelet", "opaque", "overwrite", { slots: ["m", "m", "m"] })],
  ["DeclarePairedDelimiterX", ROW("DeclarePairedDelimiterX", "opaque", "ignore", { slots: ["m", "o", "m", "m", "m"] })],
]);

// Prefixes TeX allows before \def and \let. Pandoc knows only \global
// (Macro.hs checkGlobal); \long \protected \outer are unknown control words
// to it. What follows them is NOT uniformly kept: after \outer the definition
// is still registered; after a bare \long it is SILENTLY LOST — the measured
// reason v2/transforms/long-prefix.mjs exists; \global\long is rejected
// outright (E6); \protected was not separately measured. (HANDOFF §9i item 9,
// §9j item 12; comment corrected 2026-09-16 under decision 4c.) The set below
// is behaviour and is unchanged: v2 reads past all four, so the reader sees
// the definition whether or not Pandoc will.
export const PREFIXES = new Set(["global", "long", "protected", "outer"]);

// ---- small shared pieces --------------------------------------------

const isOther = (t, ch) => !!t && t.kind === "Other" && t.text === ch;
const isCS = (t) => !!t && (t.kind === "ControlWord" || t.kind === "ControlSymbol");
const isWord = (t, name) => !!t && t.kind === "ControlWord" && t.name === name;
const csName = (t) => t.kind === "ControlWord" ? t.name : t.text.slice(1);

// Text between a group's braces, exactly as written.
export function groupText(tokens, g) {
  let s = "";
  for (let k = g.open + 1; k < g.close; k++) s += tokens[k].text;
  return s;
}

// A Finding (§5.4) on the attention channel. The walk adds `file`.
function finding(rule, level, tokens, open, close, message, detail) {
  return { rule, channel: "attention", level, kind: "literal", file: null,
           span: { start: tokens[open].start, end: tokens[Math.min(close, tokens.length - 1)].end },
           message, detail: detail || {} };
}

// Slot constructors (§5.2).
const mandatory = () => ({ type: "mandatory" });
const optional = (open, close) => ({ type: "optional", open: open === undefined ? "[" : open, close: close === undefined ? "]" : close });   // null = no closer (embellishment)
const star = () => ({ type: "star" });
const tokenSlot = (char) => ({ type: "token", char });
const delimited = (terminator) => ({ type: "delimited", terminator });
const literal = (terminator) => ({ type: "literal", terminator });

// The Definition record (§5.2) plus `form`. origin.file is stamped by the walk.
function record(tokens, open, close, fields) {
  return Object.assign({ name: null, kind: "macro", params: [], body: null, defaultOf: {},
    global: false, long: false, source: "parsed", origin: { file: null, start: tokens[open].start, end: tokens[close].end },
    viaOption: null, aliasOf: null, form: null }, fields);
}

// Skip Space and Comment tokens only (never a line break). Used after a
// defining command, where TeX's reader has already dropped the space.
function skipBlanks(tokens, i) {
  while (i < tokens.length && (tokens[i].kind === "Space" || tokens[i].kind === "Comment")) i++;
  return i;
}

// A command name written bare (\foo) or, where `allowBraced`, braced ({\foo}):
// Pandoc's newcommand accepts both. Returns { name, token, open, close,
// error } — `error` is the finding rule when the name cannot be read; close
// still points at the last token of the name so a caller can step past it.
// `\csname ... \endcsname` is a run-time name: unreadable, but its extent is.
function readCsName(tokens, i, allowBraced) {
  i = skipSpaces(tokens, i);
  const t = tokens[i];
  if (!t) return { name: null, token: null, open: Math.max(0, tokens.length - 1), close: Math.max(0, tokens.length - 1), error: "definition/name-missing" };
  if (isWord(t, "csname")) {
    let j = i + 1;
    while (j < tokens.length && !isWord(tokens[j], "endcsname")) j++;
    return { name: null, token: null, open: i, close: Math.min(j, tokens.length - 1), error: "definition/csname-name" };
  }
  if (isCS(t)) return { name: csName(t), token: t, open: i, close: i, error: null };
  if (allowBraced && t.kind === "BeginGroup") {
    const g = readGroup(tokens, i);
    if (!g) return { name: null, token: null, open: i, close: i, error: "definition/name-unclosed" };
    const inner = [];
    for (let k = g.open + 1; k < g.close; k++) if (tokens[k].kind !== "Space") inner.push(tokens[k]);
    if (inner.length && isWord(inner[0], "csname")) return { name: null, token: null, open: g.open, close: g.close, error: "definition/csname-name" };
    if (inner.length === 1 && isCS(inner[0])) return { name: csName(inner[0]), token: inner[0], open: g.open, close: g.close, error: null };
    return { name: null, token: null, open: g.open, close: g.close, error: "definition/name-not-single" };
  }
  return { name: null, token: null, open: i, close: i, error: "definition/name-not-a-command" };
}

const nameFinding = (tokens, nm) => finding(nm.error, "unsupported", tokens, nm.open, nm.close,
  nm.error === "definition/csname-name" ? "The command's name is built at run time with \\csname, so it cannot be known from the file."
  : nm.error === "definition/name-not-single" ? "The braces hold more than one token, so this is not the name of one command."
  : "A command name was expected here and none was found.", { error: nm.error });

// ---- \def, \gdef, \edef, \xdef: the parameter text (KaTeX's parser) -----
// Text before #1 is a literal slot; #n opens slot n; any other token ends
// the current slot (delimited); a Comment and the Newline after it are
// skipped; the body is the first {...}. Findings, each raised once:
//   definition/whitespace-delimiter  a space or line break ends a slot (TeX
//                                    yes, Pandoc's argspecPattern no — B3)
//   definition/cs-delimiter          a \command ends a slot (Pandoc destroys
//                                    the definition — A14 B1 B2)
//   definition/hash-brace            #{ — the last slot ends at the body's {  (B6)
//   definition/param-order           #2 before #1 → def null
//   definition/body-missing          no {...} before the end or a blank line
function readDef(tokens, i, row, prefix) {
  const findings = prefix.findings;
  const nm = readCsName(tokens, i + 1, false);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  let bad = nm.error, j = nm.close + 1, bodyAt = -1, cur = null, lit = [], expected = 1, litHash = false;
  const params = [], raised = new Set();
  const raise = (rule, level, at, message) => {
    if (raised.has(rule)) return;
    raised.add(rule); findings.push(finding(rule, level, tokens, at, at, message, { token: tokens[at].text }));
  };
  const closeSlot = () => {
    if (cur) { params.push(Object.assign(cur.terminator.length ? delimited(cur.terminator) : mandatory(), cur.hashBrace ? { hashBrace: true } : {})); cur = null; }
    else if (lit.length) { params.push(Object.assign(literal(lit), litHash ? { hashBrace: true } : {})); lit = []; }
  };
  const addDelim = (t) => { if (cur) cur.terminator.push(t); else lit.push(t); };
  while (j < tokens.length) {
    const t = tokens[j];
    if (t.kind === "BeginGroup") { bodyAt = j; break; }
    if (t.kind === "Newline" && t.parbreak) break;                       // a blank line: refuse, never run on
    if (t.kind === "Parameter") {
      const n = tokens[j + 1];
      if (n && n.kind === "BeginGroup") {                                  // #{  (B6)
        raise("definition/hash-brace", "unsupported", j, "`#{` makes the last argument end at the body's opening brace; Pandoc cannot read this parameter text.");
        addDelim(n); if (cur) cur.hashBrace = true; else litHash = true; bodyAt = j + 1; break;
      }
      if (n && n.kind === "Other" && n.text >= "1" && n.text <= "9") {
        if (n.text !== String(expected)) { raise("definition/param-order", "author-error", j, "Parameters must be numbered #1, #2, ... in order; here #" + n.text + " comes where #" + expected + " was expected."); bad = bad || "definition/param-order"; }
        closeSlot(); cur = { terminator: [] }; expected++; j += 2; continue;
      }
      raise("definition/param-malformed", "author-error", j, "A # in the parameter text must be followed by a digit or by the body's opening brace.");
      bad = bad || "definition/param-malformed"; j++; continue;
    }
    if (t.kind === "Comment") { j++; if (tokens[j] && tokens[j].kind === "Newline") j++; continue; }
    if (t.kind === "Space" && t.absorbed) { j++; continue; }             // the space TeX drops after a command name
    if (t.kind === "Space" || t.kind === "Newline") { raise("definition/whitespace-delimiter", "unsupported", j, "A space or line break here ends an argument in TeX; Pandoc cannot read a definition delimited by whitespace."); addDelim(t); j++; continue; }
    if (isCS(t)) { raise("definition/cs-delimiter", "unsupported", j, "The command " + t.text + " ends an argument here; Pandoc destroys a definition whose argument ends at a command."); addDelim(t); j++; continue; }
    if (t.kind === "EndGroup") { raise("definition/param-malformed", "author-error", j, "A closing brace appears before the definition's body."); bad = bad || "definition/param-malformed"; break; }
    addDelim(t); j++;
  }
  if (bodyAt < 0) {
    const at = Math.max(i, Math.min(j, tokens.length) - 1);
    findings.push(finding("definition/body-missing", "author-error", tokens, i, at, "No {...} body follows the parameter text before the end of the file or a blank line.", { name: nm.name }));
    return { def: null, open: prefix.open, close: at, findings };
  }
  const g = readGroup(tokens, bodyAt);
  if (!g) {
    findings.push(finding("definition/body-unclosed", "author-error", tokens, i, bodyAt, "The definition's body opens a brace that is never closed.", { name: nm.name }));
    return { def: null, open: prefix.open, close: bodyAt, findings };
  }
  closeSlot();
  if (bad) return { def: null, open: prefix.open, close: g.close, findings };
  const def = record(tokens, prefix.open, g.close, { name: nm.name, kind: "macro", params,
    body: tokens.slice(g.open + 1, g.close), global: row.global || prefix.global, long: prefix.long, form: row.form });
  return { def, open: prefix.open, close: g.close, findings };
}

// ---- \newcommand family: [*] name [n] [default] {body} ------------------
// Pandoc Macro.hs newcommand 157–190: the name braced or bare; a star; an
// optional argument count; an optional default that makes slot 1 optional.
function readArgCount(tokens, j, findings) {
  const b = readBracket(tokens, j);
  if (!b) return { argc: 0, dflt: null, next: j, bad: null };
  const digits = groupText(tokens, b).trim();
  let argc = 0, bad = null;
  if (digits.length === 0 || [...digits].some((c) => c < "0" || c > "9")) {
    bad = "definition/arg-count-not-digit";
    findings.push(finding(bad, "author-error", tokens, b.open, b.close, "The argument count in [...] must be a number.", { text: digits }));
  } else argc = Number(digits);
  let next = b.close + 1, dflt = null;
  const d = readBracket(tokens, next);
  if (d) { dflt = tokens.slice(d.open + 1, d.close); next = d.close + 1; }
  return { argc, dflt, next, bad };
}

// Slots from a LaTeX [n][default] pair: an optional first slot when a default
// is written, then mandatory slots up to n.
function latexParams(argc, dflt) {
  const params = [], defaultOf = {};
  if (dflt) { params.push(optional()); defaultOf[0] = dflt; }
  for (let k = params.length; k < argc; k++) params.push(mandatory());
  return { params, defaultOf };
}

const missingBody = (tokens, i, at, what, findings, open) => {
  findings.push(finding("definition/body-missing", "author-error", tokens, i, at, "No {...} " + what + " follows where one was expected.", {}));
  return { def: null, open, close: at, findings };
};

function readCmd(tokens, i, row) {
  const findings = [];
  let j = skipSpaces(tokens, i + 1), starred = false;
  if (isOther(tokens[j], "*")) { starred = true; j++; }
  const nm = readCsName(tokens, j, true);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  const ac = readArgCount(tokens, nm.close + 1, findings);
  const g = readGroup(tokens, ac.next);
  if (!g) return missingBody(tokens, i, Math.min(ac.next, tokens.length - 1), "body", findings, i);
  if (nm.error || ac.bad) return { def: null, open: i, close: g.close, findings };
  const { params, defaultOf } = latexParams(ac.argc, ac.dflt);
  const def = record(tokens, i, g.close, { name: nm.name, kind: "macro", params, defaultOf,
    body: tokens.slice(g.open + 1, g.close), long: !starred, form: row.form });
  return { def, open: i, close: g.close, findings };
}

// ---- \newenvironment family: {name} [n] [default] {begin} {end} ----------
function readEnv(tokens, i, row) {
  const findings = [];
  const ng = readGroup(tokens, i + 1);
  if (!ng) return missingBody(tokens, i, Math.min(i + 1, tokens.length - 1), "environment name", findings, i);
  const ac = readArgCount(tokens, ng.close + 1, findings);
  const g1 = readGroup(tokens, ac.next);
  if (!g1) return missingBody(tokens, i, Math.min(ac.next, tokens.length - 1), "begin body", findings, i);
  const g2 = readGroup(tokens, g1.close + 1);
  if (!g2) return missingBody(tokens, i, g1.close, "end body", findings, i);
  if (ac.bad) return { def: null, open: i, close: g2.close, findings };
  const { params, defaultOf } = latexParams(ac.argc, ac.dflt);
  const def = record(tokens, i, g2.close, { name: groupText(tokens, ng), kind: "environment", params, defaultOf,
    body: { beginBody: tokens.slice(g1.open + 1, g1.close), endBody: tokens.slice(g2.open + 1, g2.close) }, long: true, form: row.form });
  return { def, open: i, close: g2.close, findings };
}

// ---- xparse signatures, read from tokens (decision 5) --------------------
// v1's alphabet: m o s v b O t d r R D e E, prefixes + and !, processors >{..}.
// A letter outside it is definition/xparse-unknown-letter and def: null.
// Defaults stay as the file's own tokens (positions intact).
function readSignature(tokens, g, findings) {
  const params = [], defaultOf = {};
  let long = false, bad = null, j = g.open + 1;
  const ch = (k) => (k < g.close && tokens[k].kind === "Other") ? tokens[k].text : null;
  const grp = (k) => { const gg = readGroup(tokens, k); return gg && gg.close < g.close ? gg : null; };
  const inner = (gg) => tokens.slice(gg.open + 1, gg.close);
  const fail = (rule, at, message) => { bad = bad || rule; findings.push(finding(rule, "unsupported", tokens, at, at, message, { letter: tokens[at].text })); };
  const embellish = (gg, defaults) => {           // e{^_} / E{^_}{{d1}{d2}}: one optional slot per introducer
    let k = defaults ? defaults.open + 1 : -1;
    for (let m = gg.open + 1; m < gg.close; m++) {
      if (tokens[m].kind === "Space") continue;
      if (defaults) { const dd = readGroup(tokens, k); if (dd && dd.close < defaults.close) { defaultOf[params.length] = inner(dd); k = dd.close + 1; } }
      params.push(Object.assign(optional(tokens[m].text, null), { embellishment: true }));
    }
  };
  while (j < g.close) {
    const t = tokens[j];
    if (t.kind === "Space" || t.kind === "Newline" || t.kind === "Comment") { j++; continue; }
    if (isOther(t, "+")) { long = true; j++; continue; }
    if (isOther(t, "!")) { j++; continue; }
    if (isOther(t, ">")) { const gg = grp(j + 1); j = gg ? gg.close + 1 : j + 1; continue; }   // argument processor: skipped
    const c = t.kind === "Other" ? t.text : null;
    let gg, dg, o, cl;
    switch (c) {
      case "m": params.push(mandatory()); j++; break;
      case "b": params.push(Object.assign(mandatory(), { body: true })); j++; break;
      case "v": params.push(Object.assign(mandatory(), { verbatim: true })); j++; break;
      case "o": params.push(optional()); j++; break;
      case "s": params.push(star()); j++; break;
      case "t": cl = ch(j + 1); if (cl === null) { fail("definition/xparse-delimiter", j, "t needs one character after it."); j++; break; }
                params.push(tokenSlot(cl)); j += 2; break;
      case "O": gg = grp(j + 1); if (!gg) { fail("definition/xparse-default-missing", j, "O needs a {default} after it."); j++; break; }
                defaultOf[params.length] = inner(gg); params.push(optional()); j = gg.close + 1; break;
      case "d": case "r": o = ch(j + 1); cl = ch(j + 2);
                if (o === null || cl === null) { fail("definition/xparse-delimiter", j, c + " needs two delimiter characters after it."); j++; break; }
                params.push(c === "d" ? optional(o, cl) : Object.assign(mandatory(), { open: o, close: cl })); j += 3; break;
      case "D": case "R": o = ch(j + 1); cl = ch(j + 2); gg = (o !== null && cl !== null) ? grp(j + 3) : null;
                if (!gg) { fail("definition/xparse-default-missing", j, c + " needs two delimiter characters and a {default}."); j++; break; }
                defaultOf[params.length] = inner(gg);
                params.push(c === "D" ? optional(o, cl) : Object.assign(mandatory(), { open: o, close: cl })); j = gg.close + 1; break;
      case "e": gg = grp(j + 1); if (!gg) { fail("definition/xparse-default-missing", j, "e needs a {list} of introducers."); j++; break; }
                embellish(gg, null); j = gg.close + 1; break;
      case "E": gg = grp(j + 1); dg = gg ? grp(gg.close + 1) : null;
                if (!dg) { fail("definition/xparse-default-missing", j, "E needs a {list} and a {defaults} group."); j++; break; }
                embellish(gg, dg); j = dg.close + 1; break;
      default: fail("definition/xparse-unknown-letter", j, "The signature letter " + t.text + " is not one this tool reads (m o s v b O t d r R D e E)."); j++;
    }
  }
  return { params, defaultOf, long, bad };
}

// \NewDocumentCommand name {signature} {body}   (name braced or bare)
function readXCmd(tokens, i, row) {
  const findings = [];
  const nm = readCsName(tokens, i + 1, true);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  const sg = readGroup(tokens, nm.close + 1);
  if (!sg) return missingBody(tokens, i, nm.close, "signature", findings, i);
  const g = readGroup(tokens, sg.close + 1);
  if (!g) return missingBody(tokens, i, sg.close, "body", findings, i);
  const sig = readSignature(tokens, sg, findings);
  if (nm.error || sig.bad) return { def: null, open: i, close: g.close, findings };
  const def = record(tokens, i, g.close, { name: nm.name, kind: "macro", params: sig.params, defaultOf: sig.defaultOf,
    body: tokens.slice(g.open + 1, g.close), long: sig.long, form: row.form, signature: groupText(tokens, sg) });
  return { def, open: i, close: g.close, findings };
}

// \NewDocumentEnvironment {name} {signature} {begin} {end}
function readXEnv(tokens, i, row) {
  const findings = [];
  const ng = readGroup(tokens, i + 1);
  if (!ng) return missingBody(tokens, i, Math.min(i + 1, tokens.length - 1), "environment name", findings, i);
  const sg = readGroup(tokens, ng.close + 1);
  if (!sg) return missingBody(tokens, i, ng.close, "signature", findings, i);
  const g1 = readGroup(tokens, sg.close + 1);
  if (!g1) return missingBody(tokens, i, sg.close, "begin body", findings, i);
  const g2 = readGroup(tokens, g1.close + 1);
  if (!g2) return missingBody(tokens, i, g1.close, "end body", findings, i);
  const sig = readSignature(tokens, sg, findings);
  if (sig.bad) return { def: null, open: i, close: g2.close, findings };
  const def = record(tokens, i, g2.close, { name: groupText(tokens, ng), kind: "environment", params: sig.params, defaultOf: sig.defaultOf,
    body: { beginBody: tokens.slice(g1.open + 1, g1.close), endBody: tokens.slice(g2.open + 1, g2.close) }, long: sig.long, form: row.form, signature: groupText(tokens, sg) });
  return { def, open: i, close: g2.close, findings };
}

// ---- \let name [=] [one space] token  (TeX; Pandoc letmacro 61–78) ------
// The record says only what the file says: kind alias, aliasOf = the target's
// name (null when the target is not a command, `\let\a=0`), body = the one
// target token. The store decides copy-or-freeze (decision 4): only it knows
// whether the target is defined at that point.
function readLet(tokens, i, row, prefix) {
  const findings = prefix.findings;
  const nm = readCsName(tokens, i + 1, false);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  let j = skipBlanks(tokens, nm.close + 1);
  if (isOther(tokens[j], "=")) { j++; if (tokens[j] && tokens[j].kind === "Space") j++; }
  const target = tokens[j];
  if (!target || target.kind === "Newline") {
    findings.push(finding("definition/let-target-missing", "author-error", tokens, i, Math.min(j, tokens.length - 1), "\\let needs a token to copy the meaning of.", {}));
    return { def: null, open: prefix.open, close: Math.min(j, tokens.length - 1), findings };
  }
  if (nm.error) return { def: null, open: prefix.open, close: j, findings };
  const def = record(tokens, prefix.open, j, { name: nm.name, kind: "alias", aliasOf: isCS(target) ? csName(target) : null,
    body: [target], global: prefix.global, form: row.form });
  return { def, open: prefix.open, close: j, findings };
}

// \NewCommandCopy{\a}{\b} or \NewCommandCopy\a\b — the \let shape (D4).
function readCopy(tokens, i, row) {
  const findings = [];
  const nm = readCsName(tokens, i + 1, true);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  const tg = readCsName(tokens, nm.close + 1, true);
  if (tg.error) findings.push(nameFinding(tokens, tg));
  if (nm.error || tg.error) return { def: null, open: i, close: tg.close, findings };
  const def = record(tokens, i, tg.close, { name: nm.name, kind: "alias", aliasOf: tg.name, body: [tg.token], form: row.form });
  return { def, open: i, close: tg.close, findings };
}

// \NewEnvironmentCopy{a}{b}: an alias by environment name. Commands and
// environments share one table, as TeX's \a / \enda pair does.
function readEnvCopy(tokens, i, row) {
  const findings = [];
  const g1 = readGroup(tokens, i + 1);
  if (!g1) return missingBody(tokens, i, Math.min(i + 1, tokens.length - 1), "environment name", findings, i);
  const g2 = readGroup(tokens, g1.close + 1);
  if (!g2) return missingBody(tokens, i, g1.close, "environment name to copy", findings, i);
  const def = record(tokens, i, g2.close, { name: groupText(tokens, g1), kind: "alias", aliasOf: groupText(tokens, g2), body: null, form: row.form });
  return { def, open: i, close: g2.close, findings };
}

// \DeclarePairedDelimiter\abs{\lvert}{\rvert} (mathtools; Pandoc drops it,
// C4): one mandatory slot; body = both delimiter groups as written, so a
// later stage can synthesise the definition MathJax needs.
function readPaired(tokens, i, row) {
  const findings = [];
  const nm = readCsName(tokens, i + 1, true);
  if (nm.error) findings.push(nameFinding(tokens, nm));
  const g1 = readGroup(tokens, nm.close + 1);
  if (!g1) return missingBody(tokens, i, nm.close, "left delimiter", findings, i);
  const g2 = readGroup(tokens, g1.close + 1);
  if (!g2) return missingBody(tokens, i, g1.close, "right delimiter", findings, i);
  if (nm.error) return { def: null, open: i, close: g2.close, findings };
  const def = record(tokens, i, g2.close, { name: nm.name, kind: "macro", params: [mandatory()],
    body: tokens.slice(g1.open, g2.close + 1), form: row.form });
  return { def, open: i, close: g2.close, findings };
}

// ---- readArguments(tokens, i, params) — the other half of the Slot contract
// Reads a call's arguments starting at i by the Slot list. Returns
// { args, next, findings } or null when a mandatory, literal or delimited
// slot cannot be read (no guess). Each arg is { slot, open, close, start,
// end, ... } or null for an absent optional; star/token args carry `present`.
// Rules (decision 3, probes A1–A11, A24–A27, B12–B14, B20):
//   before a mandatory slot   skipSpaces (blank lines included) + a finding
//                             definition/blank-line-crossed when one was
//   before an optional slot   skipSp (stops at a blank line)
//   unbraced mandatory        exactly ONE token (TeX = LaTeXML = Pandoc)
//   delimited                 the terminator sequence at brace depth 0; the
//                             argument may be empty; `braced` when it is one
//                             {...} group (TeX strips that pair)
//   literal                   the text must appear exactly, no skipping
export function readArguments(tokens, i, params) {
  const args = [], findings = [];
  let j = i, idx = 0;
  const span = (open, close, extra) => Object.assign({ slot: idx, open, close,
    start: tokens[open].start, end: close >= open ? tokens[close].end : tokens[open].start }, extra || {});
  const crossed = (a, b) => { for (let k = a; k < b; k++) if (tokens[k].kind === "Newline" && tokens[k].parbreak) return true; return false; };
  const scanTo = (from, closeText) => {                  // Other closeText at brace depth 0, or -1
    let depth = 0;
    for (let k = from; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.kind === "BeginGroup") depth++;
      else if (t.kind === "EndGroup") { if (depth > 0) depth--; }
      else if (depth === 0 && t.kind === "Other" && t.text === closeText) return k;
    }
    return -1;
  };
  const matchesAt = (k, term) => { for (let m = 0; m < term.length; m++) { const t = tokens[k + m]; if (!t || t.kind !== term[m].kind || t.text !== term[m].text) return false; } return true; };
  for (idx = 0; idx < params.length; idx++) {
    const s = params[idx];
    if (s.type === "mandatory" && s.open) {                       // xparse r/R: required, delimited by characters
      const k = skipSpaces(tokens, j);
      if (!isOther(tokens[k], s.open)) { args.push(null); findings.push(finding("definition/required-delimited-missing", "author-error", tokens, Math.min(j, tokens.length - 1), Math.min(j, tokens.length - 1), "A required " + s.open + "..." + s.close + " argument is missing here.", { slot: idx })); continue; }
      const c = scanTo(k + 1, s.close); if (c < 0) return null;
      args.push(span(k, c, { braced: false })); j = c + 1; continue;
    }
    if (s.type === "mandatory") {
      const k = skipSpaces(tokens, j);
      if (k >= tokens.length || tokens[k].kind === "EndGroup") return null;
      if (crossed(j, k)) findings.push(finding("definition/blank-line-crossed", "author-error", tokens, j, k, "A blank line separates the command from this argument; TeX would read a paragraph break here instead.", { slot: idx }));
      if (tokens[k].kind === "BeginGroup") { const g = readGroup(tokens, k); if (!g) return null; args.push(span(g.open, g.close, { braced: true })); j = g.close + 1; }
      else { args.push(span(k, k, { braced: false })); j = k + 1; }
      continue;
    }
    if (s.type === "optional") {
      const k = skipSp(tokens, j);
      if (s.close === null) {                                      // embellishment: introducer, then one token or group
        if (!isOther(tokens[k], s.open) || k + 1 >= tokens.length) { args.push(null); continue; }
        const g = tokens[k + 1].kind === "BeginGroup" ? readGroup(tokens, k + 1) : null;
        const end = g ? g.close : k + 1;
        args.push(span(k, end, { braced: !!g })); j = end + 1; continue;
      }
      if (s.open === "[" && s.close === "]") { const b = readBracket(tokens, j); if (b) { args.push(span(b.open, b.close, { braced: false })); j = b.close + 1; } else args.push(null); continue; }
      if (isOther(tokens[k], s.open)) { const c = scanTo(k + 1, s.close); if (c < 0) return null; args.push(span(k, c, { braced: false })); j = c + 1; }
      else args.push(null);
      continue;
    }
    if (s.type === "star") {
      const k = skipSp(tokens, j);
      if (isOther(tokens[k], "*")) { args.push(span(k, k, { present: true })); j = k + 1; } else args.push({ slot: idx, present: false });
      continue;
    }
    if (s.type === "token") {
      const k = skipSp(tokens, j);
      const t = tokens[k];
      if (t && t.kind !== "BeginGroup" && t.kind !== "EndGroup" && t.text === s.char) { args.push(span(k, k, { present: true })); j = k + 1; }
      else args.push({ slot: idx, present: false });
      continue;
    }
    if (s.type === "literal") {
      if (tokens[j] && tokens[j].kind === "Space" && tokens[j].absorbed) j++;   // the space TeX drops after the command name
      if (!matchesAt(j, s.terminator)) return null;
      args.push(span(j, j + s.terminator.length - 1, { literal: true })); j += s.terminator.length - (s.hashBrace ? 1 : 0); continue;
    }
    if (s.type === "delimited") {
      if (tokens[j] && tokens[j].kind === "Space" && tokens[j].absorbed) j++;
      let depth = 0, found = -1;
      for (let k = j; k < tokens.length && found < 0; k++) {
        const t = tokens[k];
        if (depth === 0 && matchesAt(k, s.terminator)) { found = k; break; }   // checked first: a terminator may itself be { (#{)
        if (t.kind === "BeginGroup") { depth++; continue; }
        if (t.kind === "EndGroup") { if (depth === 0) return null; depth--; continue; }
      }
      if (found < 0) return null;
      const g = found > j && tokens[j].kind === "BeginGroup" ? readGroup(tokens, j) : null;
      args.push(span(j, found - 1, { braced: !!g && g.close === found - 1, empty: found === j }));
      j = s.hashBrace ? found : found + s.terminator.length; continue;          // #{ leaves the { in place (TeX)
    }
    return null;                                                   // an unknown slot type: refuse
  }
  return { args, next: j, findings };
}

// ---- the six opaque rows (decision 6) -----------------------------------
// Name, form, origin — nothing else. The row's slots are read with
// readArguments so the statement's extent is exact and nothing inside it is
// walked. The first argument's text (braces and backslash stripped) is the name.
function readOpaque(tokens, i, row) {
  const findings = [];
  let j = i + 1;
  if (row.star) { const k = skipSpaces(tokens, j); if (isOther(tokens[k], "*")) j = k + 1; }
  const slots = row.slots.map((c) => (c === "m" ? mandatory() : optional()));
  const r = readArguments(tokens, j, slots);
  if (!r || !r.args[0]) {
    const at = Math.min(j, tokens.length - 1);
    findings.push(finding("definition/arguments-missing", "author-error", tokens, i, at, "\\" + row.form + " is missing an argument it needs.", {}));
    return { def: null, open: i, close: at, findings };
  }
  for (const f of r.findings) findings.push(f);
  const a = r.args[0];
  let name = "";
  for (let k = a.braced ? a.open + 1 : a.open; k <= (a.braced ? a.close - 1 : a.close); k++) if (tokens[k].kind !== "Space") name += tokens[k].text;
  if (name.startsWith("\\")) name = name.slice(1);
  const close = r.next - 1;
  const def = record(tokens, i, close, { name, kind: "opaque", form: row.form });
  return { def, open: i, close, findings };
}

// ---- flags: \newif, the ifthen booleans, the etoolbox toggles ----------
// { flag: { family, name, action, value, provide, form }, open, close, findings }
// or null when tokens[i] is not a flag statement. \newif\ifFoo declares flag
// "Foo" (so the walk can recognise \Footrue / \Foofalse through the store).
export const FLAG_FORMS = new Map([
  ["newif", { family: "newif", action: "declare" }],
  ["newboolean", { family: "boolean", action: "declare" }], ["provideboolean", { family: "boolean", action: "declare", provide: true }],
  ["setboolean", { family: "boolean", action: "set" }],
  ["newtoggle", { family: "toggle", action: "declare" }], ["providetoggle", { family: "toggle", action: "declare", provide: true }],
  ["toggletrue", { family: "toggle", action: "set", value: true }], ["togglefalse", { family: "toggle", action: "set", value: false }],
  ["settoggle", { family: "toggle", action: "set" }],
]);
export function readFlagStatement(tokens, i) {
  const t = tokens[i];
  if (!t || t.kind !== "ControlWord") return null;
  const row = FLAG_FORMS.get(t.name);
  if (!row) return null;
  const findings = [], last = tokens.length - 1;
  const refuse = (rule, close, message) => { findings.push(finding(rule, "author-error", tokens, i, close, message, {})); return { flag: null, open: i, close, findings }; };
  if (row.family === "newif") {
    const k = skipBlanks(tokens, i + 1), n = tokens[k];
    if (!isCS(n)) return refuse("definition/newif-target", Math.min(k, last), "\\newif must be followed by a command of the form \\ifname.");
    const nm = csName(n);
    if (nm.length < 3 || nm.slice(0, 2) !== "if") return refuse("definition/newif-name", k, "\\newif's command must start with \"if\" (\\ifname); " + n.text + " does not.");
    return { flag: { family: "newif", name: nm.slice(2), action: "declare", value: false, provide: false, form: "newif" }, open: i, close: k, findings };
  }
  const g1 = readGroup(tokens, i + 1);
  if (!g1) return refuse("definition/flag-name-missing", Math.min(i + 1, last), "\\" + t.name + " needs a {name}.");
  let close = g1.close, value = row.value ?? false;
  if (row.action === "set" && row.value === undefined) {
    const g2 = readGroup(tokens, g1.close + 1);
    if (!g2) return refuse("definition/flag-value-missing", g1.close, "\\" + t.name + " needs a {true} or {false} after the name.");
    const raw = groupText(tokens, g2).trim();
    // The two flag families differ here, and each is followed as written.
    // ifthen's \setboolean applies \lowercase to the value before comparing,
    // so {True} and {FALSE} are legal and mean what they say. etoolbox's
    // \settoggle uses \ifstrequal and is case-SENSITIVE: it raises "Invalid
    // boolean value 'True'" and leaves the toggle at its default, which is
    // what refusing here already does. Measured with pdflatex 2026-09-15,
    // _work/_s4_bool.tex: bA={True} TRUE, bB={FALSE} FALSE, tA={True} FALSE
    // with an etoolbox error. Found by gate R: APMTH 121's pset1_F25_soln
    // writes \setboolean{solutionCopy}{True}, and reading that as false is
    // reading a solutions copy as a student copy.
    const v = row.family === "boolean" ? raw.toLowerCase() : raw;
    if (v !== "true" && v !== "false") return refuse("definition/flag-value", g2.close, "\\" + t.name + "'s value must be true or false, not \"" + raw + "\".");
    value = v === "true"; close = g2.close;
  }
  return { flag: { family: row.family, name: groupText(tokens, g1).trim(), action: row.action, value, provide: !!row.provide, form: t.name }, open: i, close, findings };
}

// ---- the entry point ----------------------------------------------------
// readDefinition(tokens, i) → null when no defining statement starts at i,
// else { def, open, close, findings }: def is a Definition record or null
// (recognised but unusable — the findings say why); open..close is the
// statement's whole token span, prefixes included, so a walk steps over it.
export function isDefinitionForm(name) { return FORMS.has(name); }

export function readDefinition(tokens, i) {
  let t = tokens[i];
  if (!t || t.kind !== "ControlWord") return null;
  const findings = [], prefix = { open: i, global: false, long: false, findings, seen: [] };
  let j = i;
  while (tokens[j] && tokens[j].kind === "ControlWord" && PREFIXES.has(tokens[j].name)) {
    prefix.seen.push(tokens[j].name);
    if (tokens[j].name === "global") prefix.global = true;
    if (tokens[j].name === "long") prefix.long = true;
    j = skipBlanks(tokens, j + 1);
  }
  t = tokens[j];
  if (!t || t.kind !== "ControlWord") return null;
  const row = FORMS.get(t.name);
  if (!row) return null;
  if (prefix.seen.length && row.read !== "def" && row.read !== "let") return null;   // \global\newcommand is not TeX; the walk reaches the form on its own
  const g = prefix.seen.indexOf("global");
  if (g >= 0 && g !== prefix.seen.length - 1)                                          // E6: Pandoc's checkGlobal wants \def right after \global
    findings.push(finding("definition/global-prefix-rejected", "unsupported", tokens, i, j, "Pandoc accepts \\global only directly before \\def, \\let, \\edef or \\newif; \\global\\" + prefix.seen[g + 1] + " makes it reject the document.", { prefixes: prefix.seen.slice() }));
  switch (row.read) {
    case "def": return readDef(tokens, j, row, prefix);
    case "let": return readLet(tokens, j, row, prefix);
    case "cmd": return readCmd(tokens, j, row);
    case "env": return readEnv(tokens, j, row);
    case "xcmd": return readXCmd(tokens, j, row);
    case "xenv": return readXEnv(tokens, j, row);
    case "copy": return readCopy(tokens, j, row);
    case "envcopy": return readEnvCopy(tokens, j, row);
    case "paired": return readPaired(tokens, j, row);
    case "opaque": return readOpaque(tokens, j, row);
  }
  return null;
}
