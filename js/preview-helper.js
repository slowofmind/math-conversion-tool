// js/preview-helper.js — the link helper. Placed, as text, in each PREVIEW COPY of an
// output page, just before </body>, by js/preview-pages.js. Never in a download.
//
// Plan: multipage-preview/PLAN-MULTIPAGE-PREVIEW.md ("How it works" 3 and 4).
// Written in the same plain style as mathcat-proof-agent.js (no modules, no newer
// syntax), and it must never contain the text that ends a script tag or opens an
// HTML comment: preview-pages.js refuses to inline it if it does (rule M16).
//
// The page arrives in a strictly sandboxed frame by srcdoc, so it has no address or
// folder of its own: the browser reads its relative links and images against the
// PLATFORM's address. This helper:
//   - leaves "#..." links to the browser: the preview copy's head starts with a base
//     element set to about:srcdoc, so the browser jumps within the page itself, as on any
//     website, and screen readers follow (2026-10-10; without that base element the
//     helper still makes the jump). This file is inlined into the page, so its comments
//     never spell that tag out;
//   - catches every other link activation (Enter on a link counts as a click), reads the
//     address as written, and asks the platform what to do (another page, a web link ...);
//   - asks the platform for the images marked data-astem-preview-state="wanted" and
//     draws each one from the file it is handed;
//   - after a page swap, lands on the asked-for section and, when the swap came
//     from a link in the page, moves focus there (D6: config.focus, 'auto' or 'none').
// Settings come from window.__ASTEM_PREVIEW = { token, page, fragment, focus },
// written by the platform in a separate tag just before this one. Messages from the
// platform count only if they come from the parent and carry this page's token.
(function (window) {
  'use strict';
  var document = window.document;
  var config = window.__ASTEM_PREVIEW;
  if (!config || window.__ASTEM_PREVIEW_HELPER) return;
  window.__ASTEM_PREVIEW_HELPER = true;
  var P = 'astem-preview:';
  var parentWin = window.parent;

  function send(o) {
    o.token = config.token;
    o.page = config.page;
    try { parentWin.postMessage(o, '*'); } catch (err) { /* nothing to tell */ }
  }
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (err) { return s; }
  }
  function findTarget(fragment) {
    if (!fragment) return null;
    return document.getElementById(fragment) || document.getElementsByName(fragment)[0] || null;
  }

  // ---- same-page jumps -----------------------------------------------------------
  // Used after a page swap (landing) and for the platform's "jump" answer; same-page
  // links themselves are the browser's own since 2026-10-10 (see the click handler).
  // The browser's own fragment navigation: it scrolls, sets :target and moves the
  // keyboard's starting point, as on any website. Following a link to the section
  // already in the address is still a real jump there, so screen readers move again
  // (NVDA did not when a repeat was only scrolled into view; 2026-10-10): the hash
  // first moves to a name that matches nothing on the page (no scroll, no :target),
  // because the strict sandbox refuses history.replaceState (checked 2026-10-10).
  function jump(fragment) {
    if (!fragment) { window.scrollTo(0, 0); return; }
    if (safeDecode(window.location.hash.slice(1)) === fragment) {
      window.location.hash = 'astem-preview-repeat';
    }
    if (safeDecode(window.location.hash.slice(1)) === fragment) {
      var t = findTarget(fragment);
      if (t && t.scrollIntoView) t.scrollIntoView();
    } else {
      window.location.hash = fragment;
    }
  }

  // ---- links ----------------------------------------------------------------------
  // Capture phase, so the frame never starts a navigation of its own: any navigation
  // here would be read against the platform's address and load the platform itself.
  document.addEventListener('click', function (e) {
    var el = e.target;
    var a = el && el.closest ? el.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    // "#...": the browser's own jump, when the preview copy's base element makes it one (2026-10-10).
    if (href.charAt(0) === '#' && document.baseURI === 'about:srcdoc') return;
    e.preventDefault();
    if (href === '' || href.charAt(0) === '#') { jump(safeDecode(href.slice(1))); return; }
    send({ type: P + 'link', href: href });
  }, true);

  // ---- images ---------------------------------------------------------------------
  function wantedPaths() {
    var out = [], els = document.querySelectorAll('img[data-astem-preview-state="wanted"]');
    for (var i = 0; i < els.length; i++) {
      var p = els[i].getAttribute('data-astem-preview-src');
      if (out.indexOf(p) < 0) out.push(p);
    }
    return out;
  }
  function draw(files) {
    var els = document.querySelectorAll('img[data-astem-preview-state="wanted"]');
    for (var i = 0; i < els.length; i++) {
      var f = files && files[els[i].getAttribute('data-astem-preview-src')];
      if (!f) continue;
      els[i].src = window.URL.createObjectURL(f);
      els[i].setAttribute('data-astem-preview-state', 'shown');
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.token !== config.token) return;
    if (d.type === P + 'images') draw(d.files);
    else if (d.type === P + 'jump') jump(d.fragment || '');
  });

  // ---- landing after a page swap ----------------------------------------------------
  function firstHeading() {
    return document.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
  }
  function land() {
    var target = findTarget(config.fragment);
    if (config.fragment) jump(config.fragment);
    var focused = null;
    if (config.focus === 'auto') {
      var f = target || firstHeading();
      if (f) {
        if (!f.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(f.tagName)) {
          f.setAttribute('tabindex', '-1');     // preview copy only
        }
        try { f.focus(); } catch (err) { /* nothing to focus */ }
        focused = f.id || f.tagName.toLowerCase();
      }
    }
    send({ type: P + 'landed', fragment: config.fragment || '', found: !config.fragment || !!target, focused: focused });
    // Math drawn after the jump can push the section down: scroll it back into view once.
    var mj = window.MathJax;
    if (target && mj && mj.startup && mj.startup.promise && mj.startup.promise.then) {
      mj.startup.promise.then(function () { if (target.scrollIntoView) target.scrollIntoView(); });
    }
  }

  // The page above this script is already parsed, so its images can be asked for now.
  send({ type: P + 'ready', images: wantedPaths() });
  if (document.readyState === 'complete') land();
  else window.addEventListener('load', land);
})(window);
