# CM6 Facade API — Design Draft (2026-07-20)

Design for migrating the editor layer from Ace to CodeMirror 6 (CM6). The facade
is a single bundled ES module, `codemirror/cm6-editor.js`, built offline from
`cm6-src/` and committed as a static file (same deployment model as `pandoc.js`).
`index.html` imports ONLY the facade; it never touches CM6 internals. All
Pandoc-specific intelligence (lint rules, completions, hint text) stays in
`index.html` or plain sibling files as DATA passed to the facade — so it can be
iterated without rebuilding the bundle.

## Build model

- `cm6-src/` — dev-only folder: `package.json` (+ committed lockfile),
  `facade.js` (bundle entry), `.gitignore`d `node_modules/`.
- `cm6-src/build-cm6.ps1` — right-click-runnable; runs
  `npx esbuild facade.js --bundle --format=esm --minify` →
  `codemirror/cm6-editor.js`. Rebuild ONLY when the facade or CM6
  package versions change; never for day-to-day index.html work.
- Prerequisite for rebuilds only: Node.js LTS. Runtime needs nothing.

## Packages (initial)

- `codemirror` (meta: view/state/basic setup, history, search, default keymap,
  autocomplete infrastructure)
- `@codemirror/lint` (diagnostics: gutter icons, underlines, tooltip,
  clickable panel with jump-to-error)
- `@codemirror/lang-html`, `@codemirror/lang-markdown` (first-class grammars)
- `@codemirror/legacy-modes` → `mode/stex` for LaTeX highlighting initially.
  (CM6 has no first-party LaTeX grammar. Overleaf's Lezer-based LaTeX grammar
  is in their AGPL codebase — adopting it is a later upgrade, accepted by
  Nicholas 2026-07-20, and slots in behind the same facade with no API change.)

## Facade exports

`createEditor(containerEl, opts) → EditorHandle`

opts: `{ language: 'latex'|'markdown'|'html'|'text', readOnly?: bool,
ariaLabel: string, initialText?: string, lineWrap?: bool,
onCursor?: (line, col) => void }`  — line/col are 1-based everywhere in this
API, matching Pandoc's warning JSON.

Two instances replace the two Ace editors: the main editor (latex, editable,
cursor callback feeds the status bar) and the output source viewer (html,
readOnly).

## EditorHandle methods

Content & navigation:
- `getText()` / `setText(text)` — setText resets undo history (matches
  current `setValue(text, -1)` usage)
- `getCursor() → {line, col}` ; `gotoLine(line, col?)` (scroll + select +
  focus) ; `focus()`
- `getLine(line) → string` and `lineCount()` — so index.html's existing
  matched-text / column walk-back resolution logic ports as-is

Configuration:
- `setLanguage('latex'|'markdown'|'html'|'text')` — replaces session.setMode
  on upload (uses a CM6 Compartment internally)
- `setReadOnly(bool)` ; `setLineWrap(bool)` ; `setCompletionEnabled(bool)` —
  live toggles (these replace the Ace ext-settings_menu idea; simple
  checkboxes in index.html can drive them later)

Diagnostics (replaces the three-tier Ace decoration system):
- `setDiagnostics(diags)` — diags: array of `{ line, startCol, endCol,
  severity: 'error'|'warn'|'info', message }` (1-based; facade converts to
  character offsets). CM6's lint extension renders gutter icon + underline +
  hover tooltip natively; the facade adds the full-line background tint via a
  line decoration keyed to severity CSS classes (pandoc-error-line etc.), so
  existing CSS carries over with minor renames.
- `clearDiagnostics()`
- `openDiagnosticsPanel()` / `closeDiagnosticsPanel()` — CM6's built-in
  clickable error list with jump-to-position; complements (or eventually
  replaces) the existing log pane's jump-to-line links.
- Position resolution (matchedText search, column walk-back) STAYS in
  index.html as a pure function producing startCol/endCol — it is
  Pandoc-specific intelligence, kept out of the compiled bundle by design.

