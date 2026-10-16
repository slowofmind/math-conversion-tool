// js/canvas-package.js: "Package for Canvas" (Accessible STEM platform, 2026-10-11).
// With that Styling option, single-page HTML downloads as a zip: the page under its own name, plus
// every image it links to at the same relative paths, so Canvas can unpack the zip with the images
// beside the page (tested in the Canvas sandbox 2026-10-10: links and images work after unpacking).
// Deliberately self-contained: it uses no code from the platform's other packaging features, which
// may be removed (Nicholas, 2026-10-11: "make sure you don't build anything that is dependent on it").
// Needs only JSZip (./epub-thorium/jszip.min.js, loaded before this file). Classic script; defines
// window.CanvasPackage = { linkedImages, make }.
(function (window) {
  'use strict';

  // The local images a page points to, as relative paths, in page order, each once.
  // Skipped: addresses with a scheme (https:, data:, ...), root-relative ones (/...) and "#...".
  function linkedImages(html) {
    var out = [], re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, m;
    while ((m = re.exec(html))) {
      var src = (m[1] !== undefined ? m[1] : m[2]).replace(/&amp;/g, '&').trim();
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.charAt(0) === '/' || src.charAt(0) === '#') continue;
      var path = src.split(/[?#]/)[0];
      try { path = decodeURI(path); } catch (e) { /* keep it as written */ }
      path = path.replace(/^(\.\/)+/, '');
      if (path && out.indexOf(path) < 0) out.push(path);
    }
    return out;
  }

  // The zip. opts: { name: the page's file name, html: its text, files: { path: Blob }, the files the
  // conversion gave Pandoc }. An image whose path climbs out of the page's folder (..) or is not among
  // the files is left out and listed in `missing`. Compressed, like Pandoc's own Chunked HTML zip.
  async function make(opts) {
    if (typeof window.JSZip !== 'function') throw new Error('the zip library (JSZip) is not loaded');
    var name = opts.name, files = opts.files || {};
    var zip = new window.JSZip(), images = [], missing = [];
    zip.file(name, opts.html);
    var paths = linkedImages(opts.html);
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var ok = p.split('/').indexOf('..') < 0 && Object.prototype.hasOwnProperty.call(files, p) && files[p];
      if (!ok) { missing.push(p); continue; }
      zip.file(p, new Uint8Array(await files[p].arrayBuffer()));
      images.push(p);
    }
    var blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
    return { blob: blob, filename: name.replace(/\.html?$/i, '') + '.zip', images: images, missing: missing };
  }

  window.CanvasPackage = { linkedImages: linkedImages, make: make };
})(window);
