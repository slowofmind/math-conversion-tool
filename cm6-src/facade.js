// facade.js — entry point for the CM6 editor bundle.
// Built by build-cm6.ps1 into ../codemirror/cm6-editor.js (ES module).
// index.html imports ONLY the built bundle and calls this API; it never
// touches CM6 internals. All Pandoc-specific intelligence (lint rules,
// completions, hints) lives OUTSIDE this bundle and is passed in as data.
// Design doc: ../CM6-FACADE-DESIGN.md
// Lines/columns are 1-based throughout this API (matches Pandoc warnings).

import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightActiveLine, scrollPastEnd, Decoration,
} from "@codemirror/view";
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import {
  indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching,
  foldGutter, foldKeymap, indentUnit, LanguageSupport,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippet,
} from "@codemirror/autocomplete";
import { setDiagnostics as cmSetDiagnostics, lintGutter, lintKeymap } from "@codemirror/lint";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { latexLanguage } from "codemirror-lang-latex";
import { classHighlighter, tagHighlighter, tags as lzTags } from "@lezer/highlight";

// classHighlighter has no dedicated classes for these two tags (they only
// match via parents: processingInstruction→tok-meta, bracket→tok-punctuation).
// This supplementary highlighter emits precise classes so index.html CSS can
// target math delimiters and braces without also hitting verbatim content.
const extraTokenClasses = tagHighlighter([
  { tag: lzTags.processingInstruction, class: "tok-processingInstruction" },
  { tag: lzTags.bracket, class: "tok-bracket" },
]);

export const CM6_BUNDLE_VERSION = "0.4.0";

// ── Language registry ──────────────────────────────────────────────
// LaTeX: Overleaf's Lezer grammar via codemirror-lang-latex (TeXlyre),
// grammar/fold/indent ONLY — their linter, tooltips, and autocomplete
// are deliberately not enabled (Pandoc-specific intelligence lives in
// index.html per the facade design rule).
function languageFor(name) {
  switch (name) {
    case "latex":    return new LanguageSupport(latexLanguage);
    case "html":     return html();
    case "markdown": return markdown();
    default:         return [];   // plain text
  }
}

// ── Full-line severity tint + generic range highlights ─────────────
// One StateField renders both: (a) per-line background classes for
// diagnostics (pandoc-error-line etc.), (b) token-keyed arbitrary
// range highlights (cleanup-tool previews, etc.).
const setLineTints = StateEffect.define();          // [{line, cls}]
const addHighlight = StateEffect.define();          // {token, ranges, cls}
const clearHighlight = StateEffect.define();        // token | null (null = all)

// ── Offset-based marks (v0.4) ──────────────────────────────────────
// The line/col highlights above cannot express a range that SPANS lines,
// because each range is anchored to one line. Offset marks can, and they
// MAP THROUGH EDITS: after a replaceRange, every other mark still points
// at the right text. That is what makes an apply-one-then-continue review
// loop possible. Kept separate from the line/col machinery so existing
// callers are untouched.
const addMarks = StateEffect.define();              // {token, ranges:[{from,to}], cls}
const clearMarks = StateEffect.define();            // token | null (null = all)

function buildDecoSet(state, tints, highlights) {
  const decos = [];
  for (const t of tints) {
    if (t.line < 1 || t.line > state.doc.lines) continue;
    const l = state.doc.line(t.line);
    decos.push(Decoration.line({ class: t.cls }).range(l.from));
  }
  for (const [, h] of highlights) {
    for (const r of h.ranges) {
      if (r.line < 1 || r.line > state.doc.lines) continue;
      const l = state.doc.line(r.line);
      const from = l.from + Math.max(0, Math.min(r.startCol - 1, l.length));
      const to = l.from + Math.max(0, Math.min(r.endCol - 1, l.length));
      if (to > from) decos.push(Decoration.mark({ class: h.cls }).range(from, to));
    }
  }
  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decos, true);
}

