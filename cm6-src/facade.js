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
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import {
  indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching,
  foldGutter, foldKeymap, indentUnit, StreamLanguage,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippet,
} from "@codemirror/autocomplete";
import { setDiagnostics as cmSetDiagnostics, lintGutter, lintKeymap } from "@codemirror/lint";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { stex } from "@codemirror/legacy-modes/mode/stex";

export const CM6_BUNDLE_VERSION = "0.1.0";

// ── Language registry ──────────────────────────────────────────────
function languageFor(name) {
  switch (name) {
    case "latex":    return StreamLanguage.define(stex);
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
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(), closeBrackets(), rectangularSelection(),
    crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
      ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap,
    ]),
    lintGutter(),
    decoField,
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
