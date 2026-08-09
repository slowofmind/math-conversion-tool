/* ============================================================================
 * postprocess-epub.js — browser/Node port of postprocess-epub.py.
 *
 * Splices a MathJax payload bundle (mathjax-payload.zip, built by
 * build-payload.py) into an EPUB produced by pandoc(-wasm), and repairs the
 * OPF: manifest <item> per payload file, properties="scripted" on content
 * documents that contain <script>. Output zip is mimetype-first & stored,
 * per the EPUB OCF spec.
 *
 * Dependency: JSZip 3.x (global `JSZip`, or pass via opts.JSZip).
 *
 * Usage (browser):
 *   const epubBytes    = ...;  // ArrayBuffer/Uint8Array from pandoc-wasm
 *   const payloadBytes = await (await fetch('mathjax-payload.zip')).arrayBuffer();
 *   const { data, stats } = await processEpub(epubBytes, payloadBytes);
 *   // data: Uint8Array of the final EPUB; offer as download / pass onward.
 *
 * Throws Error with a readable message on: missing container.xml/OPF,
 * already-processed EPUB (idempotency guard), missing JSZip.
 * ========================================================================= */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.processEpub = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MEDIA_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".css": "text/css"
  };

  function mediaType(path) {
    var dot = path.lastIndexOf(".");
    var ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
    return MEDIA_TYPES[ext] || "application/octet-stream";
  }

  function normalizePath(p) {
    var out = [];
    p.split("/").forEach(function (seg) {
      if (seg === "" || seg === ".") return;
      if (seg === "..") out.pop();
      else out.push(seg);
    });
    return out.join("/");
  }

  function findOpfPath(containerXml) {
    var m = containerXml.match(/full-path="([^"]+)"/);
    if (!m) throw new Error("cannot find rootfile in META-INF/container.xml");
    return m[1];
  }

  function addManifestItems(opfText, hrefs) {
    if (opfText.indexOf("</manifest>") < 0) throw new Error("no </manifest> in OPF");
    var items = hrefs.map(function (href, i) {
      var id = "mathjax-" + String(i).padStart(4, "0");
      return '    <item id="' + id + '" href="' + href +
             '" media-type="' + mediaType(href) + '" />';
    });
    return opfText.replace("</manifest>", items.join("\n") + "\n  </manifest>");
  }

  function addScriptedProperties(opfText, scriptedSet, opfDir) {
    return opfText.replace(/<item [^>]*\/>/g, function (tag) {
      var hm = tag.match(/href="([^"]+)"/);
      if (!hm) return tag;
      var full = normalizePath(opfDir ? opfDir + "/" + hm[1] : hm[1]);
      if (!scriptedSet.has(full)) return tag;
      var pm = tag.match(/properties="([^"]*)"/);
      if (pm) {
        if (/\bscripted\b/.test(pm[1]) || pm[1].indexOf("scripting") >= 0) return tag;
        return tag.replace('properties="' + pm[1] + '"',
                           'properties="' + pm[1] + ' scripted"');
      }
      return tag.replace("<item ", '<item properties="scripted" ');
    });
  }

  /**
   * @param {ArrayBuffer|Uint8Array} epubData    pandoc(-wasm) EPUB bytes
   * @param {ArrayBuffer|Uint8Array} payloadData mathjax-payload.zip bytes
   * @param {Object} [opts]  { JSZip }
   * @returns {Promise<{data: Uint8Array, stats: Object}>}
   */
  function processEpub(epubData, payloadData, opts) {
    opts = opts || {};
    var JSZipCtor = opts.JSZip ||
      (typeof JSZip !== "undefined" ? JSZip : null);
    if (!JSZipCtor) return Promise.reject(new Error("JSZip not available"));

    var zin, payload, names, opfPath, opfDir, payloadPrefix, opfText;

    return Promise.all([
      JSZipCtor.loadAsync(epubData),
      JSZipCtor.loadAsync(payloadData)
    ]).then(function (zips) {
      zin = zips[0]; payload = zips[1];
      names = Object.keys(zin.files).filter(function (n) { return !zin.files[n].dir; });
      var container = zin.file("META-INF/container.xml");
      if (!container) throw new Error("not an EPUB: missing META-INF/container.xml");
      return container.async("string");
    }).then(function (containerXml) {
      opfPath = findOpfPath(containerXml);
      opfDir = opfPath.indexOf("/") >= 0 ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
      payloadPrefix = opfDir ? opfDir + "/MathJax/" : "MathJax/";
      var opfEntry = zin.file(opfPath);
      if (!opfEntry) throw new Error("OPF not found at " + opfPath);
      return opfEntry.async("string");
    }).then(function (text) {
      opfText = text;
      // Idempotency guard.
      var hasPayload = names.some(function (n) { return n.indexOf(payloadPrefix) === 0; });
      if (hasPayload || opfText.indexOf('id="mathjax-') >= 0) {
        throw new Error("EPUB already contains a MathJax payload (" +
                        payloadPrefix + "...); run against the original conversion output");
      }
      // Scan content docs for scripts.
      var docNames = names.filter(function (n) {
        return /\.x?html$/.test(n);
      });
      return Promise.all(docNames.map(function (n) {
        return zin.file(n).async("string").then(function (t) {
          return t.indexOf("<script") >= 0 ? n : null;
        });
      }));
    }).then(function (scriptedList) {
      var scripted = new Set(scriptedList.filter(Boolean));
      var payloadNames = Object.keys(payload.files).filter(function (n) {
        return !payload.files[n].dir;
      });
      var hrefs = payloadNames.map(function (n) { return "MathJax/" + n; });

      opfText = addManifestItems(opfText, hrefs);
      opfText = addScriptedProperties(opfText, scripted, opfDir);

      var zout = new JSZipCtor();
      // 1. mimetype first, stored.
      return zin.file("mimetype").async("uint8array").then(function (mt) {
        zout.file("mimetype", mt, { compression: "STORE" });
        // 2. original entries (OPF replaced), deflated.
        var chain = Promise.resolve();
        names.forEach(function (n) {
          if (n === "mimetype") return;
          chain = chain.then(function () {
            if (n === opfPath) {
              zout.file(n, opfText, { compression: "DEFLATE" });
              return null;
            }
            return zin.file(n).async("uint8array").then(function (d) {
              zout.file(n, d, { compression: "DEFLATE" });
            });
          });
        });
        // 3. payload entries.
        payloadNames.forEach(function (n) {
          chain = chain.then(function () {
            return payload.file(n).async("uint8array").then(function (d) {
              zout.file(payloadPrefix + n, d, { compression: "DEFLATE" });
            });
          });
        });
        return chain.then(function () {
          return zout.generateAsync({
            type: "uint8array",
            mimeType: "application/epub+zip",
            compression: "DEFLATE"
          });
        }).then(function (data) {
          return {
            data: data,
            stats: {
              opfPath: opfPath,
              payloadFiles: payloadNames.length,
              scriptedDocs: scripted.size,
              outputBytes: data.length
            }
          };
        });
      });
    });
  }

  return processEpub;
}));
