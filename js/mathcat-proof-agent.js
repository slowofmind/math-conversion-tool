/* js/mathcat-proof-agent.js — MathCAT proofing agent for the preview frame.
 *
 * Plan: PLAN-MATHCAT-SPEECH-PROOFING.md, sections 2.4-2.6.
 * Runs INSIDE the sandboxed preview (sandbox="allow-scripts", opaque origin).
 * The platform inlines this file's text into the preview srcdoc while
 * proofing is on (M3, M16), so it must stay a classic script and must never
 * contain the character sequences that end or escape an inline <script>
 * (js/mathcat-proof.js refuses to inject it if it does).
 *
 *   M12  MathJax expressions: popup on focusin / removed on focusout of
 *        <mjx-container> (the moment MathJax shows/removes its subtitle).
 *        MathJax already makes each container a tab stop; nothing is added.
 *   M13  Plain <math>: popup on click; click elsewhere or Escape hides.
 *        No tabindex is added, so NVDA's view of the page is unchanged.
 *   M5   The MathML sent for speech is rebuilt the way NVDA rebuilds it
 *        (ia2Web.py Math._get_mathMl): inner markup, comments stripped,
 *        wrapped in a new <math xml:lang>. Root attributes are dropped.
 *   M6   Popup = line-for-line port of MathJax 4.1.3 LiveRegion/StringRegion
 *        (ts/a11y/explorer/Region.ts). All looks live in one preset.
 *   M11  MathCAT errors are shown in the popup, marked as errors.
 *
 * Navigation (PLAN-MATHCAT-NAVIGATION.md): one marked block at the end of this
 * file, with its switches at the top of that block, and three lines marked
 * "navigation hook" (N21).
 */
