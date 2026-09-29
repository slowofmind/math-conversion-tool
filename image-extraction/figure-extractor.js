// figure-extractor.js — ported from the extraction harness for browser use.
// The original was an IIFE with a CommonJS/global dual export
// (module.exports + window.FigureExtractor). Converted to plain ES module
// exports to match the platform's other modules. The function bodies are
// UNCHANGED; only the wrapper and export tail were rewritten.


  // Names claimed even before auto-discovery adds more.
import * as S from './latex-scanner.js';

  var DEFAULT_CLAIMS = ['tikzpicture', 'tikzangle', 'tikzcalibratedcircle'];

  // Ported: the original resolved the scanner at call time through
  // global.LatexScanner or CommonJS require. As an ES module it is a static
  // import, so scanner() simply returns it and the call sites are unchanged.
  function scanner() {
    return S;
  }

  // dc-fig-001, dc-fig-002, ...
  function figureId(n) {
    return 'dc-fig-' + ('000' + n).slice(-3);
  }

  // Prefix every line of a block with "% " so LaTeX ignores it but a
  // human can still read (and restore) it.
  function commentOutBlock(source) {
    return source.split('\n').map(function (ln) {
      return '% ' + ln;
    }).join('\n');
  }

  // Wrap one figure in its own tiny compile-ready document. The whole
  // original preamble rides along ("blunt carry"); the class line is
  // replaced by standalone, which sizes the page to fit the figure.
  function buildStandaloneTex(preamble, figureSource) {
    return '\\documentclass[margin=2pt]{standalone}\n' +
           preamble.replace(/^\s+|\s+$/g, '') + '\n' +
           '\\begin{document}\n' +
           figureSource + '\n' +
           '\\end{document}\n';
  }

  // -----------------------------------------------------------------
  // findDefinitionRanges(masked)
  // Finds the { ... } body regions of every command/environment
  // DEFINITION in the text. Why: a tikzpicture written inside, say,
  // \newcommand{\graphcommand}{...} is part of a definition, not a
  // figure placed in the document — claiming it would corrupt the
  // definition. Such cases are skipped and flagged (catalog P12).
  // -----------------------------------------------------------------
  function findDefinitionRanges(masked) {
    var S = scanner();
    var ranges = [];
    var re = /\\(newcommand|renewcommand|providecommand|NewEnviron|newenvironment|def)\b\*?/g;
    var m;
    while ((m = re.exec(masked)) !== null) {
      var kind = m[1];
      var i = S.skipSpacesAndOptionalGroups(masked, m.index + m[0].length);
      // Step over the NAME being defined: either {\name} or \name
      if (masked[i] === '{') {
        var nameGrp = S.readBalancedGroup(masked, i);
        if (!nameGrp) continue;
        i = nameGrp.endIndex + 1;
      } else if (masked[i] === '\\') {
        i++;
        while (i < masked.length && /[A-Za-z@]/.test(masked[i])) i++;
      }
      if (kind === 'def') {
        // \def\name#1#2{body}: parameter text sits before the brace.
        while (i < masked.length && masked[i] !== '{' &&
               masked[i] !== '\n') i++;
      } else {
        i = S.skipSpacesAndOptionalGroups(masked, i);
      }
      // Read the body group(s): one for commands and \NewEnviron,
      // two (begin part + end part) for \newenvironment.
      var groups = (kind === 'newenvironment') ? 2 : 1;
      for (var g = 0; g < groups && masked[i] === '{'; g++) {
        var grp = S.readBalancedGroup(masked, i);
        if (!grp) break;
        ranges.push({ start: i, end: grp.endIndex });
        i = S.skipSpacesAndOptionalGroups(masked, grp.endIndex + 1);
      }
    }
    return ranges;
  }

  function insideAny(pos, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      if (pos > ranges[i].start && pos < ranges[i].end) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------
  // neutralizePreamble(preamble)
  // Page-geometry settings (\voffset etc.) are right for the ORIGINAL
  // page but fight the standalone class's tight crop: they shift the
  // figure on a page sized exactly to fit it, clipping the edges —
  // and the compile still "succeeds", so the failure-triggered retry
  // never sees it. So the carried COPY of the preamble gets those
  // lines commented out (the user's document is never touched).
  // \textwidth and \textheight are deliberately KEPT: they do not
  // move content, and figure code may use their values for sizing.
  // -----------------------------------------------------------------
  var GEOMETRY_PARAMS = 'voffset|hoffset|topmargin|oddsidemargin|' +
    'evensidemargin|headheight|headsep|footskip|topskip|paperwidth|' +
    'paperheight|marginparwidth|marginparsep';

  var GEOMETRY_LINE = new RegExp(
    '\\\\(' + GEOMETRY_PARAMS + ')\\s*=?\\s*[+-]?[0-9.\\\\]' +
    '|\\\\(setlength|addtolength)\\s*\\{\\s*\\\\(' +
      GEOMETRY_PARAMS + ')\\s*\\}' +
    '|\\\\usepackage\\s*(\\[[^\\]]*\\])?\\s*\\{\\s*geometry\\s*\\}' +
    '|\\\\(geometry|newgeometry)\\s*\\{' +
    '|\\\\pagestyle\\s*\\{');

  function neutralizePreamble(preamble) {
    var S = scanner();
    var lines = preamble.split('\n');
    var maskedLines = S.maskComments(preamble).split('\n');
    var neutralized = [];
    var out = lines.map(function (line, i) {
      if (GEOMETRY_LINE.test(maskedLines[i])) {
        neutralized.push(line.trim());
        return '% neutralized-for-standalone (page geometry): ' + line;
      }
      return line;
    });
    return { text: out.join('\n'), neutralized: neutralized };
  }

  // -----------------------------------------------------------------
  // extract(input) — the main entry point.
  //   input.mainTex            the LaTeX document text (required)
  //   input.styFiles           optional [{ name, content }]
  //   input.extraEnvironments  optional [names] from the UI
  // Returns:
  //   rewrittenTex       the document with figures commented out and
  //                      \includegraphics placeholders inserted
  //   figures            the manifest: one entry per claimed figure,
  //                      each with a ready-to-compile standaloneTex
  //   claimList          environment names that were claimed
  //   discovered         environments found by .sty/preamble scan
  //   commandCandidates  figure-drawing commands (suggestions only)
  //   flags              advisories, flag-don't-fail style
  //   summary            one human-readable line
  // -----------------------------------------------------------------
  function extract(input) {
    var S = scanner();
    var mainTex = input.mainTex || '';
    var styFiles = input.styFiles || [];
    var flags = [];

    var split = S.splitDocument(mainTex);
    var masked = S.maskComments(mainTex);

    // --- 1. Build the claim list ------------------------------------
    var claimSet = {};
    var claimList = [];
    function addClaim(name) {
      if (!claimSet[name]) {
        claimSet[name] = true;
        claimList.push(name);
      }
    }
    DEFAULT_CLAIMS.forEach(addClaim);
    (input.extraEnvironments || []).forEach(addClaim);

    var discovered = [];
    function discoverIn(label, content) {
      S.discoverFigureEnvironments(content).forEach(function (d) {
        d.file = label;
        discovered.push(d);
        addClaim(d.name);
      });
    }
    styFiles.forEach(function (f) { discoverIn(f.name, f.content); });
    discoverIn('(preamble)', split.preamble);

    // --- 2. Command candidates: suggest, never claim (v1) -----------
    var commandCandidates = [];
    var seenCmd = {};
    function candidatesIn(label, content) {
      S.findCommandCandidates(content).forEach(function (c) {
        c.file = label;
        commandCandidates.push(c);
        if (!seenCmd[c.name]) {
          seenCmd[c.name] = true;
          flags.push({
            type: 'command-candidate',
            message: '\\' + c.name + ' (defined in ' + label + ', line ' +
                     c.line + ') appears to draw a figure. Commands are ' +
                     'not claimed in v1; its uses pass through unchanged.',
            line: c.line
          });
        }
      });
    }
    styFiles.forEach(function (f) { candidatesIn(f.name, f.content); });
    candidatesIn('(main document)', mainTex);

    // --- 3. Find claimed environments in the document BODY ----------
    // Preamble hits are always definitions, never placed figures.
    var found = S.findEnvironments(mainTex, claimList, masked);
    var defRanges = findDefinitionRanges(masked);
    var kept = [];
    found.forEach(function (env) {
      if (env.start < split.bodyStart || env.end > split.bodyEnd) {
        return;
      }
      if (insideAny(env.start, defRanges)) {
        flags.push({
          type: 'inside-definition',
          message: 'A ' + env.name + ' at line ' + env.line + ' sits ' +
                   'inside a command/environment definition — left in ' +
                   'place, not claimed (catalog P12, v2 territory).',
          line: env.line
        });
        return;
      }
      kept.push(env);
    });

    // --- 4. Build the manifest: one entry per claimed figure --------
    // First neutralize page-geometry settings in the carried preamble
    // (computed once — the same wrapper preamble serves every figure).
    var neut = neutralizePreamble(split.preamble);
    if (neut.neutralized.length) {
      flags.push({
        type: 'geometry-neutralized',
        message: 'Page-geometry settings were commented out in the ' +
                 'figure wrappers (they shift content under the ' +
                 'standalone class and clip the figure): ' +
                 neut.neutralized.join(' ; ')
      });
    }
    var figures = kept.map(function (env, idx) {
      var id = figureId(idx + 1);
      if (/\\label\s*\{/.test(env.source)) {
        flags.push({
          type: 'label-inside-figure',
          message: id + ' contains a \\label — cross-references to it ' +
                   'will break once the figure becomes an image.',
          line: env.line
        });
      }
      if (/\\(ref|pageref)\s*\{/.test(env.source)) {
        flags.push({
          type: 'ref-inside-figure',
          message: id + ' contains \\ref/\\pageref — these will show ' +
                   'as ?? when the figure is compiled on its own.',
          line: env.line
        });
      }
      return {
        id: id,
        name: env.name,
        line: env.line,
        start: env.start,
        end: env.end,
        source: env.source,
        standaloneTex: buildStandaloneTex(neut.text, env.source),
        status: 'claimed'
      };
    });

    // --- 5. Rewrite the document ------------------------------------
    // Work from the LAST figure backwards so earlier positions stay
    // valid while we splice. Placeholder first, commented code below.
    var rewritten = mainTex;
    for (var i = figures.length - 1; i >= 0; i--) {
      var f = figures[i];
      var replacement =
        '\\includegraphics{' + f.id + '.pdf}\n' +
        '% --- ' + f.id + ': original code (commented out by the ' +
        'figure extractor) ---\n' +
        commentOutBlock(f.source) + '\n' +
        '% --- end ' + f.id + ' ---';
      rewritten = rewritten.slice(0, f.start) + replacement +
                  rewritten.slice(f.end);
    }

    // --- 6. Document-level advisories -------------------------------
    if (/\\begin\s*\{tikzcd\}/.test(masked)) {
      flags.push({
        type: 'tikzcd',
        message: 'tikzcd diagram(s) detected — deliberately not claimed ' +
                 'in v1 (catalog P11 policy: detect and flag).'
      });
    }
    if (/\\(savebox|usebox)\b/.test(masked)) {
      flags.push({
        type: 'savebox',
        message: 'savebox/usebox pattern detected (catalog P13) — ' +
                 'handled properly in v2; review output for this file.'
      });
    }
    if (split.documentClass && split.documentClass.options) {
      flags.push({
        type: 'class-options',
        message: 'Original class options [' + split.documentClass.options +
                 '] are not passed to the standalone wrapper in v1 ' +
                 '(package options in the preamble DO carry).'
      });
    }
    if (!split.beginDocumentFound) {
      flags.push({
        type: 'fragment',
        message: 'No \\begin{document} found — treated the whole text ' +
                 'as body with an empty preamble.'
      });
    }

    // --- 7. Summary line --------------------------------------------
    var summary = 'Claimed ' + figures.length + ' figure' +
      (figures.length === 1 ? '' : 's') +
      ' (claim list: ' + claimList.join(', ') + '); ' +
      flags.length + ' flag' + (flags.length === 1 ? '' : 's') + '.';

    return {
      rewrittenTex: rewritten,
      figures: figures,
      claimList: claimList,
      discovered: discovered,
      commandCandidates: commandCandidates,
      flags: flags,
      summary: summary
    };
  }

  // -----------------------------------------------------------------
  // Public face of the module.
  // -----------------------------------------------------------------

export {
  extract,
  figureId,
  commentOutBlock,
  buildStandaloneTex,
  neutralizePreamble,
  findDefinitionRanges,
};

// Version marker. Lets the console report what is actually LOADED —
// a browser can serve a stale copy of this module from HTTP cache even
// after a hard refresh of the page.
export const MODULE_VERSION = '1.0.0';
