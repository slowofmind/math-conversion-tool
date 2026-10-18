// js/canvas-output.js: "Loose files" and "Canvas content" output packaging (Accessible STEM platform,
// 2026-10-18; design: canvas-embedding\output-packaging-design.md). Replaces js/canvas-package.js.
//   Loose files:    a zip with every output file in ONE top folder "Title (YYYY-MM-DD HHMM)", so Canvas
//                   unpacks it into its own folder (Canvas keeps folders inside a zip; tested 2026-10-10).
//   Canvas content: a Canvas import file (.imscc, "Canvas Course Export Package") with the files in that
//                   folder and ONE unpublished Page (no module) whose frame shows the first page, plus a
//                   full-window link. JavaScript version of build_cc_page_only.py, the format that
//                   imported cleanly into Nicholas's sandbox (2026-10-16 to 2026-10-18).
// Page identifier (Nicholas, 2026-10-18: "option (c), title and file name together"): the same for
// every version of a document, so a re-import updates that Page; folder and file identifiers are new
// every version (a re-import into the SAME folder makes Canvas add "-1" copies and mix old and new).
// Self-contained: uses no code from the platform's other packaging features. Needs only JSZip
// (./epub-thorium/jszip.min.js, loaded first). Classic script; defines window.CanvasOutput.
(function (window) {
  'use strict';
  const enc = new TextEncoder();
  const pad = (n) => String(n).padStart(2, '0');
  const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Like Python's urllib.parse.quote(s, safe=''), the form tested in Canvas: also encodes ! ' ( ) *.
  const strictEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

  async function hex(text) {
    const d = await window.crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function bytesOf(x) {
    if (x instanceof Uint8Array) return x;
    if (x && typeof x.arrayBuffer === 'function') return new Uint8Array(await x.arrayBuffer());
    if (typeof x === 'string') return enc.encode(x);
    return new Uint8Array(x);
  }
  function titleFrom(html, fallback) {
    try {
      const t = new window.DOMParser().parseFromString(html, 'text/html').title.replace(/\s+/g, ' ').trim();
      return t || fallback;
    } catch (e) { return fallback; }
  }

  // The local images a page points to, as relative paths, in page order, each once. Skipped:
  // addresses with a scheme (https:, data:, ...), root-relative ones (/...) and "#...".
  function linkedImages(html) {
    const out = [], re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let m;
    while ((m = re.exec(html))) {
      const src = (m[1] !== undefined ? m[1] : m[2]).replace(/&amp;/g, '&').trim();
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.charAt(0) === '/' || src.charAt(0) === '#') continue;
      let path = src.split(/[?#]/)[0];
      try { path = decodeURI(path); } catch (e) { /* keep it as written */ }
      path = path.replace(/^(\.\/)+/, '');
      if (path && out.indexOf(path) < 0) out.push(path);
    }
    return out;
  }

  // A file set: { entry, title, files: [{ path, data: Uint8Array }], missing: [paths] }.
  // Single-page HTML: the page plus every image it links to that is among the conversion's files
  // (an image not found, or climbing out with "..", is left out and listed in `missing`).
  async function collectPage(name, html, files) {
    files = files || {};
    const out = [{ path: name, data: enc.encode(html) }], missing = [];
    for (const p of linkedImages(html)) {
      const ok = p.split('/').indexOf('..') < 0 && Object.prototype.hasOwnProperty.call(files, p) && files[p];
      if (!ok) { missing.push(p); continue; }
      out.push({ path: p, data: await bytesOf(files[p]) });
    }
    return { entry: name, title: titleFrom(html, name.replace(/\.[^.]+$/, '')), files: out, missing };
  }

  // HTML (multipage): everything in Pandoc's zip; the first page is index.html.
  async function collectZip(blob) {
    if (typeof window.JSZip !== 'function') throw new Error('the zip library (JSZip) is not loaded');
    const z = await window.JSZip.loadAsync(blob), out = [];
    for (const n of Object.keys(z.files)) {
      if (!z.files[n].dir) out.push({ path: n, data: await z.files[n].async('uint8array') });
    }
    const first = out.find((f) => f.path === 'index.html') || out.find((f) => /\.html?$/i.test(f.path));
    if (!first) throw new Error('no page found in the multipage output');
    return { entry: first.path, title: titleFrom(new TextDecoder().decode(first.data), 'Document'), files: out, missing: [] };
  }

  // "Title (YYYY-MM-DD HHMM)", local time; characters unsafe in file names removed; about 100
  // characters at most.
  function folderName(title, when) {
    const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`;
    let t = String(title || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 80) t = t.slice(0, 80).trim();
    return `${t || 'Document'} (${stamp})`;
  }

  async function zipBlob(zip) {
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
  }

  // Loose files: every file under one top folder.
  async function makeLooseZip(set, when) {
    if (typeof window.JSZip !== 'function') throw new Error('the zip library (JSZip) is not loaded');
    const folder = folderName(set.title, when), zip = new window.JSZip();
    for (const f of set.files) zip.file(`${folder}/${f.path}`, f.data);
    return { blob: await zipBlob(zip), filename: `${folder}.zip`, folder };
  }

  const MANIFEST_NS = 'xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" ' +
    'xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" ' +
    'xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd ' +
    'http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd ' +
    'http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lommanifest_v1p0.xsd"';

  // Canvas content: the import file. inputName: the input file's name without extension (the output is
  // named after it, e.g. main.tex -> main.html); with the title it makes the Page identifier.
  async function makeImportFile(set, inputName, when) {
    if (typeof window.JSZip !== 'function') throw new Error('the zip library (JSZip) is not loaded');
    const title = set.title || 'Document';
    const folder = folderName(title, when);
    const pageId = 'g' + (await hex(`${title}|${inputName || ''}`)).slice(0, 32);         // same every version
    const ver = 'g' + (await hex(`${folder}|${when.toISOString()}|${inputName || ''}`)).slice(0, 12);   // new every version
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
    const src = '$IMS-CC-FILEBASE$/' + strictEncode(folder) + '/' + set.entry.split('/').map(strictEncode).join('/') + '?canvas_download=1';
    const t = escapeXml(title), s = escapeXml(src);
    const page = '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n' +
      `<title>${t}</title>\n<meta name="identifier" content="${pageId}">\n` +
      '<meta name="editing_roles" content="teachers">\n<meta name="workflow_state" content="unpublished">\n</head>\n<body>\n' +
      `<p><a href="${s}" target="_blank">Open ${t} in a full window (new tab)</a></p>\n` +
      `<p><iframe src="${s}" title="${t}" width="100%" height="400"></iframe></p>\n</body>\n</html>\n`;
    let res = `\n    <resource identifier="${ver}settings" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/canvas_export.txt">` +
      '\n      <file href="course_settings/canvas_export.txt"/>\n    </resource>' +
      `\n    <resource identifier="${pageId}" type="webcontent" href="wiki_content/${slug}.html">` +
      `\n      <file href="wiki_content/${slug}.html"/>\n    </resource>`;
    set.files.forEach((f, i) => {
      const h = escapeXml(`web_resources/${folder}/${f.path}`);
      res += `\n    <resource identifier="${ver}file${i}" type="webcontent" href="${h}">\n      <file href="${h}"/>\n    </resource>`;
    });
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest identifier="${ver}manifest" ${MANIFEST_NS}>\n` +
      '  <metadata>\n    <schema>IMS Common Cartridge</schema>\n    <schemaversion>1.1.0</schemaversion>\n' +
      `    <lomimscc:lom><lomimscc:general><lomimscc:title><lomimscc:string>${t}</lomimscc:string></lomimscc:title></lomimscc:general></lomimscc:lom>\n` +
      `  </metadata>\n  <organizations/>\n  <resources>${res}\n  </resources>\n</manifest>\n`;
    const zip = new window.JSZip();
    zip.file('imsmanifest.xml', manifest);
    zip.file('course_settings/canvas_export.txt', 'Canvas content made by the Accessible STEM platform.\n');
    zip.file(`wiki_content/${slug}.html`, page);
    for (const f of set.files) zip.file(`web_resources/${folder}/${f.path}`, f.data);
    return { blob: await zipBlob(zip), filename: `${folder}.imscc`, folder, pageId };
  }

  window.CanvasOutput = { linkedImages, collectPage, collectZip, folderName, makeLooseZip, makeImportFile };
})(window);