(function (window) {
  'use strict';
  var document = window.document;
  var CLASS = 'ASTEM_MathCAT_Region';
  var SHEET_ID = 'ASTEM-MathCAT-Region-styles';
  var MSG_SPEAK = 'mathcat-proof:speak';
  var MSG_SPEECH = 'mathcat-proof:speech';
  var MSG_READY = 'mathcat-proof:ready';
  var NBSP = '\u00a0';
  var COMMENT_RE = new RegExp('<' + '!--[\\s\\S]*?--' + '>', 'g');

  // ---- style presets (M6) --------------------------------------------------
  // 'mathjax-4.1.3': the LiveRegion box rules of MathJax 4.1.3 with the class
  // renamed and the variables it uses namespaced (--mjx-* -> --astem-mc-*).
  // MathJax's explorer highlight rules are deliberately NOT copied: they style
  // MathJax output, which this tool must never touch. Test T3 checks every
  // box value against MathJax's own sheet in light and dark schemes.
  // A later, visually distinct preset only needs a new entry here.
  var C = '.' + CLASS;
  var PRESETS = {
    'mathjax-4.1.3': {
      css: [
        ':root {',
        '  --astem-mc-fg-black: 0, 0, 0;',
        '  --astem-mc-bg-blue: 0, 0, 255;',
        '  --astem-mc-live-bg-color: white;',
        '  --astem-mc-live-shadow-color: #888;',
        '  --astem-mc-live-border-color: #CCCCCC;',
        '  --astem-mc-bg1-color: rgba(var(--astem-mc-bg-blue), var(--astem-mc-bg1-alpha));',
        '  --astem-mc-fg1-color: rgba(var(--astem-mc-fg-black), 1);',
        '  --astem-mc-bg1-alpha: 0.2;',
        '}',
        '@media (prefers-color-scheme: dark) {',
        '  :root {',
        '    --astem-mc-bg-blue: 132, 132, 255;',
        '    --astem-mc-fg-black: 255, 255, 255;',
        '    --astem-mc-live-bg-color: #222025;',
        '    --astem-mc-live-shadow-color: black;',
        '    --astem-mc-live-border-color: #7C7C7C;',
        '    --astem-mc-bg1-alpha: 0.3;',
        '  }',
        '}',
        C + ' {',
        '  position: absolute;', '  top: 0;', '  display: none;', '  width: auto;',
        '  height: auto;', '  padding: 0;', '  opacity: 1;', '  z-index: 202;',
        '  left: 0;', '  right: 0;', '  margin: 0 auto;',
        '  background-color: var(--astem-mc-live-bg-color);',
        '  box-shadow: 0px 5px 20px var(--astem-mc-live-shadow-color);',
        '  border: 2px solid var(--astem-mc-live-border-color);',
        '}',
        C + '_Show {', '  display: block;', '}',
        C + ' > div {',
        '  color: var(--astem-mc-fg1-color);',
        '  background-color: var(--astem-mc-bg1-color);',
        '}',
        // --- additions (not in MathJax) ---
        C + ' > ' + C + '_meta {',          // version line (M6, kept for now)
        '  background-color: transparent;', '  font-size: 75%;', '  opacity: 0.75;',
        '}',
        C + '_error > div:first-child {', '  font-style: italic;', '}',
      ].join('\n'),
    },
  };
  var preset = PRESETS['mathjax-4.1.3'];

  // ---- the region: port of AbstractRegion / StringRegion / SpeechRegion -----
  function Region(doc) {
    this.doc = doc; this.win = doc.defaultView;
    this.div = null; this.inner = null; this.meta = null;
    this.AddStyles();
  }
  Region.prototype.AddStyles = function () {                 // Region.ts L127-140
    if (this.doc.getElementById(SHEET_ID)) return;
    var node = this.doc.createElement('style');
    node.id = SHEET_ID;
    node.textContent = preset.css;
    (this.doc.head || this.doc.documentElement).appendChild(node);
  };
  Region.prototype.AddElement = function () {                // L145-155
    if (this.div) return;
    var element = this.doc.createElement('div');
    element.classList.add(CLASS);
    element.setAttribute('aria-hidden', 'true');             // addition (M6)
    this.div = element;
    this.inner = this.doc.createElement('div');
    this.div.appendChild(this.inner);
    this.meta = this.doc.createElement('div');               // addition (M6)
    this.meta.className = CLASS + '_meta';
    this.div.appendChild(this.meta);
    this.doc.body.appendChild(this.div);
  };
  Region.prototype.Show = function (node) {
    this.Update(NBSP);                                       // SpeechRegion.Show L511-515
    this.AddElement();                                       // AbstractRegion.Show L160-164
    this.position(node);
    this.div.classList.add(CLASS + '_Show');
  };
  Region.prototype.Hide = function () {                      // L176-181
    if (!this.div) return;
    this.div.remove();
    this.div = null; this.inner = null; this.meta = null;
  };
  Region.prototype.Update = function (speech) {             // StringRegion L276-285
    if (speech) this.AddElement();
    if (this.inner) {
      this.inner.textContent = '';
      this.inner.textContent = speech || NBSP;
    }
  };
  Region.prototype.setMeta = function (text) {               // addition (M6)
    if (this.meta) this.meta.textContent = text || '';
  };
  Region.prototype.setError = function (on) {                // addition (M11)
    if (this.div) this.div.classList.toggle(CLASS + '_error', !!on);
  };
  Region.prototype.position = function (node) {              // StringRegion L290-292
    this.stackRegions(node);
  };
  Region.prototype.stackRegions = function (node) {          // AbstractRegion L194-223
    var rect = node.getBoundingClientRect();
    var baseBottom = 0;
    var baseLeft = Number.POSITIVE_INFINITY;
    var regions = this.doc.getElementsByClassName(CLASS + '_Show');
    for (var i = 0, region; (region = regions[i]); i++) {
      if (region !== this.div) {
        baseBottom = Math.max(region.getBoundingClientRect().bottom, baseBottom);
        baseLeft = Math.min(region.getBoundingClientRect().left, baseLeft);
      }
    }
    var bot = (baseBottom ? baseBottom : rect.bottom + 10) + this.win.scrollY;
    var left = (baseLeft < Number.POSITIVE_INFINITY ? baseLeft : rect.left) + this.win.scrollX;
    this.div.style.top = bot + 'px';
    this.div.style.left = left + 'px';
  };

  // ---- finding the MathML NVDA would read ---------------------------------
  function elementOf(t) {
    if (!t) return null;
    return t.nodeType === 1 ? t : t.parentElement || null;
  }
  // -> { kind: 'mathjax'|'plain', anchor, math } | null
  function findSource(target) {
    var el = elementOf(target);
    if (!el || !el.closest) return null;
    var container = el.closest('mjx-container');
    if (container) {
      // Hidden MathML present = MathCat Compatible mode. Absent = MathJax
      // speech mode, where NVDA does not use MathCAT: no popup.
      var hidden = container.querySelector('mjx-assistive-mml > math');
      return hidden ? { kind: 'mathjax', anchor: container, math: hidden } : null;
    }
    var math = el.closest('math');
    if (math && !math.closest('mjx-assistive-mml')) return { kind: 'plain', anchor: math, math: math };
    return null;
  }
  // NVDA ia2Web.py L333-385: "<math xml:lang=...>" + inner markup - comments.
  function rebuildForNVDA(math) {
    var inner = math.innerHTML.replace(COMMENT_RE, '');
    var host = math.closest('[lang]');
    var lang = host ? host.getAttribute('lang') : '';
    return '<math' + (lang ? ' xml:lang="' + lang + '"' : '') + '>' + inner + '</math>';
  }

  // ---- behaviour -----------------------------------------------------------
  var region = null;
  var active = null;      // { kind, anchor, math, id }
  var seq = 0;
  var navHooks = null;   // set by the navigation block at the end (PLAN-MATHCAT-NAVIGATION.md N21)

  function post(msg) { window.parent.postMessage(msg, '*'); }

  function activate(src) {
    if (typeof subtitleHooks === 'object' && subtitleHooks && !subtitleHooks.popupsOn()) return;   // subtitle settings hook (3.9)
    deactivate();
    if (!region) region = new Region(document);
    active = { kind: src.kind, anchor: src.anchor, math: src.math, id: ++seq };
    region.Show(src.anchor);
    // navigation hook (N21): the tagged copy, or null for the first plan's MathML
    var mathml = (navHooks && navHooks.activated(active)) || rebuildForNVDA(src.math);
    post({ type: MSG_SPEAK, id: active.id, mathml: mathml });
  }
  function deactivate() {
    if (navHooks) navHooks.deactivated();   // navigation hook (N21)
    if (region) region.Hide();
    active = null;
  }
  function onFocusIn(e) {
    var src = findSource(e.target);
    if (src && src.kind === 'mathjax' && !(active && active.anchor === src.anchor)) activate(src);
  }
  function onFocusOut(e) {
    if (!active || active.kind !== 'mathjax') return;
    var next = elementOf(e.relatedTarget);
    if (next && active.anchor.contains(next)) return;       // focus moved within the expression
    deactivate();
  }
  function onClick(e) {
    var src = findSource(e.target);
    if (src && src.kind === 'plain') {
      if (!(active && active.anchor === src.anchor)) activate(src);
      return;
    }
    if (active && active.kind === 'plain') deactivate();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape' && active && active.kind === 'plain') deactivate();
  }
  function onMessage(e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== MSG_SPEECH || !active || d.id !== active.id) return;   // stale or foreign
    if (d.ok) {
      region.setError(false);
      region.Update(d.text);
    } else {
      region.setError(true);
      region.Update('MathCAT error: ' + String(d.error || 'unknown').split('\n')[0]);
    }
    region.setMeta('MathCAT ' + d.version + ' \u00b7 NVDA ' + d.nvda);
  }
  function mode() {
    if (document.querySelector('mjx-assistive-mml > math')) return 'mathjax';
    var all = document.getElementsByTagName('math');
    for (var i = 0; i < all.length; i++) if (!all[i].closest('mjx-assistive-mml')) return 'plain';
    return 'none';
  }
  var started = false;
  function start() {
    if (started) return;
    started = true;
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('message', onMessage);
    post({ type: MSG_READY, mode: mode() });
  }
  function autostart() {
    var mj = window.MathJax;
    if (mj && mj.startup && mj.startup.promise) { mj.startup.promise.then(start, start); return; }
    if (mj && !mj.startup) {
      // MathJax config object present but the library has not loaded yet.
      window.addEventListener('load', function () {
        var m = window.MathJax;
        if (m && m.startup && m.startup.promise) m.startup.promise.then(start, start); else start();
      });
      return;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  window.__astemMathCATAgent = {
    start: start, findSource: findSource, rebuildForNVDA: rebuildForNVDA,
    createRegion: function (doc) { return new Region(doc || document); },
    PRESETS: PRESETS,
  };
  // ==== BEGIN navigation (PLAN-MATHCAT-NAVIGATION.md 3.4-3.7, 4, 9.1) =========
  // Sub-expression navigation in the popup: NVDA's keys (Appendix A), NVDA's
  // words for every step, the part MathCAT is on highlighted in the equation.
  // Ways back (N21): switch `navigation` off (below); or delete this block, down
  // to END navigation, which leaves the three "navigation hook" lines above
  // inert (navHooks stays null); or restore the pre-Phase B file from _backups.
  (function () {
    // ---- switches (N21); window.__ASTEM_MC_NAV_SWITCHES may override any ----
    var DEFAULTS = {
      navigation: true,        // master switch: off = exactly the first plan's agent
      freshStart: true,        // N19: first key after arriving or Escape starts from the whole expression
      renderActionHook: true,  // N18: our MathJax step at priority 195; off = page-level watcher only
      highlight: true,         // 3.7: highlight the part MathCAT is on
    };
    var given = window.__ASTEM_MC_NAV_SWITCHES;
    var switches = {};
    for (var name in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, name)) {
        switches[name] = given && typeof given[name] === 'boolean' ? given[name] : DEFAULTS[name];
      }
    }
    // ---- the key layer (3.5, N2, N4): NVDA gesture names -> NVDA command names,
    // exactly navCommands.py at release-2026.2 (test N-T2 compares the two). It
    // only produces command names; another driver can replace it.
    var KEY_TABLE = {
      'kb:leftArrow': 'MovePrevious', 'kb:rightArrow': 'MoveNext',
      'kb:upArrow': 'ZoomOut', 'kb:downArrow': 'ZoomIn',
      'kb:control+leftArrow': 'MoveCellPrevious', 'kb:control+alt+leftArrow': 'MoveCellPrevious',
      'kb:control+rightArrow': 'MoveCellNext', 'kb:control+alt+rightArrow': 'MoveCellNext',
      'kb:control+upArrow': 'MoveCellUp', 'kb:control+alt+upArrow': 'MoveCellUp',
      'kb:control+downArrow': 'MoveCellDown', 'kb:control+alt+downArrow': 'MoveCellDown',
      'kb:shift+leftArrow': 'ReadPrevious', 'kb:shift+rightArrow': 'ReadNext',
      'kb:shift+upArrow': 'ToggleZoomLockUp', 'kb:shift+downArrow': 'ToggleZoomLockDown',
      'kb:control+shift+leftArrow': 'DescribePrevious', 'kb:control+shift+rightArrow': 'DescribeNext',
      'kb:control+shift+upArrow': 'ZoomOutAll', 'kb:control+shift+downArrow': 'ZoomInAll',
      'kb:enter': 'WhereAmI', 'kb:control+enter': 'WhereAmIAll',
      'kb:space': 'ReadCurrent', 'kb:control+space': 'ReadCellCurrent',
      'kb:shift+space': 'ToggleSpeakMode', 'kb:control+shift+space': 'DescribeCurrent',
      'kb:home': 'MoveStart', 'kb:control+home': 'MoveLineStart', 'kb:shift+home': 'MoveColumnStart',
      'kb:end': 'MoveEnd', 'kb:control+end': 'MoveLineEnd', 'kb:shift+end': 'MoveColumnEnd',
      'kb:backspace': 'MoveLastLocation',
    };
    for (var d = 0; d < 10; d++) {            // placemarkers; "0" is placemarker 10 in NVDA
      KEY_TABLE['kb:' + d] = 'MoveTo' + d;
      KEY_TABLE['kb:control+' + d] = 'SetPlacemarker' + d;
      KEY_TABLE['kb:shift+' + d] = 'Read' + d;
      KEY_TABLE['kb:control+shift+' + d] = 'Describe' + d;
    }
    // Browser key (KeyboardEvent.code) -> NVDA key name. Digits by physical key,
    // because Shift+1 arrives as "!". Numpad keys have other NVDA names: not here.
    var CODE_NAMES = { ArrowLeft: 'leftArrow', ArrowRight: 'rightArrow', ArrowUp: 'upArrow',
      ArrowDown: 'downArrow', Enter: 'enter', Space: 'space', Home: 'home', End: 'end', Backspace: 'backspace' };
    var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    function keyToCommand(e) {
      if (!e || e.metaKey) return null;
      var code = String(e.code || '');
      var key = own(CODE_NAMES, code) ? CODE_NAMES[code] : (/^Digit[0-9]$/.test(code) ? code.slice(5) : null);
      if (key === null) return null;
      var gesture = 'kb:' + (e.ctrlKey ? 'control+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '') + key;
      return own(KEY_TABLE, gesture) ? KEY_TABLE[gesture] : null;
    }
    window.__astemMathCATAgent.nav = { switches: switches, KEY_TABLE: KEY_TABLE, keyToCommand: keyToCommand };
    if (!switches.navigation) return;         // N21: nothing below runs; the first plan's agent as it was

    var TAG = 'data-astem-mc';                // 3.4: one running number per element on MathJax pages
    var HL = 'data-astem-mc-hl';              // 3.7: the part MathCAT is on
    var MSG_NAV = 'mathcat-proof:nav';
    var MSG_NAVSPEECH = 'mathcat-proof:navspeech';
    var MJX_SHOWN = 'MJX_LiveRegion_Show';

    // ---- highlight look (N11, NV5): MathJax 4.1.3's priority-1 explorer
    // highlight (a11y/explorer/Region.js L219-239), attribute renamed, variables
    // namespaced as in the box rules, without the explorer-only
    // :not([data-mjx-collapsed]) guard. Test N-T4 reads MathJax's sheet.
    PRESETS['mathjax-4.1.3'].css += '\n' + [
      '[' + HL + '] {',
      '  color: var(--astem-mc-fg1-color) !important;',
      '  background-color: var(--astem-mc-bg1-color) !important;',
      '  fill: var(--astem-mc-fg1-color) !important;',
      '}',
    ].join('\n');

    // ---- stacking (N10): as the first plan's port of MathJax's stackRegions,
    // but MathJax's shown boxes count too, so ours never covers a MathJax
    // subtitle or braille box. With none showing, placement is unchanged (N-T7).
    Region.prototype.stackRegions = function (node) {
      var rect = node.getBoundingClientRect();
      var baseBottom = 0;
      var baseLeft = Number.POSITIVE_INFINITY;
      var lists = [this.doc.getElementsByClassName(CLASS + '_Show'), this.doc.getElementsByClassName(MJX_SHOWN)];
      for (var j = 0; j < lists.length; j++) {
        for (var i = 0, box; (box = lists[j][i]); i++) {
          if (box !== this.div) {
            baseBottom = Math.max(box.getBoundingClientRect().bottom, baseBottom);
            baseLeft = Math.min(box.getBoundingClientRect().left, baseLeft);
          }
        }
      }
      var bot = (baseBottom ? baseBottom : rect.bottom + 10) + this.win.scrollY;
      var left = (baseLeft < Number.POSITIVE_INFINITY ? baseLeft : rect.left) + this.win.scrollX;
      this.div.style.top = bot + 'px';
      this.div.style.left = left + 'px';
    };

    // ---- tagging, when the agent first runs (3.4, N7, N18) -----------------
    // Only a page where window.MathJax exists NOW is a MathJax page. Its source
    // <math> elements get numbers before MathJax draws them; MathJax copies them
    // into its drawing and its hidden MathML (NF7). Plain pages: nothing here.
    var mj = window.MathJax;
    var harvested = new WeakMap();            // mjx-container -> { inner, nums }
    if (mj) {
      tagSourceMath();
      // The library has not loaded yet only if startup.promise is absent (the
      // intent filter's config already defines startup.ready).
      if (switches.renderActionHook && !(mj.startup && mj.startup.promise)) addRenderAction(mj);
      else watchPage();                       // N18 fallback ("a")
    }
    function tagSourceMath() {
      var n = 0;
      var all = document.getElementsByTagName('math');
      for (var i = 0; i < all.length; i++) {
        if (all[i].closest('mjx-container')) continue;      // already drawn: nothing to tag
        var inner = all[i].querySelectorAll('*');
        for (var j = 0; j < inner.length; j++) inner[j].setAttribute(TAG, String(++n));
      }
    }
    function addRenderAction(m) {             // N18: after the arrow fix (190), before insertion (200)
      m.options = m.options || {};
      m.options.renderActions = m.options.renderActions || {};
      m.options.renderActions.astemMathCAT = [195,
        function (doc) { for (var item of doc.math) harvestItem(item); },   // a whole-page draw
        function (item) { harvestItem(item); },                               // one expression (re)drawn
      ];
    }
    function harvestItem(item) {
      if (item && item.typesetRoot && item.typesetRoot.nodeType === 1) harvest(item.typesetRoot);
    }
    function watchPage() {                    // one page-level watcher; harvests containers as they arrive
      var MO = window.MutationObserver;
      if (!MO) return;
      new MO(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) harvestWithin(added[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
      harvestWithin(document.documentElement);
    }
    function harvestWithin(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.localName === 'mjx-container') harvest(node);
      var cs = node.getElementsByTagName('mjx-container');
      for (var i = 0; i < cs.length; i++) harvest(cs[i]);
    }
    // Read one container's tagged hidden MathML once: keep the copy MathCAT gets
    // (tags turned into ids, existing ids reused, NF11), then remove the tags
    // from the hidden MathML NVDA reads. The visible mjx-* elements keep theirs.
    function harvest(c) {
      if (!c || harvested.has(c)) return;
      var hidden = c.querySelector('mjx-assistive-mml > math');
      if (!hidden || !hidden.querySelector('[' + TAG + ']')) return;
      var copy = hidden.cloneNode(true);
      var src = hidden.querySelectorAll('[' + TAG + ']');
      var dst = copy.querySelectorAll('[' + TAG + ']');
      var nums = Object.create(null);         // our tag -> number on the visible elements
      for (var i = 0; i < dst.length; i++) {
        var n = dst[i].getAttribute(TAG);
        var has = dst[i].hasAttribute('id');
        var tag = has ? dst[i].getAttribute('id') : 'astem-' + n;
        if (!has) dst[i].setAttribute('id', tag);
        dst[i].removeAttribute(TAG);
        src[i].removeAttribute(TAG);
        nums[tag] = n;
      }
      harvested.set(c, { inner: copy.innerHTML, nums: nums });
    }
    // As rebuildForNVDA (M5), for an inner part built here. `el` is the element
    // whose language NVDA would use (the <math>, or the hidden <math>).
    function wrap(inner, el) {
      var host = el.closest('[lang]');
      var lang = host ? host.getAttribute('lang') : '';
      return '<math' + (lang ? ' xml:lang="' + lang + '"' : '') + '>' + inner.replace(COMMENT_RE, '') + '</math>';
    }
    // Plain-MathML pages (N7): the page is never changed. A copy of the <math>
    // gets the numbers as ids; an in-memory list maps each back to its element.
    function buildPlain(math) {
      var copy = math.cloneNode(true);
      var live = math.querySelectorAll('*');
      var dup = copy.querySelectorAll('*');
      var byTag = Object.create(null);
      for (var i = 0; i < dup.length; i++) {
        var has = dup[i].hasAttribute('id');
        var tag = has ? dup[i].getAttribute('id') : 'astem-' + (i + 1);
        if (!has) dup[i].setAttribute('id', tag);
        (byTag[tag] = byTag[tag] || []).push(live[i]);
      }
      return { mathml: wrap(copy.innerHTML, math), elementsOf: function (t) { return byTag[t] || []; } };
    }
    // MathJax pages: the copy harvested at draw time; highlight the visible
    // mjx-* elements, never the hidden MathML. No harvest (e.g. TeX input, N12):
    // null, so the first plan's MathML is sent and nothing is highlighted.
    function buildMathJax(container, hidden) {
      harvest(container);                     // a no-op when our step or the watcher did it
      var h = harvested.get(container);
      if (!h) return null;
      return { mathml: wrap(h.inner, hidden), elementsOf: function (t) {
        if (!own(h.nums, t)) return [];
        var out = [];
        var cand = container.querySelectorAll('[' + TAG + '="' + h.nums[t] + '"]');
        for (var i = 0; i < cand.length; i++) if (!cand[i].closest('mjx-assistive-mml')) out.push(cand[i]);
        return out;
      } };
    }
    // ---- behaviour -----------------------------------------------------------
    var state = null;       // the open popup's navigation state, or null
    var navSeq = 0;         // counter on every request; only the latest reply is shown
    var lit = [];           // elements carrying the highlight
    var removal = null;     // closes the popup when its equation leaves the page
    var listening = false;
    function activated(a) {
      if (!listening) {     // registered after the first plan's listener (start()), so the
        listening = true;   // whole-expression reply is already on screen when we read it
        window.addEventListener('message', onNavMessage);
      }
      var built = a.kind === 'plain' ? buildPlain(a.math) : buildMathJax(a.anchor, a.math);
      state = { id: a.id, anchor: a.anchor, kind: a.kind,
        mathml: built ? built.mathml : rebuildForNVDA(a.math),
        elementsOf: built ? built.elementsOf : function () { return []; },
        keyed: false,       // a key was pressed since arriving or Escape (N19, N22)
        navigating: false,  // Escape returns to the whole expression (N3)
        want: -1, whole: null, shown: null };
      watchRemoval(a.anchor);
      return built ? built.mathml : null;
    }
    function deactivated() {
      clearHighlight();
      if (removal) { removal.disconnect(); removal = null; }
      state = null;
    }
    function watchRemoval(anchor) {           // 9.3: a MathJax redraw replaces the container
      if (removal) removal.disconnect();
      removal = null;
      var MO = window.MutationObserver;
      if (!MO) return;
      removal = new MO(function () { if (active && active.anchor === anchor && !anchor.isConnected) deactivate(); });
      removal.observe(document.documentElement, { childList: true, subtree: true });
    }
    function onNavKeyDown(e) {
      var s = state;
      if (!s || !active || active.id !== s.id) return;
      if (s.kind === 'mathjax' && !s.anchor.contains(elementOf(e.target))) return;   // 3.5
      if (e.key === 'Escape') {
        if (!s.navigating) return;            // not navigating: the first plan's Escape
        e.preventDefault();
        e.stopImmediatePropagation();         // keeps the first plan from closing the popup
        backToWhole(s);
        return;
      }
      var command = keyToCommand(e);
      if (!command) return;                   // not a navigation key: passes through
      e.preventDefault();                     // arrows must not scroll the page
      var msg = { type: MSG_NAV, id: s.id, nav: ++navSeq, command: command, mathml: s.mathml };
      if (!s.keyed && switches.freshStart) msg.fresh = true;       // N19
      if (!s.keyed && command === 'ZoomIn') msg.entering = true;   // N22
      s.keyed = true;
      s.navigating = true;
      s.want = msg.nav;
      post(msg);
    }
    function backToWhole(s) {                 // N3: as on arriving
      s.keyed = false; s.navigating = false; s.want = -1; s.shown = null;
      clearHighlight();
      if (!region) return;
      region.setError(s.whole ? s.whole.error : false);
      region.Update(s.whole ? s.whole.text : NBSP);   // reply not in yet: the placeholder, as on arriving
    }
    function onNavMessage(e) {
      if (e.source !== window.parent) return;
      var d = e.data;
      var s = state;
      if (!d || !s || !region || d.id !== s.id) return;                    // stale or foreign
      if (d.type === MSG_SPEECH) {
        // The first plan's listener has just shown the whole-expression reply:
        // remember it for Escape. A late one never replaces a navigation step.
        s.whole = { text: region.inner ? region.inner.textContent : NBSP,
          error: !!(region.div && region.div.classList.contains(CLASS + '_error')) };
        if (s.navigating && s.shown) show(s.shown);
        return;
      }
      if (d.type !== MSG_NAVSPEECH || d.nav !== s.want) return;            // out of date
      s.shown = { ok: !!d.ok, text: String(d.text == null ? '' : d.text),
        tags: Array.isArray(d.highlightTags) ? d.highlightTags : [] };
      show(s.shown);
      region.setMeta('MathCAT ' + d.version + ' \u00b7 NVDA ' + d.nvda);
    }
    function show(v) {                        // the box stays anchored; only its text changes (N5)
      region.setError(!v.ok);                 // on failure: NVDA's message exactly (N6, N22)
      region.Update(v.text);
      highlight(v.tags);
    }
    function highlight(tags) {                // N20: whatever MathCAT is on, the whole equation included
      clearHighlight();
      if (!switches.highlight || !state) return;
      for (var i = 0; i < tags.length; i++) {
        var els = state.elementsOf(String(tags[i]));
        for (var j = 0; j < els.length; j++) { els[j].setAttribute(HL, ''); lit.push(els[j]); }
      }
    }
    function clearHighlight() {
      for (var i = 0; i < lit.length; i++) lit[i].removeAttribute(HL);
      lit = [];
    }
    // Before the first plan's keydown listener (start()), so Escape while
    // navigating is handled here (N3).
    document.addEventListener('keydown', onNavKeyDown);
    navHooks = { activated: activated, deactivated: deactivated };
  })();
  // ==== END navigation =========================================================
  // ==== BEGIN subtitle settings (PLAN-MATHCAT-NAVIGATION.md 3.9, N38, N39, N42-N45) ====
  // One setting for the math subtitles in this preview, chosen on the platform page:
  // Hide, MathCat or MathJax. Runs only when the platform put its one line just ahead
  // of this file (window.__ASTEM_MC_SUBTITLE_SETTINGS, N44); without the line this
  // block does nothing and the helper is exactly as before. It acts on the live
  // preview only: nothing here reaches the file or the download.
  //   MathCat  MathCAT popups on (navigation as built). MathJax: hidden MathML with
  //            enrichment off (N39): the page's own button if it has one and MathJax
  //            is in speech mode, else the button's two settings.
  //   MathJax  popups off. MathJax speech with subtitles on: from speech mode only
  //            `subtitles`; from hidden MathML the page's button, else its three settings.
  //   Hide     popups off and `subtitles` off; the mode is left alone (N42 a).
  // Starts at Hide by itself (N45). A setting that comes before MathJax's first visual
  // rendering is held and applied just after it. Reports to the platform: at start,
  // after the first visual rendering, after each redraw that changes the mode, after
  // each setting, and on each equation focus (subtitles re-read, 3.9). A setting is
  // changed only where it differs, so no needless redraw. Ways back: the platform's
  // switch; or delete this block, which leaves the "subtitle settings hook" line in
  // activate() inert.
  var subtitleHooks = (function () {
    if (window.__ASTEM_MC_SUBTITLE_SETTINGS !== true) return null;
    var MSG_MODE = 'mathcat-proof:mode';
    var MSG_SETMODE = 'mathcat-proof:setmode';
    var mj = window.MathJax;
    var hasMathJax = !!mj;                  // the kind of page, read as the navigation block does
    var choice = 'hide';
    var held = null;                        // a setting waiting for the first visual rendering
    var rendered = false;
    var settled = !hasMathJax;              // plain pages: nothing to wait for
    var lastMode = null;                    // 'hidden' (hidden MathML) or 'speech'

    function getPool() {                    // as the page's own button finds it
      var m = window.MathJax;
      var d = m && m.startup && m.startup.document;
      var menu = d && d.menu;
      return (menu && menu.menu && menu.menu.pool) || null;
    }
    function read(pool, name) {
      try { var v = pool.lookup(name); return v ? !!v.getValue() : false; } catch (e) { return false; }
    }
    function setIf(pool, name, value) {     // only what differs
      try {
        var v = pool.lookup(name);
        if (v && !!v.getValue() !== value) v.setValue(value);
      } catch (e) { /* setting absent in this build */ }
    }
    function modeOf(pool) { return read(pool, 'assistiveMml') ? 'hidden' : 'speech'; }
    function pageButton() { return document.getElementById('amt-bar'); }
    function report() {
      post({ type: MSG_MODE, choice: choice, mathjax: hasMathJax, pageButton: !!pageButton() });
    }
    function become(c) {                    // a change away from MathCat closes an open popup
      if (choice === 'mathcat' && c !== 'mathcat' && active) deactivate();
      choice = c;
    }
    function press(btn) {                   // the page's button acts once MathJax's start-up is
      btn.click();                          // done; report after it has
      var p = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
      if (p && typeof p.then === 'function') p.then(report, report); else report();
    }
    function apply(c) {
      become(c);
      var pool = hasMathJax ? getPool() : null;
      if (!pool) { report(); return; }
      var mode = modeOf(pool), btn = pageButton();
      if (c === 'mathcat') {
        if (btn && mode === 'speech') { press(btn); return; }
        setIf(pool, 'assistiveMml', true);
        setIf(pool, 'enrich', false);
      } else if (c === 'mathjax') {
        if (mode === 'speech') setIf(pool, 'subtitles', true);
        else if (btn) { press(btn); return; }
        else { setIf(pool, 'enrich', true); setIf(pool, 'subtitles', true); setIf(pool, 'speech', true);   // sitting 13: speech may already be on beside hidden MathML (script-tag files), so its setter would not clear it
               setIf(pool, 'assistiveMml', false); }
      } else {
        setIf(pool, 'subtitles', false);
      }
      report();
    }
    function fromPage(pool) {               // after a redraw that changed the mode (N38 a)
      return modeOf(pool) === 'hidden' ? 'mathcat' : (read(pool, 'subtitles') ? 'mathjax' : 'hide');
    }
    function onRender() {                   // each MathJax visual rendering
      var pool = getPool();
      if (!rendered) {
        rendered = true;
        lastMode = pool ? modeOf(pool) : null;
        setTimeout(settle, 0);              // after the page's own start-up (its button)
        return;
      }
      if (!pool) return;
      var mode = modeOf(pool);
      if (mode === lastMode) return;        // a redraw that keeps the mode keeps the setting
      lastMode = mode;
      if (!settled) return;
      become(fromPage(pool));
      report();
    }
    function settle() {
      settled = true;
      var pool = getPool();
      if (pool) lastMode = modeOf(pool);
      if (held !== null) { var c = held; held = null; apply(c); } else report();
    }
    window.addEventListener('message', function (e) {    // from the moment this runs (N45)
      if (e.source !== window.parent) return;
      var d = e.data;
      if (!d || d.type !== MSG_SETMODE) return;
      var c = d.choice;
      if (c !== 'hide' && c !== 'mathcat' && c !== 'mathjax') return;
      if (c === 'mathjax' && !hasMathJax) { report(); return; }   // refused: no MathJax here
      if (!settled) { held = c; return; }
      apply(c);
    });
    document.addEventListener('focusin', function (e) {  // re-read subtitles (3.9 judgement call)
      var t = elementOf(e.target);
      if (!hasMathJax || !settled || held !== null || !t || !t.closest || !t.closest('mjx-container')) return;
      var pool = getPool();
      if (pool && modeOf(pool) === 'speech') become(read(pool, 'subtitles') ? 'mathjax' : 'hide');
      report();
    });
    function watchRedraws() {               // the library ran first: watch the page instead
      var MO = window.MutationObserver, due = false;
      if (!MO) return;
      new MO(function (records) {
        for (var i = 0; i < records.length; i++) {
          for (var j = 0, n; (n = records[i].addedNodes[j]); j++) {
            if (n.nodeType === 1 && (n.localName === 'mjx-container' || n.getElementsByTagName('mjx-container').length)) {
              if (!due) { due = true; setTimeout(function () { due = false; if (rendered) onRender(); }, 0); }
              return;
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    if (hasMathJax) {
      if (!(mj.startup && mj.startup.promise)) {         // before the library: our MathJax step
        mj.options = mj.options || {};
        mj.options.renderActions = mj.options.renderActions || {};
        mj.options.renderActions.astemMathCATSettings = [250,   // after insertion (200)
          function () { onRender(); }, function () { onRender(); }];
      } else {
        mj.startup.promise.then(onRender, onRender);
        watchRedraws();
      }
    }
    report();                               // at start: the kind of page
    return { popupsOn: function () { return choice === 'mathcat'; } };
  })();
  // ==== END subtitle settings =================================================
  if (!window.__ASTEM_MC_NO_AUTOSTART) autostart();
})(window);
