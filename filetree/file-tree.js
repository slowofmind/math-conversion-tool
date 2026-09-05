// file-tree.js — Stage 1: read-only project file tree.
//
// Renders projectModel.listEntries() as a proper ARIA tree. Read-only:
// it shows and selects, it does not open, move, or exclude. Those are
// Stages 2-4. Nothing here writes to the model.
//
// ACCESSIBILITY CONTRACT — every item below was verified with NVDA
// (file-tree-design/nvda-test/RESULTS-tree-patterns.md). Do not
// "simplify" any of it without re-running that test.
//
//  * NO aria-checked anywhere. A checkbox tree makes every ordinary row
//    announce "checked", and — decisively — leaves no ARIA state free to
//    express the conversion target, which then sounds identical to any
//    other file.
//  * Non-default state joins the accessible NAME via a visually hidden
//    span (", conversion target"). Ordinary rows stay silent, so silence
//    itself carries meaning.
//  * aria-describedby points from the ROOT tree only to the summary
//    line, so it is spoken once on entry and never repeats — verified
//    across six arrow moves. Never make the summary a live region.
//  * aria-level / aria-setsize / aria-posinset are declared explicitly;
//    browsers may compute them but are not required to.
//  * Selection and focus are DISTINCT (W3C APG file-directory pattern):
//    arrow keys browse without selecting, so a keyboard user can survey
//    a 60-file project without triggering 60 actions.

export const FILE_TREE_VERSION = '0.1.0';

const EXPAND_KEY = 'atc.filetree.expanded';

const ICON = {
  folder: '\u{1F4C1}', document: '\u{1F4C4}', style: '\u2699',
  bib: '\u{1F4DA}', image: '\u{1F5BC}', support: '\u{1F527}',
  unknown: '\u{1F4CE}',
};

const FILTERS = [
  ['all',      'All files',    () => true],
  ['document', 'Documents',    e => e.role === 'document'],
  ['image',    'Images',       e => e.role === 'image'],
  ['style',    'Style & bib',  e => e.role === 'style' || e.role === 'bib'],
  ['other',    'Other',        e => e.role === 'support' || e.role === 'unknown'],
];

