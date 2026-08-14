--[[
  mathjax-intent-toggle.lua  (mathjax-mode-toggle.lua + MathML intent)
  ==========================================================================
  GENERATED from mathjax-mode-toggle.lua by build-lua-filter.py. The parent
  is preserved verbatim; the only additions are the SPEECH_MODE / MAPS_PATH
  config vars and the intent extension pasted into CUSTOM_EXTENSION_JS.
  Diff against the parent to see exactly what changed.
  ==========================================================================
  One filter that, for standalone HTML with math, does all of the following
  (each optional part has an on/off switch in the CONFIG block below):

    1. Suppresses whatever MathJax script Pandoc would inject.
    2. Injects a MathJax 4 configuration (defined BEFORE the library loads),
       including an easy spot for custom TeX macros and a slot for pasting a
       custom MathJax extension directly into this file (no CDN needed).
    3. Loads MathJax 4 via the combined tex-mml-chtml component -- TeX AND
       MathML input, CommonHTML output -- so both LaTeX-source and MathML-source
       pipelines render from one config.
    4. [INSERT_TOGGLE]   Injects a single labeled button that flips MathJax
       between two accessibility modes.
    5. [FIX_MENU_CSS]    Applies a small CSS/markup fix so MathJax's context
       menu SUBMENUS position correctly with Pandoc's default stylesheet.

  >>> Use only ONE MathJax-injecting filter per conversion. In particular, do
      NOT combine this with its Canvas/SCORM sibling, mathjax-canvas-scorm.lua
      -- running two together would load MathJax twice and inject two
      competing configs.

  >>> This filter is also the base of that Canvas/SCORM sibling: the
      config/library injection is the stable shared core; the toggle and the
      menu fix are independent feature blocks, and the sibling's packaging is
      one more such block.

  STARTING MODE = "MathJax speech" (MathJax 4's own default)
  ----------------------------------------------------------
  MathJax 4 boots its combined components with speech + the explorer ON and
  assistive MathML OFF (the reverse of v3). This filter keeps that as the
  default and adds subtitles, so out of the box every expression is voiced by
  MathJax and, while a user explores an expression by keyboard, its speech
  string appears on screen beneath it. The button switches to:

    "Hidden MathML (MathCat)"  -- assistive MathML on, which turns MathJax's
                                  own speech/braille off, so a screen reader's
                                  math engine (MathCat on NVDA / JAWS /
                                  Kurzweil) reads and navigates the MathML.

  State PERSISTS across page loads: MathJax saves menu settings to
  localStorage ('MathJax-Menu-Settings') whenever any menu variable changes --
  including the ones this button drives -- and merges the saved values back
  OVER the page config at startup (verified in Menu.ts, MathJax 4.1.3). A page
  last left in MathCat mode therefore boots in MathCat mode. The button syncs
  its label to the page's actual state once MathJax is ready, so START_MODE
  below is only the pre-startup label and the first-visit default.

  EXTENSIONS
  ----------
  physics and mathtools are loaded explicitly (physics is never autoloaded
  because it redefines standard macros; mathtools is not autoloaded either).
  Everything else is handled by the autoload extension already bundled in
  tex-mml-chtml, which pulls packages in on first use. a11y/assistive-mml is
  loaded explicitly because v4's combined components no longer include it, and
  the MathCat mode needs it. (If you add braket, drop physics or vice versa --
  the two conflict.)

  CUSTOM MACROS AND CUSTOM EXTENSIONS (no CDN required)
  -----------------------------------------------------
  Two tiers, both living entirely inside this file:

    * Simple command rewrites -> the `macros:` table inside MATHJAX_CONFIG.
      One line per command; the combined component bundles configmacros, so
      these just work. Example (commented out in the config below):
          odv: ['\\frac{d#1}{d#2}', 2]
    * A real custom extension (anything needing actual parsing) -> paste its
      JavaScript into CUSTOM_EXTENSION_JS. That code is emitted in its own
      <script> AFTER the config and BEFORE the MathJax library loads, so it can
      modify window.MathJax (add loader/package entries, define a
      startup.ready() hook that registers a TeX package, etc.). The
      custom-tex-extension demo in the MathJax repo is the template for
      writing one. Left empty, nothing extra is emitted.

  THE CONTEXT-MENU FIX  (FIX_MENU_CSS)
  ------------------------------------
  When the page CSS centers the body with auto margins and a max-width
  (Pandoc's own default stylesheet does; so do many custom ones), MathJax's
  menu library computes each
  SUBMENU's horizontal position from its parent's offsetLeft (measured
  against the centered body) but places the submenu against the viewport --
  so every submenu opens exactly the centering-margin too far left, on top
  of its parent. Pandoc's stock stylesheet (through at least 3.10) IS such
  CSS -- `margin: 0 auto; max-width: 36em` -- so plain `pandoc -s` output
  has this bug live. (If a machine's output looks immune, check the pandoc
  user data directory for a customized template: e.g. a styles.html with
  `max-width: 100%` never centers, so the bug can't show there.) With
  INSERT_TOGGLE off the context menu is the only way users
  switch reading modes, so this is an accessibility failure, not cosmetics.
  The fix removes the possibility under ANY stylesheet: the body is pinned
  to full width and the page column moves onto an inner wrapper <div>
  around the document content, sized by WRAP_MAX_WIDTH below. (A CSS-only
  alternative -- forcing .CtxtMenu_Menu { position: fixed } -- is
  deliberately NOT used: it can misplace the main menu once the page is
  scrolled.) If you ship your own full stylesheet, you may prefer this off
  and to simply avoid centering the body in your CSS.

  HOW THE CONFIG INJECTION WORKS  (pure AST -- no string post-processing)
  ----------------------------------------------------------------------
  Pandoc's HTML writer feeds its math <script> into the template's `math`
  variable via a defField pipeline that yields to any value already present,
  so setting meta.math = false makes the writer emit nothing. The v4 config +
  custom-extension script + library + toggle are appended to header-includes,
  which (since Pandoc 2.17) the default template renders AFTER its own style
  block and BEFORE the math block; within header-includes we control order, so
  the config object (and any custom extension) is defined before the deferred
  library script runs, and the menu-fix CSS overrides Pandoc's body rule by
  normal cascade order. VERIFY ON FIRST RUN: the <head> should contain exactly
  ONE MathJax script.

  HOW THE SWITCH WORKS  (MathJax 4 menu pool variables)
  -----------------------------------------------------
  Each accessibility setting is a named variable in the menu pool; setting one
  fires its callback and re-renders.
    - Into MathJax speech: enrich first (it gates the speech/explorer
      subsystem), then subtitles, then speech.
    - Into hidden MathML: assistiveMml on (auto-clears speech/braille), then
      enrich off to restore the quiet default.
  The speech/explorer machinery is bundled in the combined build, so switching
  is synchronous.
  Every variable setter also calls MathJax's saveUserSettings, so each switch
  is persisted to localStorage (see STARTING MODE above). The button treats
  the assistiveMml variable as ground truth: it reads it at startup to correct
  its label, and on every click to flip from the page's ACTUAL mode rather
  than from the label -- so it stays honest even if the user switches modes
  from the right-click context menu instead.

  STYLING
  -------
  A <style> block is injected via header-includes, so it survives even a setup
  that suppresses Pandoc's own document stylesheet. Base
  appearance is also inlined on the button as a fallback, so it stays legible if
  the stylesheet is ever removed. When the menu fix is active, the button is
  inserted inside the centered wrapper so it lines up with the text column.

  HTML output only; everything is injected only when the document actually
  contains math.
]]

if not FORMAT:match('html') then
  return {}
end

-- ===================================================================
--  CONFIG -- the switches and blocks a user is expected to edit.
-- ===================================================================

-- Insert the accessibility-mode toggle button?
--   true  = the labeled button appears at the top of the page
--   false = no button; the page stays in START_MODE or the user's saved
--           MathJax menu settings (users can still change modes from
--           MathJax's own right-click context menu)
local INSERT_TOGGLE = true

-- Guarantee MathJax context-menu SUBMENUS open in the right place?
--   true  = body is pinned full-width and the page column moves onto an
--           inner wrapper div (width = WRAP_MAX_WIDTH), which makes the
--           submenu-misplacement bug impossible under any stylesheet.
--           Pandoc's stock stylesheet centers the body, so plain
--           `pandoc -s` output needs this.
--   false = leave the page markup/CSS alone. Only safe when you know the
--           CSS never centers the body (e.g. your own stylesheet handles
--           this), since a centered body misplaces the submenus.
local FIX_MENU_CSS = true

-- Width of the content column the fix creates (only used when FIX_MENU_CSS
-- is true). Two natural choices:
--   '36em' = Pandoc's stock centered reading column. With Pandoc's default
--            stylesheet the fixed page looks IDENTICAL to the unfixed one;
--            only the menus behave differently.
--   '100%' = full-width column (matches e.g. a customized template that
--            sets body max-width to 100%); the fix then changes nothing
--            visually and acts purely as a bug guard.
local WRAP_MAX_WIDTH = '36em'

-- Which mode the page starts in. Must match the settings in the config below:
--   'mathjax'  = speech + subtitles (assistiveMml off)   <- current default
--   'mathcat'  = hidden MathML (assistiveMml on)
-- NOTE: first-visit default only. MathJax restores each user's saved menu
-- settings from localStorage over the config at startup; the button reads the
-- actual state once MathJax is ready and corrects its label if they differ.
local START_MODE = 'mathjax'

-- ###########################################################################
--  PINNED MATHJAX VERSION  -- change here, nowhere else.
--
--  Pinned deliberately, not as caution. With RULES_DELIVERY = 'inline' our four
--  SRE rules are merged into whatever locale file the CDN serves, and the worker
--  is created by overriding an INTERNAL MathJax method (HTMLAdaptor.createWorker).
--  An unpinned 'mathjax@4' could therefore change the rule format or the worker
--  shape under us with no warning.
--
--  Before raising this: convert a test document, open it, and check the console
--  for "[intent] speech self-test OK". A "SPEECH DEGRADED" message means the new
--  version broke something -- see the watch list in the README.
-- ###########################################################################
local MATHJAX_VERSION = '4.1.3'

-- How our four SRE rules reach the speech worker. Our rules are registered for
-- ClearSpeak ONLY, so MathSpeak always reads verbatim -- that is deliberate,
-- since MathSpeak exists to be reconstructable. Nothing here emits ext-speech
-- automatically, so nothing overrides MathSpeak. (The one exception is an
-- explicit \speakas{}{} in the source; see the note at its definition.)
--
-- If the rules do not arrive, annotated expressions read structurally and a
-- self-test reports it loudly: console.error, data-intent-speech="degraded" on
-- <html>, and window.__intentStatus. There is no silent fallback.
--   'inline'  embed the rules in the HTML and merge them into the locale file
--             the worker already downloads. NOTHING extra to ship -- a single
--             self-contained HTML file, verified working from a file:// URL.
--   'path'    serve a patched locale directory and point [mathmaps] at
--             MAPS_PATH below. Fully supported API, but something must be
--             shipped or hosted alongside.
--   'none'    no composed rules; annotated expressions read structurally.
-- The `intent` attribute for MathCat is emitted regardless, so none of this
-- affects the hidden-MathML audience.
local RULES_DELIVERY = 'inline'

-- Only used when RULES_DELIVERY = 'path'. Directory produced by
-- build-intent-maps.cjs. Three workable shapes:
--   './intent-maps'   folder shipped beside the HTML (LMS/SCORM package,
--                     static host, your own platform). Same origin. Must be
--                     served over http(s); file:// will not start a worker.
--                     Relative means relative to EACH page, so prefer a
--                     leading-slash path if pages sit at differing depths.
--   'https://cdn.jsdelivr.net/gh/OWNER/REPO@TAG/intent-maps'
--                     public repo via jsDelivr; nothing to operate.
--   'https://your.host/intent-maps'
-- Re-run build-intent-maps.cjs after a MathJax upgrade, and pin the version in
-- MATHJAX_SCRIPT, or the copies silently drift apart.
local MAPS_PATH = './intent-maps'

-- Which vocabulary GROUPS are active when a document does not say. Comma list
-- of rollup names, or 'all'. A document overrides this with metadata:
--   intent-groups: all
--   intent-groups: [calculus-analysis, linear-algebra]
-- 'core-authored' is ALWAYS active and need not be listed. A concept whose
-- group is disabled degrades safely: its macro still parses (expanding to the
-- plain notation) and \intent acts as identity -- raw-symbol reading.
local DEFAULT_INTENT_GROUPS = 'all'

-- Which name the intent attribute carries when MathCAT's name for a concept
-- differs from the (W3C-aligned) list name recorded in the vocabulary:
--   'list'     always emit our concept name          <- default
--   'mathcat'  prefer the recorded mathcatName when one exists
-- Only the MathCAT channel (intent=) is affected; ext-* phrasing never changes.
local MATHCAT_NAMES = 'list'

-- Per-document pruning: emit into each page only vocabulary entries its math
-- actually references (\intent{concept} or a named macro). false = emit every
-- baked entry regardless of use (debugging / standalone-vocab pages).
local INTENT_PRUNE = true

local VOCAB_GROUPS = {
  ['core-authored'] = true,
  ['algebra-arithmetic'] = true,
  ['calculus-analysis'] = true,
  ['linear-algebra'] = true,
  ['geometry-topology'] = true,
  ['discrete'] = true,
  ['number-theory'] = true,
  ['probability-statistics'] = true,
  ['abstract-algebra-category'] = true,
  ['special-functions'] = true,
  ['physics-quantum'] = true,
  ['chemistry-units'] = true,
  ['other'] = true,
}
local VOCAB_ENTRIES = {
  { concept = 'absolute-value', group = 'core-authored', macro = 'abs', json = [==[{"open": "the absolute value of", "close": "", "macro": ["abs", 1, "\\left|\\iarg{#1}\\right|"]}]==], offjson = [==[{"off": true, "macro": ["abs", 1, "\\left|{#1}\\right|"]}]==] },
  { concept = 'determinant', group = 'core-authored', macro = 'determ', json = [==[{"open": "the determinant of", "close": "", "macro": ["determ", 1, "\\left|\\iarg{#1}\\right|"]}]==], offjson = [==[{"off": true, "macro": ["determ", 1, "\\left|{#1}\\right|"]}]==] },
  { concept = 'cardinality', group = 'core-authored', macro = 'card', json = [==[{"open": "the cardinality of", "close": "", "macro": ["card", 1, "\\left|\\iarg{#1}\\right|"]}]==], offjson = [==[{"off": true, "macro": ["card", 1, "\\left|{#1}\\right|"]}]==] },
  { concept = 'magnitude', group = 'core-authored', macro = 'magn', json = [==[{"open": "the magnitude of", "close": "", "macro": ["magn", 1, "\\left|\\iarg{#1}\\right|"]}]==], offjson = [==[{"off": true, "macro": ["magn", 1, "\\left|{#1}\\right|"]}]==] },
  { concept = 'modulus', group = 'core-authored', macro = 'modulus', json = [==[{"open": "the modulus of", "close": "", "macro": ["modulus", 1, "\\left|\\iarg{#1}\\right|"]}]==], offjson = [==[{"off": true, "macro": ["modulus", 1, "\\left|{#1}\\right|"]}]==] },
  { concept = 'norm', group = 'core-authored', macro = 'norm', json = [==[{"open": "the norm of", "close": "", "macro": ["norm", 1, "\\left\\|\\iarg{#1}\\right\\|"]}]==], offjson = [==[{"off": true, "macro": ["norm", 1, "\\left\\|{#1}\\right\\|"]}]==] },
  { concept = 'subscripted-norm', group = 'core-authored', macro = 'normsub', json = [==[{"open": "the", "mid1": "norm of", "close": "", "macro": ["normsub", 2, "\\left\\|\\iarg[b]{#1}\\right\\|_{\\iarg{#2}}"]}]==], offjson = [==[{"off": true, "macro": ["normsub", 2, "\\left\\|{#1}\\right\\|_{{#2}}"]}]==] },
  { concept = 'open-interval', group = 'core-authored', macro = 'openint', json = [==[{"open": "the open interval from", "mid1": "to", "close": "", "macro": ["openint", 2, "\\left(\\iarg{#1},\\iarg[b]{#2}\\right)"]}]==], offjson = [==[{"off": true, "macro": ["openint", 2, "\\left({#1},{#2}\\right)"]}]==] },
  { concept = 'closed-interval', group = 'core-authored', macro = 'closedint', json = [==[{"open": "the closed interval from", "mid1": "to", "close": "", "macro": ["closedint", 2, "\\left[\\iarg{#1},\\iarg[b]{#2}\\right]"]}]==], offjson = [==[{"off": true, "macro": ["closedint", 2, "\\left[{#1},{#2}\\right]"]}]==] },
  { concept = 'open-closed-interval', group = 'core-authored', macro = 'opclint', json = [==[{"open": "the interval from", "mid1": "exclusive to", "close": "inclusive", "macro": ["opclint", 2, "\\left(\\iarg{#1},\\iarg[b]{#2}\\right]"]}]==], offjson = [==[{"off": true, "macro": ["opclint", 2, "\\left({#1},{#2}\\right]"]}]==] },
  { concept = 'closed-open-interval', group = 'core-authored', macro = 'clopint', json = [==[{"open": "the interval from", "mid1": "inclusive to", "close": "exclusive", "macro": ["clopint", 2, "\\left[\\iarg{#1},\\iarg[b]{#2}\\right)"]}]==], offjson = [==[{"off": true, "macro": ["clopint", 2, "\\left[{#1},{#2}\\right)"]}]==] },
  { concept = 'ordered-pair', group = 'core-authored', macro = 'pair', json = [==[{"open": "the ordered pair", "mid1": "comma", "close": "", "macro": ["pair", 2, "\\left(\\iarg{#1},\\iarg[b]{#2}\\right)"]}]==], offjson = [==[{"off": true, "macro": ["pair", 2, "\\left({#1},{#2}\\right)"]}]==] },
  { concept = 'gcd', group = 'core-authored', macro = 'gcdof', json = [==[{"open": "the greatest common divisor of", "mid1": "and", "close": "", "macro": ["gcdof", 2, "\\gcd\\left(\\iarg{#1},\\iarg[b]{#2}\\right)"]}]==], offjson = [==[{"off": true, "macro": ["gcdof", 2, "\\gcd\\left({#1},{#2}\\right)"]}]==] },
  { concept = 'binomial-coefficient', group = 'core-authored', macro = 'binomc', json = [==[{"open": "", "mid1": "choose", "close": "", "mc": "binomial", "macro": ["binomc", 2, "\\binom{\\iarg{#1}}{\\iarg[b]{#2}}"]}]==], offjson = [==[{"off": true, "macro": ["binomc", 2, "\\binom{{#1}}{{#2}}"]}]==] },
  { concept = 'inner-product', group = 'core-authored', macro = 'ipof', json = [==[{"open": "the inner product of", "mid1": "and", "close": "", "macro": ["ipof", 2, "\\left\\langle\\iarg{#1},\\iarg[b]{#2}\\right\\rangle"]}]==], offjson = [==[{"off": true, "macro": ["ipof", 2, "\\left\\langle{#1},{#2}\\right\\rangle"]}]==] },
  { concept = 'braket', group = 'core-authored', json = [==[{"open": "the inner product of", "mid1": "and", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'ket', group = 'core-authored', json = [==[{"open": "ket", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'bra', group = 'core-authored', json = [==[{"open": "bra", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'expectation-value', group = 'core-authored', json = [==[{"open": "the expectation value of", "mid1": "in the state", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'ketbra', group = 'core-authored', json = [==[{"open": "the outer product of", "mid1": "and", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'matrix-element', group = 'core-authored', json = [==[{"open": "the matrix element", "mid1": "", "mid2": "", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'cross-product', group = 'core-authored', macro = 'crossp', json = [==[{"open": "the cross product of", "mid1": "and", "close": "", "macro": ["crossp", 2, "\\iarg{#1}\\times\\iarg[b]{#2}"]}]==], offjson = [==[{"off": true, "macro": ["crossp", 2, "{#1}\\times{#2}"]}]==] },
  { concept = 'dot-product', group = 'core-authored', macro = 'dotp', json = [==[{"open": "the dot product of", "mid1": "and", "close": "", "macro": ["dotp", 2, "\\iarg{#1}\\cdot\\iarg[b]{#2}"]}]==], offjson = [==[{"off": true, "macro": ["dotp", 2, "{#1}\\cdot{#2}"]}]==] },
  { concept = 'transpose', group = 'core-authored', macro = 'transp', json = [==[{"open": "the transpose of", "close": "", "macro": ["transp", 1, "{\\iarg{#1}}^{\\mathsf{T}}"]}]==], offjson = [==[{"off": true, "macro": ["transp", 1, "{{#1}}^{\\mathsf{T}}"]}]==] },
  { concept = 'trace', group = 'core-authored', macro = 'traceof', json = [==[{"open": "the trace of", "close": "", "macro": ["traceof", 1, "\\operatorname{tr}\\left(\\iarg{#1}\\right)"]}]==], offjson = [==[{"off": true, "macro": ["traceof", 1, "\\operatorname{tr}\\left({#1}\\right)"]}]==] },
  { concept = 'complex-conjugate', group = 'core-authored', macro = 'conj', json = [==[{"open": "the complex conjugate of", "close": "", "macro": ["conj", 1, "\\overline{\\iarg{#1}}"]}]==], offjson = [==[{"off": true, "macro": ["conj", 1, "\\overline{{#1}}"]}]==] },
  { concept = 'line-segment', group = 'core-authored', macro = 'lineseg', json = [==[{"open": "the line segment", "close": "", "macro": ["lineseg", 1, "\\overline{\\iarg{#1}}"]}]==], offjson = [==[{"off": true, "macro": ["lineseg", 1, "\\overline{{#1}}"]}]==] },
  { concept = 'mean', group = 'core-authored', macro = 'meanof', json = [==[{"open": "the mean of", "close": "", "macro": ["meanof", 1, "\\overline{\\iarg{#1}}"]}]==], offjson = [==[{"off": true, "macro": ["meanof", 1, "\\overline{{#1}}"]}]==] },
  { concept = 'set-complement', group = 'core-authored', macro = 'complementof', json = [==[{"open": "the complement of", "close": "", "macro": ["complementof", 1, "\\overline{\\iarg{#1}}"]}]==], offjson = [==[{"off": true, "macro": ["complementof", 1, "\\overline{{#1}}"]}]==] },
  { concept = 'vector', group = 'core-authored', macro = 'vecof', json = [==[{"open": "the vector", "close": "", "macro": ["vecof", 1, "\\mathbf{\\iarg{#1}}"]}]==], offjson = [==[{"off": true, "macro": ["vecof", 1, "\\mathbf{{#1}}"]}]==] },
  { concept = 'derivative', group = 'core-authored', macro = 'deriv', json = [==[{"open": "the derivative of", "mid1": "with respect to", "close": "", "macro": ["deriv", 2, "\\frac{d\\iarg{#1}}{d\\iarg[b]{#2}}"]}]==], offjson = [==[{"off": true, "macro": ["deriv", 2, "\\frac{d{#1}}{d{#2}}"]}]==] },
  { concept = 'definite-integral', group = 'core-authored', macro = 'defint', json = [==[{"open": "the integral from", "mid1": "to", "mid2": "of", "close": "", "macro": ["defint", 4, "\\int_{\\iarg{#1}}^{\\iarg[b]{#2}}\\iarg[c]{#3}\\,d#4"]}]==], offjson = [==[{"off": true, "macro": ["defint", 4, "\\int_{{#1}}^{{#2}}{#3}\\,d#4"]}]==] },
  { concept = 'set', group = 'core-authored', macro = 'set', json = [==[{"open": "the set", "close": "", "macro": ["set", 1, "\\left\\{\\iarg{#1}\\right\\}"]}]==], offjson = [==[{"off": true, "macro": ["set", 1, "\\left\\{{#1}\\right\\}"]}]==] },
  { concept = 'cardinality-of-set-builder', group = 'core-authored', json = [==[{"open": "the number of elements in", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'time-derivative', group = 'calculus-analysis', json = [==[{"open": "the time derivative of", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'fixed-point', group = 'calculus-analysis', json = [==[{"open": "the fixed point", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'optimal-solution', group = 'other', json = [==[{"open": "the optimal solution", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'gradient', group = 'calculus-analysis', json = [==[{"open": "the gradient of", "close": ""}]==], offjson = [==[{"off": true}]==] },
  { concept = 'concentration', group = 'chemistry-units', json = [==[{"open": "the concentration of", "close": ""}]==], offjson = [==[{"off": true}]==] },
}

-- Assemble the per-document vocabulary and fill the extension's placeholders.
-- Called from Pandoc(doc) below, after every Math element has been seen.
local function finalize_intent_extension(js, meta, texts)
  local function pat_escape(s) return (s:gsub('(%W)', '%%%1')) end

  -- 1. which groups are enabled for THIS document
  local enabled = { ['core-authored'] = true }
  local selected, all = {}, false
  local mv = meta and meta['intent-groups']
  if mv ~= nil then
    if pandoc.utils.type(mv) == 'List' then
      for _, item in ipairs(mv) do selected[#selected + 1] = pandoc.utils.stringify(item) end
    else
      for g in pandoc.utils.stringify(mv):gmatch('[^,%s]+') do selected[#selected + 1] = g end
    end
  else
    for g in tostring(DEFAULT_INTENT_GROUPS):gmatch('[^,%s]+') do selected[#selected + 1] = g end
  end
  for _, g in ipairs(selected) do
    if g == 'all' then all = true
    elseif VOCAB_GROUPS[g] then enabled[g] = true
    else io.stderr:write("[intent] WARNING: unknown intent-groups value '" .. g .. "' (ignored)\n") end
  end

  -- 2. per-document pruning + group filter
  local blob = table.concat(texts, '\n')
  local parts, n_on, n_off = {}, 0, 0
  for _, e in ipairs(VOCAB_ENTRIES) do
    local used = not INTENT_PRUNE
      or blob:find('\\intent%s*{%s*' .. pat_escape(e.concept) .. '%s*}') ~= nil
      or (e.macro ~= nil and blob:find('\\' .. e.macro .. '%f[%A]') ~= nil)
    if used then
      if all or enabled[e.group] then
        parts[#parts + 1] = '"' .. e.concept .. '": ' .. e.json
        n_on = n_on + 1
      else
        parts[#parts + 1] = '"' .. e.concept .. '": ' .. e.offjson
        n_off = n_off + 1
        io.stderr:write("[intent] note: '" .. e.concept .. "' is used but its group '"
          .. e.group .. "' is disabled -- it will read as raw notation\n")
      end
    end
  end
  local literal = (#parts == 0) and '{}' or ('{\n' .. table.concat(parts, ',\n') .. '\n}')
  io.stderr:write('[intent] vocabulary emitted: ' .. n_on .. ' active, '
    .. n_off .. ' disabled-but-used, of ' .. #VOCAB_ENTRIES .. ' baked\n')

  js = js:gsub('__VOCAB_JSON__', function() return literal end)
  return js
end

-- MathJax 4 configuration, defined BEFORE the library loads.
-- The `macros:` table is the easy place to add simple custom commands.
local MATHJAX_CONFIG = [==[
<script>
window.MathJax = {
  loader: {
    // a11y/explorer is preloaded deliberately. It is normally lazy-loaded, but
    // it OWNS the defaults for 'subtitles' and 'viewBraille' (they are declared
    // in explorer.js and nowhere else). Without it, any attempt to set those
    // keys before the explorer arrives -- e.g. applyMode() calling
    // setVar(pool,'subtitles',true) -- raises
    //     Invalid option "subtitles" (no default value)
    // and the subtitle region stays hidden, because the explorer gates it on
    //     s.subtitles && s.speech && i.enableSpeech
    // Symptom when this is missing: subtitles appear only AFTER the user opens
    // the context menu or toggles modes, both of which force the load.
    load: ['a11y/assistive-mml', 'a11y/explorer', '[tex]/physics', '[tex]/mathtools']
  },
  tex: {
    packages: { '[+]': ['physics', 'mathtools'] },
    // Simple custom commands go here -- one line each, no code needed.
    // '#1', '#2', ... are the arguments; the number is how many it takes.
    macros: {
      // odv: ['\\frac{d#1}{d#2}', 2]
    }
    // everything else loads on demand via the bundled autoload extension
  },
  options: {
    // TWO DISTINCT NAMESPACES -- do not merge them.
    //
    // options.menuOptions.settings  = MenuSettings, declared statically in
    //   ui/menu/Menu.ts. Only keys present in those defaults may be set here.
    //   Includes: enrich, speech, braille, assistiveMml, speechRules,
    //   brailleCode, brailleSpeech, brailleCombine, collapsible, roleDescription,
    //   inTabOrder, tabSelects, help, renderer, scale, zoom ...
    //
    // options.a11y = DOCUMENT options, declared by a11y/explorer.ts
    //   (ExplorerMathDocument.OPTIONS.a11y). Includes: subtitles, viewBraille,
    //   voicing, magnification, magnify, treeColoring, highlight, hover,
    //   infoType/infoRole/infoPrefix, backgroundColor/Opacity, foreground*.
    //   These require a11y/explorer to be LOADED (see loader.load above),
    //   because that component is what declares their defaults.
    //
    // The menu can still change a11y keys at runtime: Menu.a11yVar() builds a
    // variable whose getter/setter proxy to getA11y/setA11y. That is a RUNTIME
    // mechanism, not a static default -- which is why the menu can toggle
    // subtitles even though 'subtitles' is not a MenuSettings key, and why
    // setting it here under menuOptions.settings raises
    //     Invalid option "subtitles" (no default value)
    menuOptions: {
      settings: {
        enrich:       true,   // gates speech/braille/explorer (v4 default on)
        speech:       true,   // MathJax voices each expression (v4 default on)
        assistiveMml: false,  // hidden MathML OFF (MathCat mode turns it on)
        braille:      false,  // leave braille generation off unless requested
        collapsible:  false
      }
    },
    a11y: {
      subtitles: true       // speech string shown on screen while exploring
    }
  }
};
</script>
]==]

-- A custom MathJax extension, pasted directly into this file (no CDN needed).
-- Whatever JavaScript you put between the [==[ ]==] markers is emitted in its
-- own <script> AFTER the config above and BEFORE the MathJax library loads.
-- It can modify window.MathJax freely -- e.g. add a loader entry, extend
-- tex.packages, or define window.MathJax.startup.ready = function () { ... }
-- to register a TeX extension (see MathJax's custom-tex-extension demo).
-- Leave it empty (as shipped) and nothing extra is emitted.
local CUSTOM_EXTENSION_JS = [==[
// ===========================================================================
//  intent-inline.js  —  dual-channel intent for MathJax 4, no build step.
//
//  Emits, from ONE vocabulary table:
//    intent="concept($a,$b)"  + arg="a"     -> MathCAT (NVDA / JAWS / Orca)
//    ext-* carrier + phrasing               -> SRE (aria-label / subtitles)
//    named TeX commands (\determ{A} etc.)   -> authoring convenience
//
//  Loaded BEFORE the MathJax library, so it may freely mutate window.MathJax.
//
//  NOTHING in this extension alters MathSpeak. All five of our rules are
//  registered for clearspeak only, and we never emit ext-speech — the attribute
//  SRE matches in every domain via its shipped direct-speech rule. An author's
//  \speakas{}{} uses our own ext-say attribute instead, which MathSpeak ignores.
//  Verified: MathSpeak output for an annotated expression is byte-identical to
//  the same expression unannotated.
//
//  There is no flat fallback. It would have required ext-speech (and so would
//  have overridden MathSpeak), and it would not have helped anyway: ext-speech
//  is matched by SRE *inside the worker*, so if a Content Security Policy blocks
//  blob workers the worker never starts and both channels die together.
//
//  Instead we self-test after typesetting and report loudly. See selfTest().
// ===========================================================================
(function () {
  'use strict';

  //  'inline'  embed the rules here and merge them into the locale file the
  //            worker already downloads. No companion folder, no extra request.
  //            Uses an internal MathJax method — see installWorkerPatch.
  //  'path'    serve a patched locale directory; point [mathmaps] at MAPS_PATH.
  //  'none'    deliver no rules; annotated expressions read structurally.
  var RULES_DELIVERY = '__RULES_DELIVERY__';
  var MAPS_PATH      = '__MAPS_PATH__';   // only when RULES_DELIVERY = 'path'
  // Which name the intent attribute carries when a vocabulary entry records a
  // divergent MathCAT name (entry.mc): 'list' = our concept name (default),
  // 'mathcat' = prefer entry.mc. MathCAT channel only; ext-* never changes.
  var MATHCAT_NAMES  = '__MATHCAT_NAMES__';

  // Opening phrases actually emitted during this page's typesetting. Used by
  // selfTest() to tell "composed rules working" from "silently degraded".
  var EMITTED = [];
  var RULES_LOCALE   = 'en';

  // The six rules, needed here only for 'inline' delivery. Byte-identical in
  // meaning to what build-intent-maps.cjs writes into en.json.
  //   * priority must be the LAST constraint, and above ~250 to beat built-ins
  //   * keep it finite so ext-speech (priority Infinity) can still override
  //   * descendant axis: the semantic tree nests children under <children>
  //   * ARG stays STRICTLY descendant (never descendant-or-self): a
  //     self-selecting [n] re-invokes speech on the same node — infinite
  //     recursion, empty output (observed 2026-08-09). The merged-operand
  //     case is handled by the dedicated intent-arity1-merged rule instead.
  var ARG = function (n) { return './/*[@ext-argname="' + n + '"]'; };
  var PRIO = 'priority=1000';
  var RULES = {};
  RULES[RULES_LOCALE + '/rules/intent'] = {
    domain: 'clearspeak', locale: RULES_LOCALE, modality: 'speech',
    inherits: 'base',
    rules: [
      ['Rule', 'intent-arity0', 'default',
        '[t] @ext-open',
        'self::*[@ext-arity="0"]', PRIO],
      ['Rule', 'intent-arity1', 'default',
        '[t] @ext-open; [n] ' + ARG('a') + '; [t] @ext-close',
        'self::*[@ext-arity="1"]', PRIO],
      // MERGED arity-1: when the annotated span is a lone token (\vecof's
      // bold mi), SRE's semantic collapse folds the operand node into the
      // wrapper node itself — self then carries BOTH ext-arity and
      // ext-argname, and intent-arity1's descendant lookup finds nothing
      // ("the vector" bug, 2026-08-09). Speak the token's own text;
      // [t] text() cannot recurse. Higher priority so it wins when both match.
      ['Rule', 'intent-arity1-merged', 'default',
        '[t] @ext-open; [t] text(); [t] @ext-close',
        'self::*[@ext-arity="1"]', 'self::*[@ext-argname]', 'priority=1100'],
      ['Rule', 'intent-arity2', 'default',
        '[t] @ext-open; [n] ' + ARG('a') + '; [t] @ext-mid1; [n] ' + ARG('b') +
        '; [t] @ext-close',
        'self::*[@ext-arity="2"]', PRIO],
      ['Rule', 'intent-arity3', 'default',
        '[t] @ext-open; [n] ' + ARG('a') + '; [t] @ext-mid1; [n] ' + ARG('b') +
        '; [t] @ext-mid2; [n] ' + ARG('c') + '; [t] @ext-close',
        'self::*[@ext-arity="3"]', PRIO],
      // \speakas — an author's literal string. Deliberately matched by OUR
      // rule on OUR attribute rather than by SRE's shipped direct-speech rule
      // on ext-speech: because this rule set is registered for clearspeak only,
      // MathSpeak ignores ext-say entirely and keeps reading verbatim.
      // Higher priority than the concept rules so an explicit author override
      // wins if both ever land on one node. Terminal, by design.
      ['Rule', 'intent-say', 'default',
        '[t] @ext-say',
        'self::*[@ext-say]', 'priority=2000']
    ]
  };

  // -------------------------------------------------------------------------
  //  VOCABULARY — the single place to edit as the mapping grows.
  //
  //    open / mid1 / mid2 / close  phrasing around the arguments
  //    macro: [name, nargs, tex]   optional named command; #1..#n are its
  //                                arguments, \iarg marks argument slots
  //
  //  Arity is not declared: it comes from how many \iarg markers appear, so
  //  one entry serves whatever notation uses it. English only for now — make
  //  this per-locale before it grows.
  // -------------------------------------------------------------------------
  // >>> FILLED AT CONVERSION TIME BY THE LUA FILTER <<<
  // (finalize_intent_extension: per-document pruning + intent-groups
  // metadata; see build-lua-filter.py). Do not edit here — edit the JSON.
  // Shape: concept -> { open, mid1, mid2, close, mc?, macro: [name, nargs, tex] }
  //   or, for a used-but-group-disabled entry:
  //                 { off: true, macro: [name, nargs, plainTex] }
  // Off entries keep documents parseable while reading as raw notation: the
  // macro expands WITHOUT the \intent wrapper (plain notation, \iarg markers
  // already stripped by the build), and \intent{concept} acts as identity.
  var VOCAB = __VOCAB_JSON__;
  // >>> END FILLED <<<

  // Unknown concepts stay speakable: the open vocabulary was named so that
  // hyphens-to-spaces reads sensibly even to a consumer that knows nothing.
  function phrasesFor(concept, arity) {
    var v = VOCAB[concept] || {};
    var w = concept.replace(/-/g, ' ');
    return {
      open:  v.open  !== undefined ? v.open  : (arity ? w + ' of' : w),
      mid1:  v.mid1  !== undefined ? v.mid1  : 'and',
      mid2:  v.mid2  !== undefined ? v.mid2  : 'and',
      close: v.close !== undefined ? v.close : ''
    };
  }

  // -------------------------------------------------------------------------
  //  Config mutations. This script runs before the library, so we can add to
  //  window.MathJax directly and leave the filter's own config block untouched.
  // -------------------------------------------------------------------------
  var MJ = window.MathJax = window.MathJax || {};
  MJ.tex = MJ.tex || {};

  // 1. named commands, generated from the SAME table as the phrasing.
  //    configmacros is bundled in the combined components, so no loader entry.
  var macros = MJ.tex.macros = MJ.tex.macros || {};
  Object.keys(VOCAB).forEach(function (concept) {
    var v = VOCAB[concept];
    var m = v.macro;
    if (!m || macros[m[0]]) return;           // never clobber a user macro
    macros[m[0]] = v.off
      ? [m[2], m[1]]                          // disabled: plain notation, no wrapper
      : ['\\intent{' + concept + '}{' + m[2] + '}', m[1]];
  });

  // 2. make sure our TeX package is enabled.
  var pk = MJ.tex.packages = MJ.tex.packages || {};
  if (!pk['[+]']) pk['[+]'] = [];
  if (pk['[+]'].indexOf('intent') < 0) pk['[+]'].push('intent');

  // 3. composed mode needs the patched locale directory. Set it through the
  //    LOADER PATH ALIAS, not options.worker.maps: the a11y/speech component
  //    resolves [mathmaps] and then does new URL(value, location), which turns
  //    a relative path into an absolute one against the PAGE. Setting
  //    options.worker.maps instead leaves it relative, and the worker resolves
  //    it against its own URL under /sre/ — a silent 404 and no speech.
  if (RULES_DELIVERY === 'path' && MAPS_PATH) {
    var ld = MJ.loader = MJ.loader || {};
    ld.paths = ld.paths || {};
    if (!ld.paths.mathmaps) ld.paths.mathmaps = MAPS_PATH;
  }

  // -------------------------------------------------------------------------
  //  'inline' RULES DELIVERY  (Option C)
  //
  //  The problem: SRE loads its rules from JSON locale files, and there is no
  //  way to inject rules from the page. MathJax deletes SRE's `custom` loader
  //  before the options cross into the worker (GeneratorPool.ts:
  //  `delete this._options.custom`) because a function cannot survive
  //  postMessage. Data can cross that boundary; code cannot.
  //
  //  The opening: MathJax builds the worker from a small blob script that it
  //  constructs IN THE PAGE (HTMLAdaptor.createWorker), roughly
  //      self.maps = '<url>'; importScripts('<cdn>/sre/speech-worker.js');
  //  So we can prepend our own code to that blob. Inside the worker we wrap
  //  self.fetch, let the locale request complete as normal, merge our rules
  //  into the parsed JSON in memory, and hand the combined object back.
  //
  //  Nothing is downloaded for our sake and nothing is written anywhere. The
  //  locale file was already being fetched on every page load; we only modify
  //  the result in passing. Our rules travel inside the HTML (~1 KB).
  //
  //  CAVEAT: createWorker is not a documented extension point, so a MathJax
  //  upgrade could change its shape. Pin the MathJax version. On any failure we
  //  fall back to the original method, which costs only composed speech on
  //  complex arguments — the flat channel still works.
  // -------------------------------------------------------------------------
  function installWorkerPatch() {
    var HA;
    try {
      HA = MathJax._.adaptors.HTMLAdaptor.HTMLAdaptor;
    } catch (e) { HA = null; }
    if (!HA || !HA.prototype || typeof HA.prototype.createWorker !== 'function') {
      if (window.console) console.warn('[intent] createWorker not found; rules not injected');
      return false;
    }

    // Safe to embed in <script>: JSON.stringify handles quoting; we additionally
    // neutralise "<" so a stray "</script" cannot terminate the block early.
    function embed(value) {
      return JSON.stringify(value).replace(/</g, '\\u003c');
    }

    var original = HA.prototype.createWorker;

    HA.prototype.createWorker = function (listener, options) {
      try {
        var file = options.path + '/' + options.worker;
        var target = '/' + RULES_LOCALE + '.json';
        var content =
          'self.maps = ' + embed(options.maps) + ';\n' +
          'self.__intentRules = ' + embed(RULES) + ';\n' +
          'self.__intentTarget = ' + embed(target) + ';\n' +
          '(function () {\n' +
          '  var origFetch = self.fetch;\n' +
          '  self.fetch = function (url) {\n' +
          '    var p = origFetch.apply(self, arguments);\n' +
          '    if (String(url).indexOf(self.__intentTarget) < 0) return p;\n' +
          '    return p.then(function (r) { return r.json(); }).then(function (j) {\n' +
          '      for (var k in self.__intentRules) j[k] = self.__intentRules[k];\n' +
          '      return { json: function () { return Promise.resolve(j); } };\n' +
          '    });\n' +
          '  };\n' +
          '})();\n' +
          'importScripts(' + embed(file) + ');\n';

        var url = URL.createObjectURL(
          new Blob([content], { type: 'text/javascript' })
        );
        var webworker = new Worker(url);
        webworker.onmessage = listener;
        URL.revokeObjectURL(url);
        if (window.console) {
          console.log('[intent] worker patched; rules merged into' + target);
        }
        return webworker;
      } catch (err) {
        if (window.console) {
          console.error('[intent] worker patch failed, using original: ' + err.message);
        }
        return original.call(this, listener, options);
      }
    };
    return true;
  }

  // -------------------------------------------------------------------------
  //  SELF-TEST — replaces the old silent flat fallback.
  //
  //  Composed speech either works or it doesn't, and a reader has no way to
  //  tell. So after typesetting we check one thing: does any expression's
  //  generated speech actually contain one of the opening phrases we emitted?
  //  If not, the rules never reached SRE and every annotated expression is
  //  reading structurally.
  //
  //  Reported three ways, none of which disturbs the page:
  //    * console.error, for support staff and automated checks
  //    * data-intent-speech="degraded" on <html>, so a stylesheet can surface a
  //      visible notice if you want one, e.g.
  //        html[data-intent-speech="degraded"] body::before { content: "..." }
  //    * window.__intentStatus, for a test harness to read
  //
  //  Skipped unless the active ruleset is a ClearSpeak one, since our rules are
  //  deliberately clearspeak-only and MathSpeak is expected to read verbatim.
  // -------------------------------------------------------------------------
  function selfTest() {
    function report(state, detail) {
      window.__intentStatus = { state: state, detail: detail, phrases: EMITTED.slice() };
      try { document.documentElement.setAttribute('data-intent-speech', state); } catch (e) {}
      if (!window.console) return;
      if (state === 'ok') console.log('[intent] speech self-test OK — ' + detail);
      else if (state === 'skipped') console.log('[intent] speech self-test skipped — ' + detail);
      else console.error('[intent] SPEECH DEGRADED — ' + detail +
        '\n[intent] Annotated expressions are reading structurally. ' +
        'intent/MathCAT is unaffected. Check for a blocked worker (CSP), a ' +
        'MathJax version change, or a failed rules merge.');
    }

    if (!EMITTED.length) { report('skipped', 'no annotated expressions on this page'); return; }

    // Read the LIVE menu settings, not the static page config: MathJax merges
    // settings saved in localStorage ('MathJax-Menu-Settings') over the page
    // config at startup, so the page may not be in the mode the config baked in.
    var settings = null;
    try { settings = MathJax.startup.document.menu.settings; } catch (e) {}

    // In hidden-MathML (MathCat) mode, MathJax speech is off by design, so an
    // absence of composed speech is EXPECTED, not degradation. Without this
    // check, every load of a page last left in MathCat mode logs a false alarm.
    if (settings && (settings.assistiveMml || !settings.speech)) {
      report('skipped', 'page is in hidden-MathML (MathCat) mode — MathJax ' +
        'speech is off, so composed speech is expected to be absent. Switch ' +
        'to MathJax-speech mode and reload to test the SRE channel.');
      return;
    }

    var ruleset = '';
    try {
      ruleset = (settings && settings.speechRules) ||
        MathJax.startup.document.options.menuOptions.settings.speechRules || '';
    } catch (e) {}
    if (ruleset.indexOf('clearspeak') !== 0) {
      report('skipped', 'ruleset is "' + (ruleset || 'unknown') +
        '"; our rules are clearspeak-only by design');
      return;
    }

    var containers = document.querySelectorAll('mjx-container[data-semantic-speech-none]');
    if (!containers.length) {
      report('degraded', 'no speech was attached to any expression');
      return;
    }
    for (var i = 0; i < containers.length; i++) {
      var said = containers[i].getAttribute('data-semantic-speech-none') || '';
      for (var j = 0; j < EMITTED.length; j++) {
        if (EMITTED[j] && said.indexOf(EMITTED[j]) >= 0) {
          report('ok', 'composed phrasing found in generated speech');
          return;
        }
      }
    }
    report('degraded', 'speech was attached but contains none of our ' +
      EMITTED.length + ' opening phrases');
  }

  // -------------------------------------------------------------------------
  //  TeX package registration, chained onto any existing startup.ready.
  // -------------------------------------------------------------------------
  MJ.startup = MJ.startup || {};
  var priorReady = MJ.startup.ready;

  MJ.startup.ready = function () {
    // STATIC-MATHML PAGES (2026-08-09): when the math was converted to MathML
    // at document-conversion time (Accessible STEM platform), the TeX commands
    // below never run in the browser, so EMITTED would stay empty and the
    // self-test would report 'skipped'. Seed the expected phrases from the
    // ext-open attributes already sitting in the page's MathML instead. The
    // library loads deferred, so the DOM is parsed by the time ready() runs;
    // this must happen BEFORE typesetting replaces the raw MathML.
    try {
      var pre = document.querySelectorAll('[ext-open]');
      for (var pi = 0; pi < pre.length; pi++) {
        var ph = pre[pi].getAttribute('ext-open');
        if (ph && EMITTED.indexOf(ph) < 0) EMITTED.push(ph);
      }
    } catch (e) { /* non-fatal */ }

    try {
      var tex = MathJax._.input.tex;
      var Configuration = tex.Configuration.Configuration;
      var CommandMap = tex.TokenMap.CommandMap;
      var HT = tex.HandlerTypes;
      var NU = tex.NodeUtil.default || tex.NodeUtil;

      // An INFERRED mrow cannot reliably hold attributes — they are dropped
      // when the row flattens. Promote it, exactly as MathJax's own \href does
      // via GetArgumentMML. Without this, \iarg{x+y} silently loses its slot
      // and a two-argument concept reports arity 1.
      function solidify(parser, node) {
        if (!NU.isInferred(node)) return node;
        var mrow = parser.create('node', 'mrow');
        NU.copyChildren(node, mrow);
        NU.copyAttributes(node, mrow);
        return mrow;
      }

      // Collect slot -> node, but do NOT descend into an already-annotated
      // construct: its slots are its own. Without this an outer concept
      // absorbs its child's arity and repeats an operand.
      function collectSlots(node, found, depth) {
        if (!node || !node.attributes) return;
        var s = node.attributes.getExplicit('ext-argname');
        if (s != null && !found[s]) found[s] = node;
        if (depth > 0 && node.attributes.getExplicit('ext-intent') != null) return;
        var kids = node.childNodes || [];
        for (var i = 0; i < kids.length; i++) collectSlots(kids[i], found, depth + 1);
      }

      // Text of a bare token, looking through single-child wrappers. Returns
      // null for anything structural, which is how flat mode knows it cannot
      // build a complete string.
      function tokenText(node) {
        if (!node) return null;
        if (typeof node.getText === 'function') return node.getText() || null;
        var kids = (node.childNodes || []).filter(function (k) { return k; });
        return kids.length === 1 ? tokenText(kids[0]) : null;
      }

      function joinPhrase(parts) {
        return parts.filter(function (s) {
          return s !== null && s !== undefined && String(s).trim() !== '';
        }).join(' ');
      }

      // \iarg{op} -> slot "a";  \iarg[b]{op} -> slot "b"
      function Iarg(parser, name) {
        var slot = parser.GetBrackets(name, 'a');
        var operand = solidify(parser, parser.ParseArg(name));
        operand.attributes.set('arg', slot);          // MathML 4, for MathCAT
        operand.attributes.set('ext-argname', slot);  // carrier, for SRE
        parser.Push(operand);
      }

      // \intent{concept}{span}
      function Intent(parser, name) {
        var concept = parser.GetArgument(name);       // literal text, not parsed
        var span = solidify(parser, parser.ParseArg(name));

        // Group-disabled entry: identity. The span typesets; no attributes on
        // either channel — raw-symbol reading, the authors' safety fallback.
        var v0 = VOCAB[concept];
        if (v0 && v0.off) { parser.Push(span); return; }

        var found = {};
        collectSlots(span, found, 0);
        var slots = Object.keys(found).sort();
        var arity = slots.length;
        var p = phrasesFor(concept, arity);
        // MathCAT channel name: the recorded MathCAT spelling when the build
        // says to prefer it, else our (list-aligned) concept name.
        var cname = (MATHCAT_NAMES === 'mathcat' && v0 && v0.mc) ? v0.mc : concept;
        var args = arity
          ? '(' + slots.map(function (s) { return '$' + s; }).join(',') + ')'
          : '';

        var attrs = { intent: cname + args };         // MathCAT channel, always
        var expr = concept + args;                    // ext channel: list name

        // Composed channel. Matched only by our clearspeak rules, so MathSpeak
        // is never touched. No ext-speech is emitted here — see SPEECH DESIGN
        // at the top of this file for why an automatic flat string would
        // override MathSpeak and would not protect against worker failure.
        attrs['ext-intent'] = expr;
        attrs['ext-arity'] = String(arity);
        attrs['ext-open'] = p.open;
        attrs['ext-close'] = p.close;
        if (arity >= 2) attrs['ext-mid1'] = p.mid1;
        if (arity >= 3) attrs['ext-mid2'] = p.mid2;

        if (p.open && EMITTED.indexOf(p.open) < 0) EMITTED.push(p.open);

        if (arity === 0) {
          // annotate the span itself. NEVER add a single-child wrapper row:
          // such rows collapse during semantic analysis and the annotation on
          // them is lost.
          Object.keys(attrs).forEach(function (k) { span.attributes.set(k, attrs[k]); });
          parser.Push(span);
        } else {
          parser.Push(parser.create('node', 'mrow', [span], attrs));
        }
      }

      // \speakas{string}{span} — explicit per-expression override for notation
      // the vocabulary cannot express.
      //
      // Uses ext-say, matched by our own clearspeak-only rule, so MathSpeak
      // ignores it and keeps reading verbatim. NOT ext-speech, which SRE
      // matches in every domain and would override MathSpeak.
      //
      // Consequence: this now depends on our rules being delivered. If they
      // are not, the string is ignored and the expression reads structurally —
      // which the self-test will report. That is the intended trade: never
      // touch MathSpeak, and fail loudly rather than silently.
      function SpeakAs(parser, name) {
        var text = parser.GetArgument(name);
        var span = solidify(parser, parser.ParseArg(name));
        span.attributes.set('ext-say', text);
        if (text && EMITTED.indexOf(text) < 0) EMITTED.push(text);
        parser.Push(span);
      }

      new CommandMap('intentMap', {
        intent: [Intent], iarg: [Iarg], speakas: [SpeakAs]
      });

      var handler = {};
      handler[HT.HandlerType.MACRO] = ['intentMap'];
      var conf = {};
      conf[HT.ConfigurationType.HANDLER] = handler;
      Configuration.create('intent', conf);

      if (window.console) {
        console.log('[intent] registered — delivery: ' + RULES_DELIVERY +
          (RULES_DELIVERY === 'path' ? ' (' + MAPS_PATH + ')' : '') +
          ', concepts: ' + Object.keys(VOCAB).length);
      }
    } catch (err) {
      if (window.console) {
        console.error('[intent] registration FAILED: ' + err.message);
        try {
          console.error('[intent] MathJax._.input.tex keys: ' +
            Object.keys(MathJax._.input.tex).join(', '));
        } catch (e2) { console.error('[intent] MathJax._.input.tex unreachable'); }
      }
    }

    // Must run before the worker is created, i.e. before defaultReady().
    if (RULES_DELIVERY === 'inline') installWorkerPatch();

    if (typeof priorReady === 'function') priorReady.call(MathJax.startup);
    else MathJax.startup.defaultReady();

    // Report whether composed speech actually happened. 2.5s lets the speech
    // worker finish; the button in the test page can re-run it sooner.
    try {
      if (MathJax.startup && MathJax.startup.promise) {
        MathJax.startup.promise.then(function () { setTimeout(selfTest, 2500); });
      }
    } catch (e) { /* non-fatal */ }
    window.__intentSelfTest = selfTest;
  };
})();
]==]

-- MathJax 4 combined component: TeX + MathML input, CommonHTML output.
local MATHJAX_SCRIPT = [==[
<script defer src="https://cdn.jsdelivr.net/npm/mathjax@__MATHJAX_VERSION__/tex-mml-chtml.js"></script>
]==]

-- ===================================================================
--  Toggle button  (Option A: one labeled button that names the active
--  mode, switches on click, and announces via an aria-live region)
-- ===================================================================

local TOGGLE_STYLE = [==[
<style id="amt-style">
#amt-bar{display:inline-flex;align-items:center;gap:.45rem;margin:0 0 1.15rem;padding:.42rem .85rem;border:1px solid #2b426e;border-radius:999px;background:#fff;color:#2b426e;cursor:pointer;font:600 .85rem/1.15 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:32px;}
#amt-bar:hover{background:#f2f5fb;}
#amt-bar:focus-visible{outline:3px solid #a51c30;outline-offset:2px;}
#amt-bar .amt-swap{font-size:1rem;line-height:1;}
</style>
]==]

local TOGGLE_SCRIPT = [==[
<script>
(function () {
  var START = "__START_MODE__";
  var TXT = {
    mathjax: {
      label: 'Math reading: MathJax speech',
      aria:  'Math reading mode: MathJax speech with subtitles. Activate to switch to hidden MathML for MathCat.',
      announce: 'MathJax speech mode. Each equation is voiced, with its speech shown on screen while you explore it.'
    },
    mathcat: {
      label: 'Math reading: Hidden MathML (MathCat)',
      aria:  'Math reading mode: hidden MathML for MathCat. Activate to switch to MathJax speech.',
      announce: 'MathCat mode. Hidden MathML; your screen reader reads and navigates the math.'
    }
  };
  var mode = (START === 'mathcat') ? 'mathcat' : 'mathjax';

  function getPool() {
    var doc = window.MathJax && MathJax.startup && MathJax.startup.document;
    var menu = doc && doc.menu;
    return (menu && menu.menu && menu.menu.pool) || null;
  }
  function setVar(pool, name, value) {
    try { var v = pool.lookup(name); if (v) v.setValue(value); }
    catch (e) { /* setting absent in this build -- ignore */ }
  }

  function build() {
    if (document.getElementById('amt-bar')) return;

    // Inline fallback styles, in case the <style> block is ever stripped.
    var styBtn = 'display:inline-flex;align-items:center;gap:.45rem;margin:0 0 1.15rem;padding:.42rem .85rem;border:1px solid #2b426e;border-radius:999px;background:#fff;color:#2b426e;cursor:pointer;font:600 .85rem/1.15 system-ui,-apple-system,sans-serif;min-height:32px';
    var styStatus = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);clip-path:inset(50%);overflow:hidden';

    var btn = document.createElement('button');
    btn.id = 'amt-bar';
    btn.type = 'button';
    btn.style.cssText = styBtn;
    btn.setAttribute('aria-label', TXT[mode].aria);
    btn.innerHTML =
      '<span class="amt-swap" aria-hidden="true">\u21C4</span>' +
      '<span class="amt-text"></span>';

    var status = document.createElement('div');
    status.id = 'amt-status';
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = styStatus;

    // Host: the menu-fix wrapper when present (so the button lines up with
    // the centered text column), else the body. First children of the host:
    // ahead of a template title or body <h1>, so the control is early in both
    // reading and focus order.
    var host = document.getElementById('pandoc-mjx-menu-fix') || document.body;
    host.insertBefore(status, host.firstChild);
    host.insertBefore(btn, host.firstChild);

    var textEl = btn.querySelector('.amt-text');

    function setUI(m) {
      textEl.textContent = TXT[m].label;
      btn.setAttribute('aria-label', TXT[m].aria);
      status.textContent = TXT[m].announce;
    }
    setUI(mode); // provisional label (START_MODE) until MathJax is ready

    // Ground truth for the current mode. MathJax merges menu settings saved
    // in localStorage over the page config at startup, and every menu
    // variable setter (including the ones this button drives) persists to
    // localStorage -- so the page can boot in EITHER mode, whatever
    // START_MODE says. The assistiveMml variable IS the mode.
    function actualMode(pool) {
      try {
        var v = pool && pool.lookup('assistiveMml');
        if (v) return v.getValue() ? 'mathcat' : 'mathjax';
      } catch (e) { /* pool shape changed -- fall back to last-known label */ }
      return mode;
    }

    function whenReady(fn) {
      if (!window.MathJax || !MathJax.startup || !MathJax.startup.promise) return;
      MathJax.startup.promise.then(function () { fn(getPool()); });
    }

    function applyMode(pool, m) {
      if (pool) {
        if (m === 'mathjax') {
          setVar(pool, 'enrich', true);       // MUST be first: gates the subsystem
          setVar(pool, 'subtitles', true);
          setVar(pool, 'speech', true);       // clears assistiveMml; re-renders
        } else {
          setVar(pool, 'assistiveMml', true); // clears speech & braille; re-renders
          setVar(pool, 'enrich', false);
        }
      }
      mode = m;
      setUI(m);
    }

    btn.addEventListener('click', function () {
      whenReady(function (pool) {
        // Flip from the ACTUAL mode, not from the label: covers a stale
        // boot label and mode changes made via the context menu.
        applyMode(pool, actualMode(pool) === 'mathjax' ? 'mathcat' : 'mathjax');
      });
    });

    // Correct the provisional label once MathJax has applied any saved
    // settings. Without this, a page last left in MathCat mode boots with
    // hidden MathML ON while announcing "MathJax speech" (found 2026-08-05
    // via NVDA: MathCAT was read in "both" modes -- they were the same mode).
    whenReady(function (pool) {
      var m = actualMode(pool);
      if (m !== mode) { mode = m; setUI(m); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
</script>
]==]

-- ===================================================================
--  Context-menu fix pieces
-- ===================================================================

-- Unique id for the wrapper (also referenced by the toggle script above),
-- namespaced so its CSS can't collide with Pandoc's or another filter's.
local MENU_FIX_ID = 'pandoc-mjx-menu-fix'

-- Pins the body to full width and re-creates the page column (width =
-- WRAP_MAX_WIDTH, padded, with a small-screen value) on the wrapper
-- instead. Rendered AFTER Pandoc's style block, so the body rules win by
-- cascade order; !important guards them against other overrides.
local MENU_FIX_STYLE = [==[
<style id="pandoc-mjx-menu-fix-style">
/* mathjax-mode-toggle.lua: MathJax context-menu positioning fix.
   Body CSS that centers with auto margins + a max-width (Pandoc's stock
   stylesheet, many custom ones) makes MathJax submenus open on top of
   their parent menu (offsetLeft is body-relative, placement is
   viewport-relative). Body is pinned full-width; the page column moves onto
   the wrapper div this filter adds around the content. */
body { max-width: none !important; margin: 0 !important; padding: 0 !important; }
/* content-box + the same padding values as Pandoc's stock body rule, so at
   36em the column is pixel-identical to stock. Safe at any width: the
   wrapper's width stays auto, so padding can never cause overflow. */
#pandoc-mjx-menu-fix { max-width: __WRAP_MAX_WIDTH__; margin: 0 auto;
  padding: 50px; box-sizing: content-box; }
@media (max-width: 600px) { #pandoc-mjx-menu-fix { padding: 12px; } }
</style>
]==]

-- ===================================================================
--  Implementation below -- no need to edit.
-- ===================================================================

-- Bake the chosen start mode into the script, and the chosen column width
-- into the menu-fix style. (Function replacements so characters like the
-- '%' in '100%' can't be misread as gsub captures.)
MATHJAX_SCRIPT = MATHJAX_SCRIPT
  :gsub('__MATHJAX_VERSION__', function() return MATHJAX_VERSION end)

CUSTOM_EXTENSION_JS = CUSTOM_EXTENSION_JS
  :gsub('__RULES_DELIVERY__', function() return RULES_DELIVERY end)
  :gsub('__MAPS_PATH__', function() return MAPS_PATH end)
  :gsub('__MATHCAT_NAMES__', function() return MATHCAT_NAMES end)

TOGGLE_SCRIPT = TOGGLE_SCRIPT:gsub('__START_MODE__',
  function() return START_MODE end)
MENU_FIX_STYLE = MENU_FIX_STYLE:gsub('__WRAP_MAX_WIDTH__',
  function() return WRAP_MAX_WIDTH end)

local has_math = false

local math_texts = {}
function Math(el)
  has_math = true
  math_texts[#math_texts + 1] = el.text
end

local function append_header_includes(meta, html_chunks)
  local additions = {}
  for _, html in ipairs(html_chunks) do
    additions[#additions + 1] =
      pandoc.MetaBlocks({ pandoc.RawBlock('html', html) })
  end

  local existing = meta['header-includes']
  if existing == nil then
    meta['header-includes'] = pandoc.MetaList(additions)
  elseif pandoc.utils.type(existing) == 'List' then
    for _, a in ipairs(additions) do
      existing[#existing + 1] = a
    end
    meta['header-includes'] = existing
  else
    local combined = { existing }
    for _, a in ipairs(additions) do
      combined[#combined + 1] = a
    end
    meta['header-includes'] = pandoc.MetaList(combined)
  end
end

function Pandoc(doc)
  if not has_math then
    return doc
  end

  -- 1. Suppress Pandoc's own MathJax head script.
  doc.meta.math = false

  -- 2. Head pieces, in order: config, custom extension (if any), library,
  --    then the optional feature blocks (each behind its switch).
  local head = { MATHJAX_CONFIG }
  CUSTOM_EXTENSION_JS = finalize_intent_extension(
    CUSTOM_EXTENSION_JS, doc.meta, math_texts)
  if CUSTOM_EXTENSION_JS:match('%S') then
    head[#head + 1] = '<script>\n' .. CUSTOM_EXTENSION_JS .. '\n</script>'
  end
  head[#head + 1] = MATHJAX_SCRIPT
  if INSERT_TOGGLE then
    head[#head + 1] = TOGGLE_STYLE
    head[#head + 1] = TOGGLE_SCRIPT
  end
  if FIX_MENU_CSS then
    head[#head + 1] = MENU_FIX_STYLE
  end
  append_header_includes(doc.meta, head)

  -- 3. Menu fix, markup half: wrap the document content in the centered
  --    column the CSS above styles.
  if FIX_MENU_CSS then
    doc.blocks = pandoc.Blocks({
      pandoc.Div(doc.blocks, pandoc.Attr(MENU_FIX_ID)),
    })
  end

  return doc
end
