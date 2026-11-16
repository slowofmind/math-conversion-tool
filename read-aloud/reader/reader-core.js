// ======================================================================
// reader-core.js: the shared machinery of the read-aloud readers (both versions).
// Everything the student doesn't see: finding the sentences and formulas, speaking with the
// browser's voices, tracking which word or formula part is being spoken, playback and formula
// exploring. It knows nothing about how anything looks: it announces what is happening and the
// interface (interface-*.js) draws it.
//
//   createReader(createSpeechSource) -> reader
//     createSpeechSource(ctx): what MathCAT says for each formula (speech-source-*.js)
//     reader.on(type, fn): the announcements, listed under "Announcements" below
//     reader.play() .pause() .stop(quiet) .jump(delta) .startFrom(sentence) .sentenceAt(event)
//     reader.setRate(x) .chooseVoice(index) .restartIfPlaying() .setExplore(on)
//     reader.explore(formula, command) .stopExploring() .formulaFor(element) .exploring()
//     reader.changeSourceSetting(key, value) .store(key, value) .recall(key) .start({ explore })
//     reader.state, reader.source, reader.P, reader.canHighlight
//
// Announcements (reader.on):
//   'log' (line)                    a line for the testing log
//   'status' (text, warn)           the status message
//   'mode' ()                       playing / paused / stopped changed: update the buttons
//   'voices' (voices, chosenIndex)  the browser's voices, and the one in use
//   'sentence' ({ index, sentence, ranges })   a sentence starts; ranges = its text, not its formulas
//   'sentence-clear' ()
//   'word' (range) / 'word-clear' ()            the word being spoken in a text part
//   'caption' (text, start, end)    the text being spoken, and the word in it (start..end, optional)
//   'part' ({ f, els }) / 'part-clear' ()       the formula part being spoken or explored: drawn elements
//   'subtitle' ({ f, text, start, end })        what is said for a formula, and the word in it
//   'subtitle-hide' ()
// Formulas being read or explored get the class atc-rd-active, and the drawn elements of the part
// being spoken get the attribute data-atc-rd-hl (a marker for tests). Formulas are Tab stops only
// while exploring is on (data-atc-rd-tab keeps what was there before).
// ======================================================================
function createReader(createSpeechSource) {
  const P = 'atc-rd';                                   // prefix for every id, class and stored setting
  const BLOCK_TAGS = new Set(['P','LI','UL','OL','H1','H2','H3','H4','H5','H6','DIV','SECTION','ARTICLE','MAIN',
    'BLOCKQUOTE','FIGURE','FIGCAPTION','TABLE','THEAD','TBODY','TR','TD','TH','CAPTION','DL','DT','DD','PRE',
    'HEADER','FOOTER','ASIDE','NAV','DETAILS','SUMMARY']);
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','svg','SVG']);
  const OBJ = '\uFFFC';                                 // stands in for a formula in sentence text
  const HAS_WORD = /[\p{L}\p{N}]/u;
  const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
  const synth = window.speechSynthesis;
  const pageLang = (document.documentElement.getAttribute('lang') || document.documentElement.getAttribute('xml:lang') || 'en').toLowerCase();

  // ---------------------------------------------------------------- state and helpers
  const state = {
    model: null, formulas: [], voices: [], voice: null, rate: 1,
    mode: 'idle', pos: { s: 0, p: 0, char: 0 }, noWordEvents: false, t0: 0, lastEnd: 0, mathReady: null,
    draw: 'none'                                          // 'mathjax' (drawn in advance by MathJax) or 'native' (the browser's own MathML drawing)
  };
  let runToken = 0;
  const liveUtterances = new Set();
  const listeners = {};
  const on = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const emit = (type, ...args) => {
    for (const fn of listeners[type] || []) { try { fn(...args); } catch (e) { console.error('read-aloud interface:', e); } }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  function log(msg) {
    emit('log', (state.t0 ? String(Math.round(performance.now() - state.t0)).padStart(6) : '     -') + '  ' + msg);
  }
  function setStatus(msg, warn) { emit('status', msg, !!warn); }
  function store(k, v) { try { localStorage.setItem(P + '-' + k, v); } catch (e) { /* not available */ } }
  function recall(k) { try { return localStorage.getItem(P + '-' + k); } catch (e) { return null; } }

  const source = createSpeechSource({ state, log, setStatus, pageLang, P });
  // The speech is made ready the first time someone presses "Read aloud" or explores a formula.
  function ensureSpeech() {
    if (!state.formulas.length) return Promise.resolve(true);
    if (!state.mathReady) state.mathReady = source.start();
    return state.mathReady;
  }

  // ---------------------------------------------------------------- what to read
  function hiddenOrSkipped(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute('hidden') || el.hasAttribute('data-atc-rd-skip')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.id === 'TOC' || el.getAttribute('role') === 'doc-toc') return true;   // Pandoc's table of contents
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }
  function collectBlocks(root) {
    const blocks = [];
    let current = null;
    const add = (blockEl, item) => {
      if (!current || current.el !== blockEl) { current = { el: blockEl, items: [] }; blocks.push(current); }
      current.items.push(item);
    };
    (function walk(node, blockEl) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { add(blockEl, { type: 'text', node: child }); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE || hiddenOrSkipped(child)) continue;
        if (child.localName === 'math' || child.localName === 'mjx-container') { add(blockEl, { type: 'math', el: child }); continue; }
        if (BLOCK_TAGS.has(child.tagName)) { current = null; walk(child, child); current = null; }
        else walk(child, blockEl);
      }
    })(root, root);
    return blocks;
  }
  function flatten(block) {
    let text = '';
    const map = [];
    let lastWasSpace = true;
    for (const item of block.items) {
      if (item.type === 'math') { text += OBJ; map.push({ math: item.el }); lastWasSpace = false; continue; }
      const data = item.node.data;
      for (let i = 0; i < data.length; i++) {
        if (/\s/.test(data[i])) {
          if (lastWasSpace) continue;
          text += ' '; map.push({ node: item.node, off: i }); lastWasSpace = true;
        } else { text += data[i]; map.push({ node: item.node, off: i }); lastWasSpace = false; }
      }
    }
    return { text, map };
  }
  function buildModel() {
    const segmenter = new Intl.Segmenter(pageLang, { granularity: 'sentence' });
    const byEl = new Map(state.formulas.map((f) => [f.el, f]));
    const sentences = [];
    for (const block of collectBlocks(document.body)) {
      const { text, map } = flatten(block);
      for (const seg of segmenter.segment(text)) {
        let a = seg.index, b = seg.index + seg.segment.length;
        while (a < b && text[a] === ' ') a++;
        while (b > a && text[b - 1] === ' ') b--;
        if (a >= b) continue;
        const parts = [];
        let runStart = a;
        const flushText = (end) => {
          let x = runStart, y = end;
          while (x < y && text[x] === ' ') x++;
          while (y > x && text[y - 1] === ' ') y--;
          if (x < y && HAS_WORD.test(text.slice(x, y))) parts.push({ kind: 'text', text: text.slice(x, y), map: map.slice(x, y) });
          else if (x < y && /[,;:]/.test(text.slice(x, y)) && parts.length) parts.push({ kind: 'pause', ms: 200 });
        };
        for (let i = a; i < b; i++) {
          if (text[i] === OBJ) {
            flushText(i);
            const f = byEl.get(map[i].math);
            if (f) parts.push({ kind: 'math', f });
            runStart = i + 1;
          }
        }
        flushText(b);
        if (parts.length) sentences.push({ block: block.el, parts, range: rangeFor(map[a], map[b - 1]) });
      }
    }
    return { sentences };
  }
  function pointBefore(m) {
    if (m.math) { const r = document.createRange(); r.setStartBefore(m.math); return [r.startContainer, r.startOffset]; }
    return [m.node, m.off];
  }
  function pointAfter(m) {
    if (m.math) { const r = document.createRange(); r.setEndAfter(m.math); return [r.endContainer, r.endOffset]; }
    return [m.node, m.off + 1];
  }
  function rangeFor(first, last) {
    const r = document.createRange();
    r.setStart(...pointBefore(first));
    r.setEnd(...pointAfter(last));
    return r;
  }

  // ---------------------------------------------------------------- what is being spoken (announced)
  let currentSentence = -1;
  function showSentence(i) {
    currentSentence = i;
    const sent = state.model.sentences[i];
    // The sentence's words, not its formulas: formulas get their own outline and part boxes.
    const ranges = sent.parts.filter((p) => p.kind === 'text').map((p) => rangeFor(p.map[0], p.map[p.map.length - 1]));
    emit('sentence', { index: i, sentence: sent, ranges });
    clearWord();
  }
  function clearSentence() { currentSentence = -1; emit('sentence-clear'); }
  function showWord(part, start, end) {
    if (start >= end) return;
    const first = part.map[start], last = part.map[Math.min(end, part.map.length) - 1];
    if (!first || !last) return;
    emit('word', rangeFor(first, last));
  }
  function clearWord() { emit('word-clear'); }
  function showMathPart(f, id) {
    f.el.querySelectorAll('[data-atc-rd-hl]').forEach((n) => n.removeAttribute('data-atc-rd-hl'));
    emit('part-clear');
    if (id == null) return;
    const els = (f.idMap.get(id) || []).filter((el) => el !== f.el);
    if (!els.length) return;
    els.forEach((el) => el.setAttribute('data-atc-rd-hl', ''));      // marker only, for testing
    emit('part', { f, els });
  }
  function clearMath(f) {
    f.el.classList.remove(P + '-active');
    f.el.querySelectorAll('[data-atc-rd-hl]').forEach((n) => n.removeAttribute('data-atc-rd-hl'));
    emit('part-clear');
  }
  const showSubtitle = (f, text, start, end) => emit('subtitle', { f, text, start, end });
  const hideSubtitle = () => emit('subtitle-hide');
  const showCaption = (text, start, end) => emit('caption', text, start, end);

  // ---------------------------------------------------------------- speaking
  function speak(text, opts, token, onWord) {
    return new Promise((resolve) => {
      if (token !== runToken) { resolve('cancelled'); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (state.voice) { u.voice = state.voice; u.lang = state.voice.lang; } else u.lang = pageLang;
      u.rate = clamp(state.rate, 0.1, 10);
      liveUtterances.add(u);                              // Chrome can drop events for unreferenced utterances
      let started = 0, done = false;
      const finish = (why) => {
        if (done) return;
        done = true;
        liveUtterances.delete(u);
        state.lastEnd = performance.now();
        if (token === runToken) log('   end ' + why + (started ? ' after ' + Math.round(performance.now() - started) + ' ms' : ''));
        resolve(why);
      };
      u.onstart = () => {
        started = performance.now();
        const gap = state.lastEnd ? Math.round(started - state.lastEnd) : 0;
        log('start "' + (text.length > 60 ? text.slice(0, 57) + '...' : text) + '"' + (opts.label ? ' [' + opts.label + ']' : '') + (gap ? '  gap ' + gap + ' ms' : ''));
      };
      u.onboundary = (e) => {
        if (token !== runToken || (e.name && e.name !== 'word') || !onWord) return;
        let len = e.charLength;
        if (!len) { const m = /^\S+/.exec(text.slice(e.charIndex)); len = m ? m[0].length : 1; }
        onWord(e.charIndex, len);
      };
      u.onend = () => finish('ok');
      u.onerror = (e) => finish('(' + (e.error || 'error') + ')');
      synth.speak(u);
    });
  }
  function noteWordEvents(saw, why, token) {
    if (why === 'ok' && !saw && !state.noWordEvents && token === runToken) {
      state.noWordEvents = true;
      setStatus('This voice did not report word positions, so only whole sentences and formulas are highlighted. Windows voices such as David do report them.', true);
      log('   (no word events from this voice)');
    }
  }
  async function readText(part, fromChar, token) {
    let saw = false;
    showCaption(part.text);
    const why = await speak(part.text.slice(fromChar), {}, token, (i, len) => {
      saw = true;
      const start = fromChar + i;
      state.pos.char = start;
      showWord(part, start, start + len);
      showCaption(part.text, start, start + len);
    });
    clearWord();
    noteWordEvents(saw, why, token);
  }
  // Resume a formula from the start of the part being spoken ("plus or minus", not "or minus").
  function phraseStart(f, char) {
    if (!char || !f || !f.text) return 0;
    let at = 0;
    for (const m of f.marks) { if (m.at <= char) at = m.at; else break; }
    while (at < f.text.length && /[\s,;]/.test(f.text[at])) at++;
    return at;
  }
  async function readMath(part, fromChar, token) {
    const f = part.f;
    if (!f || !f.text) { log('   (no speech for this formula)'); return; }
    const t = performance.now();
    let saw = false;
    f.el.classList.add(P + '-active');
    showCaption('');
    showSubtitle(f, f.text);
    try {
      const why = await speak(f.text.slice(fromChar), { label: 'formula ' + (f.n + 1) }, token, (i, len) => {
        saw = true;
        const start = fromChar + i;
        state.pos.char = start;
        let id;                                           // the last bookmark at or before this word
        for (const m of f.marks) { if (m.at <= start) id = m.id; else break; }
        if (id !== undefined) showMathPart(f, id);
        showSubtitle(f, f.text, start, start + len);
      });
      noteWordEvents(saw, why, token);
    } finally {
      clearMath(f);
      hideSubtitle();
      if (token === runToken) log('   formula ' + (f.n + 1) + ' took ' + Math.round(performance.now() - t) + ' ms as one piece');
    }
  }

  // ---------------------------------------------------------------- playback
  async function run(from) {
    const token = ++runToken;
    synth.cancel();
    if (synth.paused) synth.resume();
    stopNavigation();
    state.mode = 'playing';
    emit('mode');
    await ensureSpeech();
    await sleep(60);                                    // Chrome can drop a speak() that follows cancel() too closely
    if (token !== runToken) return;
    state.t0 = state.t0 || performance.now();
    setStatus('Reading with ' + (state.voice ? state.voice.name : 'the default voice') + '.');
    const sentences = state.model.sentences;
    let { s, p, char } = from;
    for (; s < sentences.length; s++, p = 0, char = 0) {
      if (token !== runToken) return;
      if (currentSentence !== s) showSentence(s);
      const sent = sentences[s];
      for (; p < sent.parts.length; p++, char = 0) {
        if (token !== runToken) return;
        state.pos = { s, p, char };
        const part = sent.parts[p];
        if (part.kind === 'text') await readText(part, char, token);
        else if (part.kind === 'math') await readMath(part, phraseStart(part.f, char), token);
        else await sleep(part.ms / state.rate);
      }
    }
    if (token === runToken) { log('finished'); stop(true); setStatus('Finished. Press "Read aloud" to start again.'); }
  }
  function halt() { runToken++; synth.cancel(); }
  function play() {
    if (!state.model) return;
    if (state.mode === 'playing') { pause(); return; }
    if (state.mode !== 'paused') { state.t0 = performance.now(); state.lastEnd = 0; log('--- reading started ---'); }
    run(state.pos);
  }
  function pause() {
    halt();
    state.mode = 'paused';
    clearWord();
    emit('mode');
    setStatus('Paused. Press "Resume" to continue from the current word.');
    log('paused');
  }
  function clearAllMath() { state.formulas.forEach(clearMath); }
  function stop(quiet) {
    halt();
    state.mode = 'ready';
    state.pos = { s: 0, p: 0, char: 0 };
    clearWord(); clearSentence(); clearAllMath(); hideSubtitle();
    showCaption('');
    emit('mode');
    if (!quiet) { setStatus('Stopped.'); log('stopped'); }
  }
  function goTo(s) {
    halt();
    clearAllMath();
    state.pos = { s, p: 0, char: 0 };
    showSentence(s);
    if (!state.t0) state.t0 = performance.now();
    log('--- reading from sentence ' + (s + 1) + ' ---');
    run(state.pos);
  }
  function jump(delta) {
    if (!state.model) return;
    const base = state.mode === 'ready' && currentSentence < 0 ? -1 : state.pos.s;
    goTo(clamp(base + delta, 0, state.model.sentences.length - 1));
  }
  function restartIfPlaying() { if (state.mode === 'playing') run({ ...state.pos }); }

  // ---------------------------------------------------------------- exploring a formula
  const nav = { f: null };
  function stopNavigation() {
    if (!nav.f) return;
    clearMath(nav.f);
    hideSubtitle();
    nav.f = null;
  }
  async function explore(f, command) {
    if (state.mode === 'playing') pause();
    if (!(await ensureSpeech())) return;
    if (nav.f !== f) {
      stopNavigation();
      nav.f = f;
      source.enterFormula(f);                           // back at the formula's start (MathCAT's starting position)
      log('exploring formula ' + (f.n + 1));
    }
    const step = source.navigate(f, command);           // { text, part, log } | { restart: true, log } | null
    if (!step) return;
    if (step.restart) {                                 // MathCAT couldn't move from here: the formula starts over, silently
      clearMath(f); hideSubtitle();
      log(step.log);
      return;
    }
    f.el.classList.add(P + '-active');
    showSubtitle(f, step.text);                         // before the box: a caption that changes the toolbar's height moves the page
    showMathPart(f, step.part);
    log(step.log);
    const token = ++runToken;                           // cut off the previous announcement
    synth.cancel();
    await sleep(30);
    if (token === runToken && step.text) {
      if (!state.t0) state.t0 = performance.now();
      await speak(step.text, { label: 'explore' }, token, (i, len) => showSubtitle(f, step.text, i, i + len));
    }
  }
  function stopExploring() { halt(); stopNavigation(); }
  // Formulas become Tab stops only while exploring is on, so the page behaves exactly as before for
  // keyboard and screen-reader users who don't use the reader.
  function setExplore(onOff) {
    for (const f of state.formulas) {
      if (onOff) {
        if (!f.el.hasAttribute('data-atc-rd-tab')) f.el.setAttribute('data-atc-rd-tab', f.el.getAttribute('tabindex') ?? 'none');
        f.el.setAttribute('tabindex', '0');
      } else if (f.el.hasAttribute('data-atc-rd-tab')) {
        const before = f.el.getAttribute('data-atc-rd-tab');
        if (before === 'none') f.el.removeAttribute('tabindex'); else f.el.setAttribute('tabindex', before);
        f.el.removeAttribute('data-atc-rd-tab');
      }
    }
    if (!onOff) { halt(); stopNavigation(); }
  }

  // ---------------------------------------------------------------- start reading where clicked
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, off: p.offset } : null; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, off: r.startOffset } : null; }
    return null;
  }
  function sentenceAt(event) {
    if (!state.model) return -1;
    const sentences = state.model.sentences;
    const mathEl = event.target.closest && event.target.closest('mjx-container, math');
    if (mathEl) return sentences.findIndex((s) => s.parts.some((p) => p.f && p.f.el === mathEl));
    const pos = caretAt(event.clientX, event.clientY);
    if (pos) {
      const i = sentences.findIndex((s) => { try { return s.range.isPointInRange(pos.node, pos.off); } catch (e) { return false; } });
      if (i >= 0) return i;
    }
    const block = event.target.closest && event.target.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,figcaption');
    return block ? sentences.findIndex((s) => s.block === block) : -1;
  }
  function startFrom(i) { stopNavigation(); goTo(i); }

  // ---------------------------------------------------------------- voices
  function loadVoices() {
    const voices = synth.getVoices();
    if (!voices.length) return;
    state.voices = voices;
    const lang = pageLang.split('-')[0];
    const saved = recall('voice');
    let pick = voices.findIndex((v) => v.name === saved);
    if (pick < 0 && lang === 'en') pick = voices.findIndex((v) => /david/i.test(v.name) && v.localService);
    if (pick < 0) pick = voices.findIndex((v) => v.default && v.localService && v.lang.toLowerCase().startsWith(lang));
    if (pick < 0) pick = voices.findIndex((v) => v.localService && v.lang.toLowerCase().startsWith(lang));
    if (pick < 0) pick = 0;
    emit('voices', voices, pick);
    chooseVoice(pick, true);
  }
  function chooseVoice(i, initial) {
    state.voice = state.voices[i] || null;
    state.noWordEvents = false;
    if (!initial) store('voice', state.voice ? state.voice.name : '');
    log('voice: ' + (state.voice ? state.voice.name + ' [' + state.voice.lang + (state.voice.localService ? ', on this computer' : ', online') + ']' : 'default'));
    if (state.voice && !state.voice.localService) setStatus('This is an online voice. It will not work without internet and may not report word positions.', true);
  }

  // ---------------------------------------------------------------- settings of the speech source
  async function changeSourceSetting(key, value) {
    const s = (source.settings || []).find((x) => x.key === key);
    if (!s) return;
    s.value = value;
    store(key, value);
    if (!state.mathReady) return;                       // applied when the speech starts
    if (!(await state.mathReady)) return;
    source.applySetting(s);
    const wasPlaying = state.mode === 'playing';
    if (wasPlaying) halt();
    stopNavigation();
    source.prepareAll();
    log(s.pref + ' set to ' + value);
    if (wasPlaying) { const pos = { ...state.pos }; if (state.model.sentences[pos.s].parts[pos.p].kind === 'math') pos.char = 0; run(pos); }
  }

  // ---------------------------------------------------------------- start-up
  function start(opts = {}) {
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') { setStatus('This browser has no built-in speech, so nothing can be read aloud.', true); return; }
    if (typeof Intl === 'undefined' || !Intl.Segmenter) { setStatus('This browser is too old to split text into sentences. Use a current Chrome, Edge, Firefox or Safari.', true); return; }
    if (window.MathJax || document.querySelector('script[src*="mathjax" i]')) {
      setStatus('This page loads MathJax, which redraws the math while the page runs, so this reader can\'t follow it. Use a page drawn in advance (or plain MathML) without MathJax.', true);
      log('MathJax found on the page; reader disabled');
      return;
    }
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;

    state.formulas = source.findFormulas().map((f) => Object.assign(f, { text: '', marks: [], idMap: new Map() }));
    const problem = source.check ? source.check() : '';
    if (problem) { setStatus(problem.status, true); log(problem.log); return; }
    log('math drawn by: ' + source.describe());
    state.model = buildModel();
    setExplore(!!opts.explore);
    state.mode = 'ready';
    emit('mode');
    log('page ready: ' + state.model.sentences.length + ' sentences, ' + state.formulas.length + ' formulas, language ' + pageLang);
    setStatus('Read aloud is ready to start.');
    if (!canHighlight) setStatus('Ready, but this browser cannot show highlighting. Use a current Chrome, Edge, Firefox or Safari.', true);
  }
  window.addEventListener('beforeunload', () => synth && synth.cancel());

  return {
    P, state, source, canHighlight, on, store, recall,
    play, pause, stop, jump, startFrom, sentenceAt, setRate: (x) => { state.rate = x; }, chooseVoice, restartIfPlaying,
    setExplore, explore, stopExploring, exploring: () => nav.f,
    formulaFor: (el) => state.formulas.find((x) => x.el === el),
    changeSourceSetting, start
  };
}
