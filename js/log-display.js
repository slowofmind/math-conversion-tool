// js/log-display.js
//
// Extracted from index.html 20260824-135655. Dependencies are injected by
// initLogDisplay(ctx) rather than reached for as globals, so this module can be
// imported and tested on its own — see cm6-src/test-*.mjs.
//
// Everything below is the original code, moved verbatim.

export function initLogDisplay(ctx) {
  const editor = ctx.editor;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 7: LOG DISPLAY
  // ════════════════════════════════════════════════════════════════════

  function updateLog(warnings) {
    const container = document.getElementById('logContainer');
    container.innerHTML = '';

    if (warnings.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 16px; font-family: \'IBM Plex Sans\', sans-serif; font-size: 12px;">No warnings or errors.</div>';
    }

    for (const warn of warnings) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';

      // Click to jump to line
      if (warn.line) {
        entry.addEventListener('click', () => {
          editor.gotoLine(warn.line, warn.column || 1);
          editor.focus();
          // Highlight active log entry
          container.querySelectorAll('.log-entry').forEach(e => e.classList.remove('active'));
          entry.classList.add('active');
        });
      }

      const levelEl = document.createElement('span');
      levelEl.className = 'log-level ' + warn.level;
      levelEl.textContent = warn.level.toUpperCase();

      const locEl = document.createElement('span');
      locEl.className = 'log-location';
      locEl.textContent = warn.line ? `Ln ${warn.line}${warn.column ? ':' + warn.column : ''}` : '';

      const msgEl = document.createElement('span');
      msgEl.className = 'log-msg';
      msgEl.textContent = warn.message;

      entry.appendChild(levelEl);
      entry.appendChild(locEl);
      entry.appendChild(msgEl);
      container.appendChild(entry);
    }

    // Update badge
    const badge = document.getElementById('logBadge');
    const total = warnings.length;
    const hasError = warnings.some(w => w.level === 'error');
    const hasWarn = warnings.some(w => w.level === 'warn');
    if (total > 0) {
      badge.className = 'log-badge ' + (hasError ? 'error' : hasWarn ? 'warn' : 'info');
      badge.textContent = total;
    } else {
      badge.className = '';
      badge.textContent = '';
    }
  }





  return { updateLog };
}
