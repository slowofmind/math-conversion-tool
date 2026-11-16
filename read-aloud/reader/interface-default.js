// ======================================================================
// interface-default.js: what the student sees and uses (both versions share it).
// The toolbar and its settings, the testing log, how the sentence, word and formula-part
// highlights look, the subtitles under formulas, and the keyboard and click controls.
// Its styles are in interface-default.css. To try another design, replace these two files (or
// add new ones and point read-aloud/rd-packager.js at them); the machinery (reader-core.js)
// and the speech sources stay as they are.
//   mountInterface(reader): builds everything, listens to the reader's announcements
//   (reader-core.js lists them), wires the controls, then starts the reader.
// ======================================================================
function mountInterface(reader) {
  const P = reader.P;
  const state = reader.state;

  // ---------------------------------------------------------------- the toolbar and log
  const sourceSettings = reader.source.settings || [];
  const settingsRow = sourceSettings.length
    ? `<div class="${P}-row">` + sourceSettings.map((s) =>
        `<label>${s.label} <select id="${P}-${s.id}">` + s.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + `</select></label>`).join('\n      ') + `</div>`
    : '';
  const bar = document.createElement('div');
  bar.className = P + '-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Read aloud');
  bar.setAttribute('data-atc-rd-skip', '');
  bar.innerHTML = `
  <div class="${P}-row" role="group" aria-label="Playback">
    <button type="button" id="${P}-play" class="${P}-primary" disabled>Read aloud</button>
    <button type="button" id="${P}-stop" disabled>Stop</button>
    <button type="button" id="${P}-prev" disabled>Previous sentence</button>
    <button type="button" id="${P}-next" disabled>Next sentence</button>
  </div>
  <div class="${P}-row">
    <label>Voice <select id="${P}-voice"></select></label>
    <label>Speed <input type="range" id="${P}-rate" min="0.5" max="2" step="0.1" value="1"> <output id="${P}-rate-out" for="${P}-rate">1.0×</output></label>
    <label><input type="checkbox" id="${P}-subs"> Subtitles under formulas</label>
  </div>
  <details class="${P}-more">
    <summary>More settings</summary>
    ${settingsRow}
    <div class="${P}-row">
      <label><input type="checkbox" id="${P}-click" checked> Start reading at the sentence I click</label>
      <label><input type="checkbox" id="${P}-explore"> Explore formulas with the keyboard</label>
    </div>
    <div class="${P}-help">To explore a formula, turn on the setting above, press Tab until the formula is outlined, then use the arrow keys: right and left move between parts, down zooms in, up zooms out, Home and End go to the first and last part, Space reads the current part, Esc stops.</div>
  </details>
  <div class="${P}-status" id="${P}-status">Read aloud is ready to start.</div>
  <div class="${P}-caption" id="${P}-caption" aria-hidden="true"></div>`;
  document.body.prepend(bar);

  const logBox = document.createElement('details');
  logBox.className = P + '-log';
  logBox.setAttribute('data-atc-rd-skip', '');
  logBox.innerHTML = `<summary>Read-aloud log (for testing)</summary><textarea id="${P}-log" readonly aria-label="Read-aloud log"></textarea>`;
  document.body.append(logBox);

  const $ = (id) => document.getElementById(P + '-' + id);
  const ui = {
    play: $('play'), stop: $('stop'), prev: $('prev'), next: $('next'), voice: $('voice'),
    rate: $('rate'), rateOut: $('rate-out'), click: $('click'), explore: $('explore'), subs: $('subs'),
    status: $('status'), caption: $('caption'), log: $('log')
  };

  reader.on('log', (line) => {
    const lines = ui.log.value ? ui.log.value.split('\n') : [];
    lines.push(line);
    ui.log.value = lines.slice(-500).join('\n');
    ui.log.scrollTop = ui.log.scrollHeight;
  });
  reader.on('status', (msg, warn) => { ui.status.textContent = msg; ui.status.classList.toggle(P + '-warn', warn); });
  reader.on('mode', () => {
    const ready = !!state.model && state.model.sentences.length > 0;
    ui.play.disabled = !ready;
    ui.stop.disabled = !ready || state.mode === 'ready';
    ui.prev.disabled = !ready;
    ui.next.disabled = !ready;
    ui.play.textContent = state.mode === 'playing' ? 'Pause' : state.mode === 'paused' ? 'Resume' : 'Read aloud';
  });
  reader.on('voices', (voices, pick) => {
    ui.voice.textContent = '';
    voices.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = v.name + (v.localService ? '' : ' (online)');
      ui.voice.append(o);
    });
    ui.voice.value = String(pick);
  });

  // ---------------------------------------------------------------- highlighting
  // The sentence's words and the word being spoken use the browser's CSS Custom Highlight API
  // (::highlight(atc-rd-sentence) and ::highlight(atc-rd-word) in the styles).
  const canHighlight = reader.canHighlight;
  reader.on('sentence', ({ sentence, ranges }) => {
    if (canHighlight) {
      if (ranges.length) CSS.highlights.set(P + '-sentence', new Highlight(...ranges));
      else CSS.highlights.delete(P + '-sentence');
    }
    const rect = sentence.range.getBoundingClientRect();
    const barH = bar.getBoundingClientRect().height;
    if (rect.top < barH + 8 || rect.bottom > window.innerHeight - 8) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      sentence.block.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  });
  reader.on('sentence-clear', () => { if (canHighlight) CSS.highlights.delete(P + '-sentence'); });
  reader.on('word', (range) => {
    if (!canHighlight) return;
    const hl = new Highlight(range);
    hl.priority = 1;
    CSS.highlights.set(P + '-word', hl);
  });
  reader.on('word-clear', () => { if (canHighlight) CSS.highlights.delete(P + '-word'); });

  // Formula parts are highlighted with an overlay box drawn from where the part was drawn
  // (by MathJax, or by the browser's own MathML layout), so the box covers the whole part (radical signs, fraction bars,
  // stretched brackets), not just its characters. The box sits on top of the math with
  // mix-blend-mode: multiply, so it tints like a highlighter pen and the symbols stay dark.
  // Parts that MathCAT maps to several elements get one box per line, around all of them.
  let partBoxes = [];                                   // the overlay boxes now on screen
  let currentPart = null;                               // the drawn elements, for redrawing after resize/zoom
  function removePartBoxes() { partBoxes.forEach((b) => b.remove()); partBoxes = []; }
  function drawPartBoxes(els) {
    removePartBoxes();
    const rects = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    // group rectangles that sit on the same line (they overlap vertically), then box each group
    const lines = [];
    for (const r of rects.sort((a, b) => a.top - b.top)) {
      const line = lines.find((l) => r.top < l.bottom && r.bottom > l.top);
      if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
      else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    const pad = 2;
    for (const l of lines) {
      const b = document.createElement('div');
      b.className = P + '-partbox';
      b.setAttribute('aria-hidden', 'true');
      b.setAttribute('data-atc-rd-skip', '');
      b.style.left = (l.left + window.scrollX - pad) + 'px';
      b.style.top = (l.top + window.scrollY - pad) + 'px';
      b.style.width = (l.right - l.left + 2 * pad) + 'px';
      b.style.height = (l.bottom - l.top + 2 * pad) + 'px';
      document.body.appendChild(b);
      partBoxes.push(b);
    }
  }
  reader.on('part', ({ els }) => { currentPart = els; drawPartBoxes(els); });
  reader.on('part-clear', () => { removePartBoxes(); currentPart = null; });
  // Anything that moves the math (zoom, window size, the toolbar growing when its caption wraps
  // onto another line) would leave the box behind, so redraw it whenever the layout changes.
  const redrawPart = () => { if (currentPart) drawPartBoxes(currentPart); };
  window.addEventListener('resize', redrawPart);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(redrawPart);
    ro.observe(document.body);
    ro.observe(bar);
  }

  // Subtitles: a box just below the formula, styled like MathJax's own subtitle region. With
  // subtitles off, what is said for a formula shows in the toolbar's caption line instead.
  const subtitle = document.createElement('div');
  subtitle.className = P + '-subtitle';
  subtitle.setAttribute('aria-hidden', 'true');
  subtitle.setAttribute('data-atc-rd-skip', '');
  subtitle.appendChild(document.createElement('div'));
  document.body.append(subtitle);
  function fillWithMark(box, text, start, end) {
    box.textContent = '';
    if (start == null) { box.textContent = text; return; }
    box.append(text.slice(0, start));
    const m = document.createElement('mark');
    m.textContent = text.slice(start, end);
    box.append(m, text.slice(end));
  }
  function showCaption(text, start, end) { fillWithMark(ui.caption, text, start, end); }
  reader.on('caption', showCaption);
  reader.on('subtitle', ({ f, text, start, end }) => {
    if (!ui.subs.checked) { showCaption(text, start, end); return; }
    fillWithMark(subtitle.firstChild, text, start, end);
    const r = (f.drawRoot || f.el).getBoundingClientRect();
    subtitle.classList.add(P + '-subtitle-show');
    const w = subtitle.offsetWidth;
    const left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8));
    subtitle.style.top = (r.bottom + 10 + window.scrollY) + 'px';
    subtitle.style.left = (left + window.scrollX) + 'px';
  });
  function hideSubtitle() { subtitle.classList.remove(P + '-subtitle-show'); subtitle.firstChild.textContent = ''; }
  reader.on('subtitle-hide', hideSubtitle);

  // ---------------------------------------------------------------- settings (remembered in this browser)
  ui.rate.value = reader.recall('rate') || '1';
  reader.setRate(parseFloat(ui.rate.value));
  ui.rateOut.textContent = state.rate.toFixed(1) + '×';
  for (const s of sourceSettings) {
    const saved = reader.recall(s.key);
    if (saved !== null && s.options.some(([v]) => v === saved)) s.value = saved;
    $(s.id).value = s.value;
    $(s.id).addEventListener('change', () => reader.changeSourceSetting(s.key, $(s.id).value));
  }
  ui.click.checked = reader.recall('click') !== 'false';
  ui.explore.checked = reader.recall('explore') === 'true';
  ui.subs.checked = reader.recall('subs') === 'true';           // off unless the student turned them on

  // ---------------------------------------------------------------- controls
  ui.play.addEventListener('click', reader.play);
  ui.stop.addEventListener('click', () => { reader.stopExploring(); reader.stop(false); });
  ui.prev.addEventListener('click', () => reader.jump(-1));
  ui.next.addEventListener('click', () => reader.jump(1));
  ui.voice.addEventListener('change', () => { reader.chooseVoice(parseInt(ui.voice.value, 10)); reader.restartIfPlaying(); });
  ui.rate.addEventListener('input', () => { reader.setRate(parseFloat(ui.rate.value)); ui.rateOut.textContent = state.rate.toFixed(1) + '×'; });
  ui.rate.addEventListener('change', () => { reader.store('rate', ui.rate.value); reader.restartIfPlaying(); });
  ui.click.addEventListener('change', () => reader.store('click', String(ui.click.checked)));
  ui.explore.addEventListener('change', () => { reader.store('explore', String(ui.explore.checked)); reader.setExplore(ui.explore.checked); });
  ui.subs.addEventListener('change', () => { reader.store('subs', String(ui.subs.checked)); if (!ui.subs.checked) hideSubtitle(); });
  // Click a sentence to start reading there.
  document.addEventListener('click', (event) => {
    if (!ui.click.checked || !state.model || event.target.closest('[data-atc-rd-skip], a, button, input, select, textarea, summary')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;                // the reader is selecting text, not asking to listen
    const i = reader.sentenceAt(event);
    if (i >= 0) reader.startFrom(i);
  });
  // Exploring with the keyboard (MathCAT's commands, as NVDA's MathCAT uses them).
  const NAV_KEYS = {
    'ArrowRight': 'MoveNext', 'ArrowLeft': 'MovePrevious', 'ArrowDown': 'ZoomIn', 'ArrowUp': 'ZoomOut',
    'Ctrl+ArrowDown': 'ZoomInAll', 'Ctrl+ArrowUp': 'ZoomOutAll', 'Home': 'MoveStart', 'End': 'MoveEnd',
    ' ': 'ReadCurrent'
  };
  document.addEventListener('keydown', (event) => {
    if (!ui.explore.checked || !state.model) return;
    const mathEl = event.target.closest && event.target.closest('mjx-container, math');
    if (!mathEl || event.altKey || event.metaKey) return;
    const f = reader.formulaFor(mathEl);
    if (!f) return;
    if (event.key === 'Escape') { reader.stopExploring(); event.preventDefault(); return; }
    const command = NAV_KEYS[(event.ctrlKey ? 'Ctrl+' : '') + event.key];
    if (!command) return;
    event.preventDefault();
    reader.explore(f, command);
  });
  document.addEventListener('focusout', (event) => {
    const f = reader.exploring();
    if (f && event.target === f.el) reader.stopExploring();
  });

  // For testing from the browser console
  window.ATCReadAloud = Object.assign({ state, subtitle }, reader.source.debug || {});
  reader.start({ explore: ui.explore.checked });
}
