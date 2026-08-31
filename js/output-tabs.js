// js/output-tabs.js
//
// Extracted from index.html 20260824-135655. Dependencies are injected by
// initOutputTabs(ctx) rather than reached for as globals, so this module can be
// imported and tested on its own — see cm6-src/test-*.mjs.
//
// Everything below is the original code, moved verbatim.

export function initOutputTabs(ctx) {
  // ════════════════════════════════════════════════════════════════════
  // SECTION 9: OUTPUT TABS
  // ════════════════════════════════════════════════════════════════════

  // Output tabs (with ARIA tab pattern)
  const outputTabList = document.querySelector('.output-tabs[role="tablist"]');
  const outputTabs = [...document.querySelectorAll('.output-tab[data-tab]')];

  function activateOutputTab(tab) {
    outputTabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');
    tab.focus();

    const target = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
    document.getElementById(target).classList.add('active');

    // (CM6 self-measures on visibility change — no resize call needed)
  }

  outputTabs.forEach(tab => {
    tab.addEventListener('click', () => activateOutputTab(tab));
  });

  // Arrow key navigation for output tabs
  if (outputTabList) {
    outputTabList.addEventListener('keydown', (e) => {
      const current = outputTabs.indexOf(e.target);
      if (current < 0) return;
      let next;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        next = outputTabs[(current + 1) % outputTabs.length];
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        next = outputTabs[(current - 1 + outputTabs.length) % outputTabs.length];
      } else if (e.key === 'Home') {
        e.preventDefault();
        next = outputTabs[0];
      } else if (e.key === 'End') {
        e.preventDefault();
        next = outputTabs[outputTabs.length - 1];
      }
      if (next) activateOutputTab(next);
    });
  }


  return { activateOutputTab };
}
