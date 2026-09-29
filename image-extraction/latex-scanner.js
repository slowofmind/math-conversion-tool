// latex-scanner.js — ported from the extraction harness for browser use.
// The original was an IIFE with a CommonJS/global dual export
// (module.exports + window.LatexScanner). Converted to plain ES module
// exports to match the platform's other modules. The function bodies are
// UNCHANGED; only the wrapper and export tail were rewritten.


  // -----------------------------------------------------------------
  // maskComments(text)
  // Returns a copy of the text, SAME LENGTH, where every LaTeX
  // comment (% to end of line) is blanked out with spaces. A percent
  // sign written as \% is literal text, not a comment, and survives.
  // Rule of thumb used everywhere below: FIND things in the masked
  // copy, CUT text from the original. Same length = same positions.
  // -----------------------------------------------------------------
  function maskComments(text) {
    var out = text.split('');
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === '\\') {
        // A backslash "protects" the next character, so \% and \\
        // never start a comment.
        i += 2;
        continue;
      }
      if (ch === '%') {
        while (i < n && text[i] !== '\n') {
          out[i] = ' ';
          i++;
        }
        continue;
      }
      i++;
    }
    return out.join('');
  }

  // -----------------------------------------------------------------
  // lineOfIndex(text, index)
  // Which line number (starting at 1) a character position falls on.
  // -----------------------------------------------------------------
  function lineOfIndex(text, index) {
    var line = 1;
    for (var i = 0; i < index && i < text.length; i++) {
      if (text[i] === '\n') line++;
    }
    return line;
  }

  // -----------------------------------------------------------------
  // readBalancedGroup(text, openIndex)
  // Given the position of a "{", finds its matching "}" (counting
  // nested braces, ignoring \{ and \}). Returns { content, endIndex }
  // or null if the braces never balance.
  // -----------------------------------------------------------------
  function readBalancedGroup(text, openIndex) {
    if (text[openIndex] !== '{') return null;
    var depth = 0;
    var i = openIndex;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          return { content: text.slice(openIndex + 1, i), endIndex: i };
        }
      }
      i++;
    }
    return null;
  }

  // -----------------------------------------------------------------
  // skipSpacesAndOptionalGroups(masked, i)
  // Moves a position forward past whitespace and any [ ... ] option
  // groups. Used when a definition looks like
  // \NewEnviron{name}[2][default]{ body } and we want the body.
  // -----------------------------------------------------------------
  function skipSpacesAndOptionalGroups(masked, i) {
    var n = masked.length;
    while (i < n) {
      var ch = masked[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '[') {
        while (i < n && masked[i] !== ']') {
          if (masked[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      break;
    }
    return i;
  }

  // -----------------------------------------------------------------
  // splitDocument(text)
  // Finds the three big pieces of a LaTeX file:
  //   documentClass — the \documentclass line (name + options)
  //   preamble      — everything after it, up to \begin{document}
  //   body          — everything between \begin/\end{document}
  // If the file is only a fragment (no \begin{document}), the whole
  // text is treated as body.
  // -----------------------------------------------------------------
  function splitDocument(text) {
    var masked = maskComments(text);
    var result = {
      hasDocumentClass: false,
      documentClass: null,
      preamble: '',
      body: text,
      bodyStart: 0,
      bodyEnd: text.length,
      beginDocumentFound: false
    };
    var dc = /\\documentclass\s*(\[[^\]]*\])?\s*\{([^}]*)\}/.exec(masked);
    if (dc) {
      result.hasDocumentClass = true;
      result.documentClass = {
        name: dc[2],
        options: dc[1] ? dc[1].slice(1, -1) : '',
        start: dc.index,
        end: dc.index + dc[0].length
      };
    }
    var bd = /\\begin\s*\{document\}/.exec(masked);
    if (bd) {
      result.beginDocumentFound = true;
      var ed = /\\end\s*\{document\}/.exec(masked);
      var preStart = dc ? dc.index + dc[0].length : 0;
      result.preamble = text.slice(preStart, bd.index);
      result.bodyStart = bd.index + bd[0].length;
      result.bodyEnd = ed ? ed.index : text.length;
      result.body = text.slice(result.bodyStart, result.bodyEnd);
    }
    return result;
  }

  // -----------------------------------------------------------------
  // findEnvironments(text, names, maskedText)
  // Finds every OUTERMOST block \begin{X} ... \end{X} where X is one
  // of the claimed names. A claimed block sitting inside another
  // claimed block is left alone — only the outermost is reported.
  // Positions refer to the original text. maskedText is optional
  // (computed here if not supplied).
  // Each result: { name, start, end, line, source }
  // -----------------------------------------------------------------
  function findEnvironments(text, names, maskedText) {
    var masked = maskedText || maskComments(text);
    var wanted = {};
    for (var k = 0; k < names.length; k++) wanted[names[k]] = true;
    var re = /\\(begin|end)\s*\{([A-Za-z][A-Za-z0-9@*]*)\}/g;
    var results = [];
    var stack = [];
    var m;
    while ((m = re.exec(masked)) !== null) {
      if (!wanted[m[2]]) continue;
      if (m[1] === 'begin') {
        stack.push({ name: m[2], start: m.index });
        continue;
      }
      // This is an \end{X} for a claimed name.
      if (stack.length && stack[stack.length - 1].name === m[2]) {
        var open = stack.pop();
        if (stack.length === 0) {
          var end = m.index + m[0].length;
          results.push({
            name: open.name,
            start: open.start,
            end: end,
            line: lineOfIndex(text, open.start),
            source: text.slice(open.start, end)
          });
        }
      }
      // A stray or mismatched \end is ignored — that LaTeX would not
      // compile anyway, and our policy is flag-don't-fail.
    }
    return results;
  }

  // -----------------------------------------------------------------
  // discoverFigureEnvironments(content)
  // Scans a .sty or .tex file for environment DEFINITIONS
  // (\NewEnviron{X}... or \newenvironment{X}...) whose definition
  // body contains a tikzpicture or a pgfplots axis. These names
  // belong on the claim list (this is how tikzangle and
  // tikzcalibratedcircle are found automatically).
  // Returns [{ name, via, line }].
  // -----------------------------------------------------------------
  var FIGURE_HINT = /tikzpicture|\\begin\s*\{axis\}/;

  function discoverFigureEnvironments(content) {
    var masked = maskComments(content);
    var re = /\\(NewEnviron|newenvironment)\s*\{([A-Za-z][A-Za-z0-9@*]*)\}/g;
    var found = [];
    var m;
    while ((m = re.exec(masked)) !== null) {
      var i = skipSpacesAndOptionalGroups(masked, m.index + m[0].length);
      var hit = false;
      // Read the definition body (the first { } group). For
      // \newenvironment there is a second group (the "end" part) —
      // check that one too.
      for (var g = 0; g < 2 && i < masked.length; g++) {
        var grp = readBalancedGroup(masked, i);
        if (!grp) break;
        if (FIGURE_HINT.test(content.slice(i + 1, grp.endIndex))) hit = true;
        i = skipSpacesAndOptionalGroups(masked, grp.endIndex + 1);
        if (m[1] === 'NewEnviron') break;
      }
      if (hit) {
        found.push({
          name: m[2],
          via: m[1],
          line: lineOfIndex(content, m.index)
        });
      }
    }
    return found;
  }

  // -----------------------------------------------------------------
  // findCommandCandidates(content)
  // Scans for COMMAND definitions (\newcommand{\X}... etc.) whose
  // body contains a tikzpicture. Commands have no \end marker, so
  // v1 never claims them automatically — these are SUGGESTIONS for
  // the log ("\X may draw a figure"). Returns [{ name, via, line }].
  // -----------------------------------------------------------------
  function findCommandCandidates(content) {
    var masked = maskComments(content);
    var re = /\\(newcommand|renewcommand|providecommand)\s*\*?\s*\{?\\([A-Za-z]+)\}?/g;
    var found = [];
    var m;
    while ((m = re.exec(masked)) !== null) {
      var i = skipSpacesAndOptionalGroups(masked, m.index + m[0].length);
      var grp = readBalancedGroup(masked, i);
      if (grp && FIGURE_HINT.test(content.slice(i + 1, grp.endIndex))) {
        found.push({ name: m[2], via: m[1], line: lineOfIndex(content, m.index) });
      }
    }
    return found;
  }

  // -----------------------------------------------------------------
  // Public face of the module.
  // -----------------------------------------------------------------

export {
  maskComments,
  lineOfIndex,
  readBalancedGroup,
  skipSpacesAndOptionalGroups,
  splitDocument,
  findEnvironments,
  discoverFigureEnvironments,
  findCommandCandidates,
};

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.0.0';