export function initFileTree({ getEntries, getSummaryText, getTargetPath,
                               getFolderState, onOpen, onToggleInclude } = {}) {
  const host      = document.getElementById('fileTreeHost');
  const summaryEl = document.getElementById('fileTreeSummary');
  const filterSel = document.getElementById('fileTreeFilter');
  const detailEl  = document.getElementById('fileTreeDetail');
  const emptyEl   = document.getElementById('fileTreeEmpty');
  if (!host) return { render() {}, focus() {} };

  let expanded = loadExpanded();
  let selectedPath = null;
  let activeFilter = 'all';

  function loadExpanded() {
    try { return new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveExpanded() {
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...expanded])); } catch {}
  }

  // ── flat entries -> nested folder tree ─────────────────────────
  // Folders are implied by paths; there are no folder entries in the
  // model, so they are synthesised here.
  function buildTree(entries) {
    const root = { name: '', path: '', kind: 'folder', children: new Map() };
    for (const e of entries) {
      let node = root;
      const parts = e.path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        const p = parts.slice(0, i + 1).join('/');
        if (!node.children.has(seg)) {
          node.children.set(seg, { name: seg, path: p, kind: 'folder', children: new Map() });
        }
        node = node.children.get(seg);
      }
      node.children.set(parts[parts.length - 1],
        { name: e.name, path: e.path, kind: 'file', entry: e });
    }
    return root;
  }

  // Overleaf's collator: numeric, so ch2 precedes ch10.
  const collator = new Intl.Collator('en', {
    numeric: true, sensitivity: 'variant', caseFirst: 'upper',
  });
  function sortChildren(node) {
    return [...node.children.values()].sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
      collator.compare(a.name, b.name));
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── render ─────────────────────────────────────────────────────
  function buildList(nodes, level) {
    const ul = document.createElement('ul');
    ul.setAttribute('role', level === 1 ? 'tree' : 'group');
    if (level === 1) {
      ul.id = 'fileTreeRoot';
      ul.setAttribute('aria-label', 'Project files');
      // Spoken once on entry, never repeated. Root only — never on groups.
      if (summaryEl) ul.setAttribute('aria-describedby', summaryEl.id);
    }
    nodes.forEach((node, i) => {
      const isFolder = node.kind === 'folder';
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-level', String(level));
      li.setAttribute('aria-posinset', String(i + 1));
      li.setAttribute('aria-setsize', String(nodes.length));
      li.dataset.path = node.path;
      li.dataset.kind = node.kind;
      li.tabIndex = -1;

      const isOpen = isFolder ? expanded.has(node.path) : false;
      if (isFolder) li.setAttribute('aria-expanded', String(isOpen));
      if (node.path === selectedPath) li.setAttribute('aria-selected', 'true');

      const isTarget = !isFolder && node.entry && node.entry.path === getTargetPath();
      const role = isFolder ? 'folder' : (node.entry ? node.entry.role : 'unknown');
      const isMainDoc = !isFolder && node.entry && node.entry.isMain;

      // Stage 2 state. The main document is stdin, not a file, so it has
      // no include control at all — a disabled checkbox would only ask
      // the user to reason about something meaningless.
      const folderState = isFolder && getFolderState ? getFolderState(node.path) : null;
      const excluded = isFolder ? (folderState === 'none')
                                : (node.entry && node.entry.include === false);
      const partly = isFolder && folderState === 'mixed';
      const hasToggle = isFolder ? (folderState !== 'empty') : !isMainDoc;
      if (excluded) li.classList.add('ft-excluded');

      // EXCLUSION-ONLY pattern (verified with NVDA): no aria-checked
      // anywhere. Ordinary rows stay silent, so silence means "nothing
      // unusual"; only non-default state joins the accessible name.
      let stateSpan = '';
      if (isTarget) stateSpan = '<span class="sr-only">, conversion target</span>';
      else if (excluded) stateSpan = '<span class="sr-only">, excluded</span>';
      else if (partly) stateSpan = '<span class="sr-only">, partly excluded</span>';

      const row = document.createElement('div');
      row.className = 'ft-row' + (isTarget ? ' ft-target' : '');
      // The toggle carries an explicit NAME so the control is
      // discoverable, while the row itself stays quiet on every pass.
      const toggleTitle = excluded
        ? `Include ${node.name} in conversion`
        : `Exclude ${node.name} from conversion`;
      row.innerHTML =
        `<span class="ft-twisty" aria-hidden="true">${isFolder ? (isOpen ? '\u25BE' : '\u25B8') : ''}</span>` +
        `<span class="ft-icon" aria-hidden="true">${ICON[role] || ICON.unknown}</span>` +
        `<span class="ft-label">${esc(node.name)}${stateSpan}</span>` +
        (isTarget ? '<span class="ft-badge" aria-hidden="true">MAIN</span>' : '') +
        (hasToggle
          ? `<button type="button" class="ft-toggle${excluded ? ' off' : ''}${partly ? ' partial' : ''}"` +
            ` data-toggle="${esc(node.path)}" data-kind="${node.kind}"` +
            ` tabindex="-1" aria-label="${esc(toggleTitle)}" title="${esc(toggleTitle)}">` +
            `${excluded ? '\u2610' : (partly ? '\u25E7' : '\u2611')}</button>`
          : '');
      li.appendChild(row);

      if (isFolder) {
        const kids = sortChildren(node);
        if (isOpen && kids.length) li.appendChild(buildList(kids, level + 1));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function render() {
    const all = (getEntries ? getEntries() : []) || [];
    const pred = (FILTERS.find(f => f[0] === activeFilter) || FILTERS[0])[2];
    const entries = all.filter(pred);

    if (summaryEl && getSummaryText) summaryEl.textContent = getSummaryText();
    if (emptyEl) {
      emptyEl.hidden = all.length > 0;
      emptyEl.textContent = 'No project files yet. Upload a document, a folder, or a project zip.';
    }

    host.innerHTML = '';
    if (entries.length === 0) { updateDetail(null); return; }
    const tree = buildTree(entries);
    host.appendChild(buildList(sortChildren(tree), 1));

    // Roving tabindex: the tree is ONE tab stop.
    const first = host.querySelector('li[role="treeitem"]');
    const sel = selectedPath && host.querySelector(`li[data-path="${CSS.escape(selectedPath)}"]`);
    const focusable = sel || first;
    if (focusable) focusable.tabIndex = 0;
  }

  function visibleItems() {
    return [...host.querySelectorAll('li[role="treeitem"]')];
  }
  function focusItem(li) {
    if (!li) return;
    visibleItems().forEach(x => { x.tabIndex = -1; });
    li.tabIndex = 0;
    li.focus();
  }
  function entryFor(path) {
    return ((getEntries ? getEntries() : []) || []).find(e => e.path === path);
  }

  function updateDetail(path) {
    if (!detailEl) return;
    const e = path ? entryFor(path) : null;
    if (!e) { detailEl.textContent = ''; return; }
    const size = e.bytes ? `${(e.bytes.length / 1024).toFixed(1)} KB`
               : (e.text ? `${(e.text.length / 1024).toFixed(1)} KB` : '');
    const bits = [e.path, e.role];
    if (size) bits.push(size);
    if (getTargetPath && e.path === getTargetPath()) bits.push('conversion target');
    else if (e.isMain) bits.push('in editor');
    detailEl.textContent = bits.join(' · ');
  }

  function select(li) {
    if (!li) return;
    visibleItems().forEach(x => x.removeAttribute('aria-selected'));
    li.setAttribute('aria-selected', 'true');
    selectedPath = li.dataset.path;
    updateDetail(li.dataset.kind === 'file' ? selectedPath : null);
  }

  // Stage 3/4: opening a file. The host decides what happens — the tree
  // does not know about editors, viewers, or pandoc.
  function open(li) {
    select(li);
    if (li.dataset.kind !== 'file') return;
    const e = entryFor(li.dataset.path);
    if (e && onOpen) {
      onOpen(e);
      render();               // the target badge may have moved
      const again = host.querySelector(`li[data-path="${CSS.escape(e.path)}"]`);
      if (again) focusItem(again);
    }
  }

  // Stage 2. The tree owns no include logic — it asks the host, which
  // asks the model. Swapping this UI moves no rules.
  function toggleInclude(li) {
    if (!li || !onToggleInclude) return;
    const btn = li.querySelector(':scope > .ft-row > .ft-toggle');
    if (!btn) return;                    // main document has no toggle
    const p = li.dataset.path;
    onToggleInclude(p, li.dataset.kind);
    render();
    const again = host.querySelector(`li[data-path="${CSS.escape(p)}"]`);
    if (again) focusItem(again);
  }

  function toggleFolder(li, open) {
    const p = li.dataset.path;
    if (open) expanded.add(p); else expanded.delete(p);
    saveExpanded();
    render();
    const again = host.querySelector(`li[data-path="${CSS.escape(p)}"]`);
    if (again) focusItem(again);
  }

  // ── keyboard: W3C APG tree pattern ─────────────────────────────
  // Arrow keys MOVE FOCUS ONLY. They never select and never open, so a
  // screen reader user can survey the project without side effects.
  let typeBuf = '', typeTimer = null;

  host.addEventListener('keydown', (ev) => {
    const cur = ev.target.closest('li[role="treeitem"]');
    if (!cur) return;
    const items = visibleItems();
    const i = items.indexOf(cur);
    const isFolder = cur.dataset.kind === 'folder';
    const isOpen = cur.getAttribute('aria-expanded') === 'true';
    let handled = true;

    switch (ev.key) {
      case 'ArrowDown': if (i < items.length - 1) focusItem(items[i + 1]); break;
      case 'ArrowUp':   if (i > 0) focusItem(items[i - 1]); break;
      case 'ArrowRight':
        if (isFolder && !isOpen) toggleFolder(cur, true);
        else if (isFolder && isOpen) {
          const kid = cur.querySelector('li[role="treeitem"]');
          if (kid) focusItem(kid);
        }
        break;
      case 'ArrowLeft':
        if (isFolder && isOpen) toggleFolder(cur, false);
        else {
          const parent = cur.parentElement.closest('li[role="treeitem"]');
          if (parent) focusItem(parent);
        }
        break;
      case 'Home': focusItem(items[0]); break;
      case 'End':  focusItem(items[items.length - 1]); break;
      case 'Enter':
        if (isFolder) toggleFolder(cur, !isOpen); else open(cur);
        break;
      case ' ':
        // Space toggles include/exclude, per the keyboard table settled
        // in the design note. Enter is for opening.
        toggleInclude(cur);
        break;
      default:
        // Type-ahead: jump to the next item starting with the typed run.
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          typeBuf += ev.key.toLowerCase();
          clearTimeout(typeTimer);
          typeTimer = setTimeout(() => { typeBuf = ''; }, 700);
          const order = items.slice(i + 1).concat(items.slice(0, i + 1));
          const hit = order.find(x =>
            x.querySelector('.ft-label').textContent.trim().toLowerCase().startsWith(typeBuf));
          if (hit) focusItem(hit);
        } else handled = false;
    }
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  });

  host.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[role="treeitem"]');
    if (!li || !host.contains(li)) return;
    // The include toggle must not also open the file or expand the row.
    if (ev.target.closest('.ft-toggle')) {
      ev.stopPropagation();
      focusItem(li);
      toggleInclude(li);
      return;
    }
    focusItem(li);
    if (li.dataset.kind === 'folder') {
      toggleFolder(li, li.getAttribute('aria-expanded') !== 'true');
    } else {
      open(li);
    }
  });

  if (filterSel) {
    for (const [value, label] of FILTERS) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      filterSel.appendChild(o);
    }
    filterSel.addEventListener('change', () => {
      activeFilter = filterSel.value;
      render();
    });
  }

  // Expand every folder on first ever use. Overleaf defaults folders
  // CLOSED because its users already know their projects; ours are
  // inspecting a fresh import and need to see the shape at a glance.
  // Deviation is deliberate; user choices persist from then on.
  function expandAllOnce(entries) {
    if (localStorage.getItem(EXPAND_KEY) !== null) return;
    for (const e of entries) {
      const parts = e.path.split('/');
      for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    }
    saveExpanded();
  }

  return {
    render(opts = {}) {
      if (opts.expandNew) expandAllOnce((getEntries ? getEntries() : []) || []);
      render();
    },
    focus() {
      const t = host.querySelector('li[tabindex="0"]') ||
                host.querySelector('li[role="treeitem"]');
      if (t) focusItem(t);
    },
    get selectedPath() { return selectedPath; },
  };
}
