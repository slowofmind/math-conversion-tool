// js/warning-parser.js
//
// Extracted from index.html 20260824-135655. Dependencies are injected by
// initWarningParser(ctx) rather than reached for as globals, so this module can be
// imported and tested on its own — see cm6-src/test-*.mjs.
//
// Everything below is the original code, moved verbatim.

export function initWarningParser(ctx) {
  // ════════════════════════════════════════════════════════════════════
  // SECTION 4: WARNING PARSER
  // ════════════════════════════════════════════════════════════════════

  // Parsed warning objects: { line, column, level, message, matchedText, type }
  let parsedWarnings = [];

  function parseWarnings(warnings, stderr, sourceText) {
    parsedWarnings = [];

    // DEBUG: dump raw warning structure to console for inspection
    if (warnings && warnings.length > 0) {
      console.log('[pandoc] Raw warnings:', JSON.stringify(warnings[0], null, 2));
    }

    // Parse structured warnings from pandoc
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        try {
          const parsed = parseOneWarning(w, sourceText);
          if (parsed) parsedWarnings.push(parsed);
        } catch (err) {
          console.error('[pandoc] Failed to parse warning:', err, w);
          parsedWarnings.push({
            line: null, column: null, level: 'warn',
            message: String(w.pretty || JSON.stringify(w)),
            matchedText: null, type: 'parse-error',
          });
        }
      }
    }

    // Also parse stderr for errors
    if (stderr && stderr.trim()) {
      const lines = stderr.trim().split('\n');
      for (const line of lines) {
        const locMatch = line.match(/at\s+\S+\s+line\s+(\d+)\s+column\s+(\d+)/i);
        parsedWarnings.push({
          line: locMatch ? parseInt(locMatch[1]) : null,
          column: locMatch ? parseInt(locMatch[2]) : null,
          level: 'error',
          message: line.trim(),
          matchedText: null,
          type: 'stderr',
        });
      }
    }

    return parsedWarnings;
  }

  /**
   * Safely convert a pandoc field to a plain string.
   * The `contents` / `message` fields may be:
   *   - a plain string
   *   - an array of pandoc AST inlines
   *   - an object with nested structure
   *   - null/undefined
   */
  function toStr(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      // Pandoc inline array: try to extract text recursively
      return val.map(item => {
        if (typeof item === 'string') return item;
        if (item && item.t === 'Str') return item.c || '';
        if (item && item.t === 'Space') return ' ';
        if (item && item.c) return toStr(item.c);
        return JSON.stringify(item);
      }).join('');
    }
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  function parseOneWarning(w, sourceText) {
    // Extract structured fields directly from pandoc warning object
    const line = w.line || null;
    const column = w.column || null;
    const contents = toStr(w.contents);
    const path = toStr(w.path);
    const wType = toStr(w.type) || null;
    const verbosity = toStr(w.verbosity) || 'INFO';

    // Determine severity level
    let level = verbosity === 'INFO' ? 'info' : 'warn';

    // Build clean message based on warning type
    let message = '';
    let matchedText = null;

    switch (wType) {
      case 'SkippedContent': {
        message = `Skipped '${contents}'`;
        // contents can be multi-line; use first line for matching
        const firstLine = contents.split('\n')[0];
        matchedText = firstLine;
        break;
      }

      case 'CouldNotLoadIncludeFile': {
        // contents is empty for this type; filename is in w.path
        const fname = toStr(w.path);
        message = `Could not load include file: ${fname}`;
        // Strip .sty/.cls/.tex extension to match package name in source
        const baseName = fname.replace(/\.(sty|cls|tex)$/i, '');
        matchedText = baseName;
        break;
      }

      case 'CouldNotConvertTeXMath':
        message = `Could not convert TeX math: ${contents}`;
        matchedText = contents;
        level = 'warn';
        break;

      case 'InlineNotRendered': {
        // contents is an AST node, e.g. {t: "RawInline", c: ["latex", "\\cite{foo}"]}
        let rawText = contents;
        if (w.contents && typeof w.contents === 'object' && !Array.isArray(w.contents)) {
          if (w.contents.c && Array.isArray(w.contents.c) && typeof w.contents.c[1] === 'string') {
            rawText = w.contents.c[1];
          }
        }
        message = `Inline not rendered: ${rawText}`;
        matchedText = rawText;
        break;
      }

      case 'NoLangSpecified':
        message = 'No language specified';
        level = 'info';
        break;

      default:
        // Fallback: use the pretty-printed message
        message = toStr(w.pretty) || toStr(w.message) || JSON.stringify(w);
        // Try to extract location from pretty string if structured fields missing
        if (!line && typeof message === 'string') {
          const locMatch = message.match(/line\s+(\d+)/i);
          if (locMatch) {
            return {
              line: parseInt(locMatch[1]),
              column: null,
              level,
              message: message.replace(/\s+at\s+\/stdin.*$/, ''),
              matchedText: null,
              type: wType || 'unknown',
            };
          }
        }
        break;
    }

    // If we still don't have a line number, try to find the text in the source
    let resolvedLine = line;
    if (!resolvedLine && matchedText && sourceText) {
      resolvedLine = findInSource(matchedText, sourceText);
    }

    return {
      line: resolvedLine,
      column,
      level,
      message: (typeof message === 'string') ? message.replace(/\s+at\s+\/stdin.*$/, '').trim() : String(message),
      matchedText: matchedText || null,
      type: wType || 'unknown',
    };
  }

  function findInSource(text, source) {
    if (!text || typeof text !== 'string' || !source) return null;
    const lines = source.split('\n');
    // Try exact match first
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(text)) return i + 1; // 1-based
    }
    // Try with backslash escaping collapsed
    const alt = text.replace(/\\\\/g, '\\');
    if (alt !== text) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(alt)) return i + 1;
      }
    }
    return null;
  }


  return { parseWarnings };
}