Cleanup-tool interplay & general highlighting:
- `highlightRanges(ranges, className) → token` — ranges:
  `[{line, startCol, endCol}]`; returns a token for `clearHighlights(token)`.
  Generic: usable for cleanup-pattern previews, search results, etc.

Autocompletion (custom, Pandoc-tailored — defined in index.html, not the bundle):
- `registerCompletionSource(fn)` — fn receives
  `{ line, col, prefix, lineText }` and returns
  `{ fromCol, options: [{ label, insert, detail?, infoHTML?, type? }] } | null`.
  `insert` may contain snippet placeholders (`${1:env}`); the facade routes
  those through CM6's snippet support. `infoHTML` renders a side panel per
  suggestion — this is the "hints" mechanism (explain WHY a construct is
  Pandoc/accessibility-friendly).
- Multiple sources may be registered (e.g., environment completer +
  local-words completer). CM6 merges them.

Lifecycle: `destroy()`.

Bundle also exports `CM6_BUNDLE_VERSION` (string) for sanity checks.

## Ace → facade migration map

| Current Ace usage | Facade equivalent |
|---|---|
| `ace.edit(...)` + setTheme + setOptions + aria wiring | `createEditor(el, opts)` |
| `editor.setValue(t, -1)` / `getValue()` | `setText(t)` / `getText()` |
| `session.setMode('ace/mode/x')` (init + upload + reset) | `setLanguage('x')` |
| `setReadOnly(...)` | `setReadOnly(...)` |
| `getCursorPosition()` + `changeCursor` event | `getCursor()` + `onCursor` opt |
| `gotoLine` / `focus` | `gotoLine` / `focus` |
| `setAnnotations` + `addMarker`(fullLine) + `addMarker`(text) + `Range` | `setDiagnostics(diags)` |
| `clearAnnotations` + `removeMarker` loop | `clearDiagnostics()` |
| `editor.resize()` / `sourceEditor.resize()` (≈11 call sites) | DELETE — CM6 self-measures via ResizeObserver |
| `ext-searchbox` (Ctrl+F) | CM6 built-in search panel (free) |
| Ctrl+Enter convert shortcut | unchanged — stays a DOM-level listener in index.html |

## What migrates outside the facade

- CSS: Ace-specific selectors (`.ace_gutter`, marker classes) → CM6 theme
  classes; facade applies severity classes so `pandoc-error-*` etc. survive
  with selector renames. Fonts/sizing set via `EditorView.theme` from opts.
- The 'Loading formats' / disabled-Convert timing logic: unchanged (it keys
  off pandoc.wasm, not the editor).
- Layout/resize drag logic: keep, minus the explicit editor.resize() calls.

## Known differences / decisions accepted

1. LaTeX highlighting starts on the legacy stex mode (CM5 port) — slightly
   coarser than Ace's latex mode; Overleaf's Lezer grammar is the upgrade
   path (AGPL accepted for this project).
2. No CM6 equivalent of Ace's ext-settings_menu; live toggles are facade
   setters instead. The worker-html.js 404 and "misspelled option" warning
   classes of problem disappear entirely (no workers; compile-time imports).
3. Accessibility: facade sets aria-label on the content DOM; CM6's
   contenteditable model is generally stronger for screen readers than Ace's
   hidden-textarea model. Verify with NVDA during migration (bridge tools
   available in Claude sessions).
4. Migration happens on a branch, then transplants to the planned NEW repo
   before the team demo (~2 weeks). cm6-src/ + codemirror/ move with it;
   remember node_modules in the new repo's .gitignore.

## Open questions — RESOLVED (Nicholas, 2026-07-20)

- Log pane: keep the existing log-file setup as close to current as possible;
  it remains the primary error list and will keep evolving (a "preflight"
  source-checking script — e.g. missing alt text — is planned and will feed
  the SAME setDiagnostics API as Pandoc warnings). CM6's lint panel ships in
  the bundle but stays unused for now.
- Theme: match the current look.