function makeDecoField() {
  // Per-editor state so two instances never share tints/highlights.
  let tints = [];
  const highlights = new Map();
  return StateField.define({
    create(state) { return buildDecoSet(state, tints, highlights); },
    update(value, tr) {
      let dirty = false;
      for (const e of tr.effects) {
        if (e.is(setLineTints)) { tints = e.value; dirty = true; }
        else if (e.is(addHighlight)) {
          highlights.set(e.value.token, e.value); dirty = true;
        } else if (e.is(clearHighlight)) {
          if (e.value === null) highlights.clear();
          else highlights.delete(e.value);
          dirty = true;
        }
      }
      if (dirty || tr.docChanged) return buildDecoSet(tr.state, tints, highlights);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

// Per-editor offset-mark state. Each token owns a DecorationSet; every set
// is mapped through document changes so marks follow the text they annotate
// rather than drifting. Returns the field plus a reset() for setText, which
// rebuilds the document from scratch and would otherwise leave stale marks
// pointing into a document that no longer exists.
function makeMarkField() {
  const sets = new Map();   // token -> DecorationSet

  function union() {
    const all = [];
    for (const [, s] of sets) {
      const it = s.iter();
      while (it.value) { all.push(it.value.range(it.from, it.to)); it.next(); }
    }
    all.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(all, true);
  }

  const field = StateField.define({
    create() { return Decoration.none; },
    update(value, tr) {
      let dirty = false;
      if (tr.docChanged && sets.size) {
        for (const [k, s] of sets) sets.set(k, s.map(tr.changes));
        dirty = true;
      }
      for (const e of tr.effects) {
        if (e.is(addMarks)) {
          const deco = Decoration.mark({ class: e.value.cls });
          const len = tr.state.doc.length;
          const ranges = e.value.ranges
            .map((r) => ({ from: Math.max(0, Math.min(r.from, len)),
                           to: Math.max(0, Math.min(r.to, len)) }))
            .filter((r) => r.to > r.from)
            .sort((a, b) => a.from - b.from || a.to - b.to)
            .map((r) => deco.range(r.from, r.to));
          sets.set(e.value.token, Decoration.set(ranges, true));
          dirty = true;
        } else if (e.is(clearMarks)) {
          if (e.value === null) sets.clear();
          else sets.delete(e.value);
          dirty = true;
        }
      }
      return dirty ? union() : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return { field, reset: () => sets.clear() };
}

// ── Completion adapter ─────────────────────────────────────────────
// Registered sources are plain functions living in index.html:
//   fn({line, col, prefix, lineText}) ->
//     { fromCol, options: [{label, insert, detail?, infoHTML?, type?}] } | null
// `insert` may contain snippet placeholders like ${1:env}.
function wrapSource(fn) {
  return (ctx) => {
    const l = ctx.state.doc.lineAt(ctx.pos);
    const before = l.text.slice(0, ctx.pos - l.from);
    const m = before.match(/[\\]?[A-Za-z0-9_-]*$/);
    const prefix = m ? m[0] : "";
    if (!ctx.explicit && prefix.length === 0) return null;
    const res = fn({
      line: l.number,
      col: ctx.pos - l.from + 1,
      prefix,
      lineText: l.text,
    });
    if (!res || !res.options || res.options.length === 0) return null;
    // fromCol omitted/null → default to the start of the typed prefix.
    const from = (res.fromCol == null)
      ? ctx.pos - prefix.length
      : l.from + Math.max(0, res.fromCol - 1);
    return {
      from,
      options: res.options.map((o) => ({
        label: o.label,
        detail: o.detail,
        type: o.type || "keyword",
        apply: /\$\{/.test(o.insert ?? o.label)
          ? snippet(o.insert ?? o.label)
          : (o.insert ?? o.label),
        info: o.infoHTML
          ? () => { const el = document.createElement("div");
                    el.innerHTML = o.infoHTML; return el; }
          : undefined,
      })),
    };
  };
}

// ── createEditor ───────────────────────────────────────────────────
export function createEditor(containerEl, opts = {}) {
  const langComp = new Compartment();
  const roComp = new Compartment();
  const wrapComp = new Compartment();
  const compComp = new Compartment();
  const decoField = makeDecoField();
  const marks = makeMarkField();
  const sources = [];
  // Live config — consulted whenever state is rebuilt (setText), so a
  // rebuild preserves the CURRENT language/readOnly/wrap, not creation-time.
  const cfg = {
    language: opts.language || "text",
    readOnly: !!opts.readOnly,
    lineWrap: opts.lineWrap !== false,
  };

  const theme = EditorView.theme({
    "&": { fontSize: opts.fontSize || "14px", height: "100%" },
    ".cm-scroller": {
      fontFamily: opts.fontFamily || "'Roboto Mono', monospace",
      overflow: "auto",
    },
  });

  const baseExtensions = () => [
    // Explicit basicSetup equivalent, MINUS autocompletion (that lives in
    // compComp below so setCompletionEnabled(false) truly disables it).
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
    history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentOnInput(),
    // NOTE: no {fallback:true} here — a fallback highlighter deactivates
    // itself whenever another highlighter (classHighlighter below) is
    // registered, which would kill all default colors.
    syntaxHighlighting(defaultHighlightStyle),
    // classHighlighter stamps stable .tok-* classes on every token so the
    // palette can live in index.html CSS (no rebuild to change colors).
    // Classes accumulate alongside defaultHighlightStyle's inline colors;
    // index.html only styles tags the default palette omits.
    syntaxHighlighting(classHighlighter),
    syntaxHighlighting(extraTokenClasses),
    bracketMatching(), closeBrackets(), rectangularSelection(),
    crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
      ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap,
    ]),
    lintGutter(),
    decoField,
    marks.field,
    theme,
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({ "aria-label": opts.ariaLabel || "Editor" }),
    langComp.of(languageFor(cfg.language)),
    roComp.of([
      EditorState.readOnly.of(cfg.readOnly),
      EditorView.editable.of(!cfg.readOnly),
    ]),
    wrapComp.of(cfg.lineWrap ? EditorView.lineWrapping : []),
    compComp.of(autocompletion({ override: sources.map(wrapSource) })),
    opts.scrollPastEnd ? scrollPastEnd() : [],
    opts.onCursor
      ? EditorView.updateListener.of((u) => {
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            const l = u.state.doc.lineAt(head);
            opts.onCursor(l.number, head - l.from + 1);
          }
        })
      : [],
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: opts.initialText || "", extensions: baseExtensions() }),
    parent: containerEl,
  });

  function pos(line, col) {
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const l = view.state.doc.line(n);
    return l.from + Math.max(0, Math.min((col || 1) - 1, l.length));
  }

  const handle = {
    view, // escape hatch for debugging only; index.html must not rely on it

    getText: () => view.state.doc.toString(),
    setText(text) {
      // Fresh state = content replaced AND undo history reset
      // (parity with Ace's setValue(text, -1) usage).
      marks.reset();   // old offsets mean nothing in a new document
      view.setState(EditorState.create({ doc: text, extensions: baseExtensions() }));
    },

    getCursor() {
      const head = view.state.selection.main.head;
      const l = view.state.doc.lineAt(head);
      return { line: l.number, col: head - l.from + 1 };
    },
    getLine(line) {
      if (line < 1 || line > view.state.doc.lines) return "";
      return view.state.doc.line(line).text;
    },
    lineCount: () => view.state.doc.lines,

    gotoLine(line, col) {
      const p = pos(line, col);
      view.dispatch({
        selection: { anchor: p },
        effects: EditorView.scrollIntoView(p, { y: "center" }),
      });
      view.focus();
    },
    focus: () => view.focus(),

    setLanguage(name) {
      cfg.language = name;
      view.dispatch({ effects: langComp.reconfigure(languageFor(name)) });
    },
    setReadOnly(ro) {
      cfg.readOnly = !!ro;
      view.dispatch({ effects: roComp.reconfigure([
        EditorState.readOnly.of(!!ro),
        EditorView.editable.of(!ro),
      ]) });
    },
    setLineWrap(on) {
      cfg.lineWrap = !!on;
      view.dispatch({ effects: wrapComp.reconfigure(on ? EditorView.lineWrapping : []) });
    },

    // diags: [{line, startCol, endCol, severity: 'error'|'warn'|'info', message}]
    setDiagnostics(diags) {
      const sevMap = { error: "error", warn: "warning", info: "info" };
      const clsMap = { error: "pandoc-error-line", warn: "pandoc-warning-line",
                       info: "pandoc-info-line" };
      const cmDiags = [];
      const tints = [];
      for (const d of diags) {
        if (!d.line || d.line < 1 || d.line > view.state.doc.lines) continue;
        const from = pos(d.line, d.startCol || 1);
        let to = pos(d.line, d.endCol || (d.startCol || 1));
        if (to <= from) to = Math.min(from + 1, view.state.doc.length);
        cmDiags.push({ from, to,
          severity: sevMap[d.severity] || "info", message: d.message || "" });
        tints.push({ line: d.line, cls: clsMap[d.severity] || clsMap.info });
      }
      view.dispatch(
        cmSetDiagnostics(view.state, cmDiags),
        { effects: setLineTints.of(tints) }
      );
    },
    clearDiagnostics() {
      view.dispatch(
        cmSetDiagnostics(view.state, []),
        { effects: setLineTints.of([]) }
      );
    },

    // ranges: [{line, startCol, endCol}]; returns token for clearHighlights
    highlightRanges(ranges, className) {
      const token = "hl-" + Math.random().toString(36).slice(2);
      view.dispatch({ effects: addHighlight.of({ token, ranges,
        cls: className || "cm-facade-highlight" }) });
      return token;
    },
    clearHighlights(token) {
      view.dispatch({ effects: clearHighlight.of(token ?? null) });
    },

    // ── Offset-based API (v0.4) ────────────────────────────────────
    // Offsets are 0-based indices into getText(), so a tool that computed
    // spans against that string (the intent scanner does) can act on them
    // directly, with no line/col round-trip. Everything here clamps to the
    // document rather than throwing.

    docLength: () => view.state.doc.length,
    getRange(from, to) {
      const len = view.state.doc.length;
      const f = Math.max(0, Math.min(from, len));
      const t = Math.max(f, Math.min(to, len));
      return view.state.doc.sliceString(f, t);
    },
    /** offset -> {line, col}, both 1-based (matches the rest of this API). */
    lineColAt(offset) {
      const len = view.state.doc.length;
      const l = view.state.doc.lineAt(Math.max(0, Math.min(offset, len)));
      return { line: l.number, col: Math.max(0, Math.min(offset, len)) - l.from + 1 };
    },
    /** {line, col} (1-based) -> offset. */
    offsetAt(line, col) { return pos(line, col); },

    /** Replace one span, PRESERVING UNDO HISTORY (unlike setText).
     *  Returns the span the inserted text now occupies. */
    replaceRange(from, to, insert) {
      const len = view.state.doc.length;
      const f = Math.max(0, Math.min(from, len));
      const t = Math.max(f, Math.min(to, len));
      const text = insert == null ? "" : String(insert);
      view.dispatch({ changes: { from: f, to: t, insert: text } });
      return { from: f, to: f + text.length };
    },

    /** Replace several spans as ONE transaction — one undo step, and the
     *  offsets are all interpreted against the CURRENT document, so the
     *  caller does not have to apply bottom-up or recompute anything.
     *  edits: [{from, to, insert}]. Throws on overlapping spans, which
     *  always indicate a caller bug rather than something to paper over. */
    replaceRanges(edits) {
      const len = view.state.doc.length;
      const norm = edits.map((e) => ({
        from: Math.max(0, Math.min(e.from, len)),
        to: Math.max(0, Math.min(e.to, len)),
        insert: e.insert == null ? "" : String(e.insert),
      })).map((e) => ({ ...e, to: Math.max(e.from, e.to) }))
        .sort((a, b) => a.from - b.from || a.to - b.to);
      for (let i = 1; i < norm.length; i++) {
        if (norm[i].from < norm[i - 1].to) {
          throw new Error(
            `replaceRanges: overlapping spans [${norm[i - 1].from},${norm[i - 1].to}) ` +
            `and [${norm[i].from},${norm[i].to})`);
        }
      }
      if (norm.length === 0) return 0;
      view.dispatch({ changes: norm });
      return norm.length;
    },

    /** Mark spans that MAY cross line boundaries, and that follow the text
     *  through later edits. Returns a token for clearMarks.
     *  ranges: [{from, to}] */
    markRanges(ranges, className) {
      const token = "mk-" + Math.random().toString(36).slice(2);
      view.dispatch({ effects: addMarks.of({
        token, ranges, cls: className || "cm-facade-mark" }) });
      return token;
    },
    /** token, or omit/null to clear every offset mark. */
    clearMarks(token) {
      view.dispatch({ effects: clearMarks.of(token ?? null) });
    },

    /** Put the selection on a span and scroll it into view. Used to step
     *  through findings; `focusEditor: false` keeps keyboard focus where it
     *  is (e.g. in a review panel) while still moving the viewport. */
    selectRange(from, to, o = {}) {
      const len = view.state.doc.length;
      const f = Math.max(0, Math.min(from, len));
      const t = Math.max(f, Math.min(to == null ? from : to, len));
      view.dispatch({
        selection: { anchor: f, head: t },
        effects: EditorView.scrollIntoView(f, { y: o.y || "center" }),
      });
      if (o.focusEditor !== false) view.focus();
    },

    /** Undo / redo the last transaction. Exposed so a caller that made an
     *  edit programmatically (an applied annotation) can offer to take it
     *  back without the user having to focus the editor first. Returns
     *  true when something was undone/redone. */
    undo() { return cmUndo(view); },
    redo() { return cmRedo(view); },

    registerCompletionSource(fn) {
      sources.push(fn);
      view.dispatch({ effects: compComp.reconfigure(
        autocompletion({ override: sources.map(wrapSource) })
      ) });
    },
    setCompletionEnabled(on) {
      view.dispatch({ effects: compComp.reconfigure(
        on ? autocompletion({ override: sources.map(wrapSource) }) : []
      ) });
    },

    destroy: () => view.destroy(),
  };
  return handle;
}
