// js/output-tabs.js
//
// Extracted from index.html 20260824-135655. Dependencies are injected by
// initOutputTabs(ctx) rather than reached for as globals, so this module can be
// imported and tested on its own — see cm6-src/test-*.mjs.
//
// 2026-10-06: rewritten for one "Output view" drop-down (#selOutputView) instead
// of five tabs (decided by Nicholas; see output-panel-ui\NOTE-OUTPUT-PANEL-UI.md).

export function initOutputTabs(ctx) {
  // ════════════════════════════════════════════════════════════════════
  // SECTION 9: OUTPUT TABS
  // ════════════════════════════════════════════════════════════════════

  // Output views: one drop-down, #selOutputView (Output, Code, Preprocess,
  // Log; the Intent view moved to the left sidebar on 2026-10-06).
  // activateOutputTab keeps its name so callers barely change;
  // it takes a view name ('log'), and for safety an old tab id ('outtab-log')
  // or an element with such an id. Unknown names change nothing. Programmatic
  // switches still move focus to the drop-down, as the tabs did (kept for
  // now, decided 2026-10-06).
  const viewSelect = document.getElementById('selOutputView');
  const VIEWS = ['preview', 'source', 'preprocess', 'log'];

  function viewName(x) {
    const s = typeof x === 'string' ? x : (x && x.id) || '';
    const v = s.replace(/^outtab-/, '');
    return VIEWS.includes(v) ? v : null;
  }

  function showView(v) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const area = document.getElementById('tab' + v.charAt(0).toUpperCase() + v.slice(1));
    if (area) area.classList.add('active');
    // (CM6 self-measures on visibility change — no resize call needed)
  }

  function activateOutputTab(x) {
    const v = viewName(x);
    if (!v || !viewSelect) return;
    viewSelect.value = v;
    showView(v);
    viewSelect.focus();
  }

  if (viewSelect) {
    viewSelect.addEventListener('change', () => {
      const v = viewName(viewSelect.value);
      if (v) showView(v);
    });
  }


  return { activateOutputTab };
}
