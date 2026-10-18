// js/a11y-check-agent.js — the accessibility check's helper. Placed, as text, in each PREVIEW COPY
// of an HTML page, just before </body>, by js/a11y-check.js, followed by Sa11y's own files
// (sa11y-5.1.0/, loaded by address). Never in a download.
//
// Plan: accessibility-checker\PLAN-ACCESSIBILITY-CHECKER.md. Written in the same plain style as
// preview-helper.js and mathcat-proof-agent.js (no modules, no newer syntax), and it must never
// contain the text that ends a script tag or opens an HTML comment: js/a11y-check.js refuses to
// inline it if it does (rule M16). This helper:
//   - gives Sa11y in-memory stand-ins for browser storage: the strictly sandboxed preview has an
//     opaque origin and refuses storage, and Sa11y stops without it;
//   - waits for Sa11y's files, for MathJax to finish and for the preview's images to be drawn
//     (preview-helper.js draws them after the page loads), then starts Sa11y with the settings
//     below, with Sa11y's own panel (stage 1 of the plan);
//   - adds one check of its own: equations that did not convert;
//   - sends a summary of the results to the platform ('astem-a11y:results').
(function (window) {
  'use strict';
  var document = window.document;
  if (window.__ASTEM_A11Y_AGENT) return;
  window.__ASTEM_A11Y_AGENT = true;

  // ---- storage stand-ins (each only if the real one is refused) ---------------------------------
  function memoryStore() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = {}; },
      key: function (i) { return Object.keys(m)[i] || null; },
      get length() { return Object.keys(m).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { window[name].getItem('astem'); }
    catch (err) {
      try { Object.defineProperty(window, name, { value: memoryStore(), configurable: true }); }
      catch (err2) { /* Sa11y will report its own failure */ }
    }
  });

  // ---- settings (from the mockup, 2026-10-18) -----------------------------------------------------
  // The MathCAT and MathJax subtitle areas are the platform's own proofing aids, not the page.
  var IGNORE = '.sa11y-ignore, [class*="ASTEM_MathCAT_Region"], [class*="MJX_LiveRegion"]';
  var SETTINGS = {
    checkRoot: 'body',
    containerIgnore: IGNORE,
    // Equations are not images: MathJax gives each one a speech label (role img), which Sa11y would
    // otherwise mark with a tick or call "too long". Their speech is MathCAT proofing's job.
    imageIgnore: 'mjx-container *',
    // An equation the maths check below reports is shown in red; its letters are not also contrast errors.
    ignoreByTest: { CONTRAST_ERROR: '[data-astem-math-error], [data-astem-math-error] *' },
    extraPlaceholderStopWords: 'equation, formula, graph, figure, diagram, plot',
    checks: {
      ALT_PLACEHOLDER: {
        content: 'This image has placeholder alt text: <strong>%(ALT_TEXT)</strong>. Pandoc writes this when the LaTeX gives no description. In your LaTeX, describe the image: <code>\\includegraphics[alt={A short description}]{file}</code>.'
      }
    },
    developerChecksOnByDefault: true,
    readabilityPlugin: false,
    customChecks: 'listen',
    delayCustomCheck: 3000
  };

  // ---- the maths check: equations that did not convert ---------------------------------------------
  // The converter shows an unknown command as red text with the LaTeX attached
  // (<mtext mathcolor="red" ...>\name</mtext>) and other failures as <merror data-mjx-error="...">.
  // With MathJax on the page, its own model of each equation is read (the page's MathML is gone once
  // it has drawn them); without MathJax, the page's <math> elements are read.
  var UNKNOWN = /<mtext[^>]*mathcolor="red"[^>]*>(\\[^<]+)<\/mtext>/g;
  var MJXERROR = /data-mjx-error="([^"]+)"/g;
  function decode(s) { var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function all(re, s) { var out = [], m; re.lastIndex = 0; while ((m = re.exec(s))) out.push(decode(m[1])); return out; }
  function equations() {
    var mj = window.MathJax, list = [];
    var doc = mj && mj.startup && mj.startup.document;
    if (doc && doc.math && mj.startup.toMML) {
      var items = doc.math.toArray ? doc.math.toArray() : Array.from(doc.math);
      for (var i = 0; i < items.length; i++) {
        try { list.push({ el: items[i].typesetRoot, mml: mj.startup.toMML(items[i].root) }); } catch (err) { /* skip */ }
      }
      return list;
    }
    var maths = document.getElementsByTagName('math');
    for (var j = 0; j < maths.length; j++) list.push({ el: maths[j], mml: maths[j].outerHTML });
    return list;
  }
  function mathResults() {
    var out = [], eqs = equations();
    for (var i = 0; i < eqs.length; i++) {
      var e = eqs[i];
      if (!e.el || !e.el.setAttribute) continue;
      var unknown = all(UNKNOWN, e.mml).filter(function (u, k, a) { return a.indexOf(u) === k; });
      var errs = all(MJXERROR, e.mml);
      if (!unknown.length && !errs.length) continue;
      e.el.setAttribute('data-astem-math-error', '');
      var text;
      if (unknown.length) {
        var names = unknown.map(function (u) { return '<code>' + esc(u) + '</code>'; }).join(', ');
        text = 'This equation did not convert: ' + (unknown.length > 1 ? 'the commands ' + names + ' are' : 'the command ' + names + ' is')
          + ' not defined. It appears as red text and is read aloud as the raw command name. Define the command in your preamble'
          + ' (for example with <code>\\newcommand</code> or <code>\\DeclareMathOperator</code>), or replace it.';
      } else {
        text = 'This equation did not convert: ' + esc(errs.join('; ')) + '. It appears as an error message instead of the equation.';
      }
      out.push({ test: 'ASTEM_MATH_UNCONVERTED', element: e.el, type: 'error', inline: true, position: 'beforebegin', content: text });
    }
    return out;
  }

  // ---- results to the platform (kept there for stage 2) ---------------------------------------------
  document.addEventListener('sa11y-check-complete', function (e) {
    var res = (e.detail && e.detail.results) || [], items = [], errors = 0, warnings = 0;
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      if (!r || (r.type !== 'error' && r.type !== 'warning')) continue;
      if (r.type === 'error') errors++; else warnings++;
      items.push({ test: String(r.test || ''), type: r.type });
    }
    try { window.parent.postMessage({ type: 'astem-a11y:results', errors: errors, warnings: warnings, items: items }, '*'); }
    catch (err) { /* nothing to tell */ }
  });

  // ---- start, once everything the check looks at is in place ------------------------------------------
  var sa11y = null;
  function start() {
    if (sa11y || !window.Sa11y || !window.Sa11yLangEn) return;
    document.addEventListener('sa11y-custom-checks', function () {
      var found = [];
      try { found = mathResults(); } catch (err) { console.warn('Accessibility check: maths check failed: ' + (err && err.message || err)); }
      for (var i = 0; i < found.length; i++) sa11y.results.push(found[i]);
      document.dispatchEvent(new CustomEvent('sa11y-resume'));
    });
    try {
      window.Sa11y.Lang.addI18n(window.Sa11yLangEn.strings);
      sa11y = new window.Sa11y.Sa11y(SETTINGS);
    } catch (err) {
      console.warn('Accessibility check: Sa11y could not start: ' + (err && err.message || err));
    }
  }
  function imagesDrawn() { return !document.querySelector('img[data-astem-preview-state="wanted"]'); }
  function afterImages() {
    var n = 0;
    (function wait() {   // up to 3 s: an image the platform never sends must not hold the check back
      if (imagesDrawn() || n++ >= 30) start(); else setTimeout(wait, 100);
    })();
  }
  function afterMath() {
    var mj = window.MathJax;
    if (mj && mj.startup && mj.startup.promise && mj.startup.promise.then) {
      mj.startup.promise.then(afterImages, afterImages);
    } else {
      afterImages();
    }
  }
  function whenLoaded() {
    var n = 0;
    (function wait() {   // Sa11y's files come after this helper; give them up to 15 s
      if (window.Sa11y && window.Sa11yLangEn) afterMath();
      else if (n++ < 150) setTimeout(wait, 100);
      else console.warn('Accessibility check: Sa11y\'s files did not load.');
    })();
  }
  if (document.readyState === 'complete') whenLoaded();
  else window.addEventListener('load', whenLoaded);
})(window);
