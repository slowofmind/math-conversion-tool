// read-aloud/rd-workbench.js: runs inside rd-workbench.html (a hidden helper page).
// window.rdWorkbench = { ready, drawMath(html), pregenerate(html) }, called by rd-packager.js.
import { usedCharacters, cutFonts } from './rd-fonts.js';
import initMathCAT, * as MC from '../mathcat-wasm/mathcat_wasm.js';

const here = (p) => new URL(p, import.meta.url).href;
const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');
const serialize = (doc) => '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

// ---------------------------------------------------------------- drawing the math (both versions)
// Every MathML element gets a data-atc-id label and every formula a number (data-atc-formula);
// MathJax draws each formula as HTML (CHTML) and copies the labels onto what it draws; the original
// labelled MathML goes into the formula's hidden copy (screen readers, and MathCAT). MathJax's styles
// are added with its fonts cut to the characters the page uses.
async function drawMath(html) {
  await MathJax.startup.promise;
  const adaptor = MathJax.startup.adaptor;
  const doc = parseHtml(html);
  const maths = Array.from(doc.querySelectorAll('math')).filter((m) => !m.closest('[data-atc-rd-skip], mjx-assistive-mml'));
  const xml = new XMLSerializer();
  let containersHtml = '';
  for (const [n, m] of maths.entries()) {
    [m, ...m.querySelectorAll('*')].forEach((el, k) => el.setAttribute('data-atc-id', 'f' + n + '-' + k));
    m.setAttribute('data-atc-formula', String(n));
    const display = m.getAttribute('display') === 'block';
    const node = await MathJax.mathml2chtmlPromise(xml.serializeToString(m), { display });
    const holder = doc.createElement('template');
    holder.innerHTML = adaptor.outerHTML(node);
    const container = holder.content.firstElementChild;
    const hidden = container.querySelector('mjx-assistive-mml');
    if (hidden) hidden.replaceChildren(m.cloneNode(true));   // MathJax's own copy drops the labels
    containersHtml += container.outerHTML;
    m.replaceWith(container);
  }
  let css = adaptor.textContent(MathJax.chtmlStylesheet());
  const used = usedCharacters(document, css, containersHtml);
  const fonts = await cutFonts(css, used);
  const style = doc.createElement('style');
  style.id = 'atc-mjx-chtml-style';
  style.textContent = fonts.css;
  doc.head.appendChild(style);
  return { html: serialize(doc), formulas: maths.length, fonts: fonts.report, fontBytes: fonts.bytes };
}

// ---------------------------------------------------------------- pre-generated speech (Pregen)
// MathCAT (this page's own copy) produces each formula's speech with bookmarks and the complete
// arrow-key exploring map; both are stored as JSON in the page. Settings: the MathCAT NVDA add-on
// 0.7.7's defaults with Verbosity = Verbose, bookmarks on and capitals said as "cap", exactly as in
// the MathCat TTS reader (Nicholas, 2026-11-10).
const PREFS = [['TTS', 'SSML'], ['Bookmark', 'true'], ['Impairment', 'Blindness'], ['Language', 'en'], ['Verbosity', 'Verbose'],
  ['MathRate', '100'], ['PauseFactor', '100'], ['SpeechSound', 'None'], ['SpeechStyle', 'ClearSpeak'], ['SubjectArea', 'General'],
  ['Chemistry', 'SpellOut'], ['NavMode', 'Enhanced'], ['ResetNavMode', 'false'], ['Overview', 'false'], ['ResetOverview', 'true'],
  ['NavVerbosity', 'Medium'], ['AutoZoomOut', 'true'], ['IgnoreBold', 'false'], ['CapitalLetters_Beep', 'false'], ['CapitalLetters_UseWord', 'true'], ['CapitalLetters_Pitch', '0']];
const COMMANDS = ['MoveNext', 'MovePrevious', 'ZoomIn', 'ZoomOut', 'ZoomInAll', 'ZoomOutAll', 'MoveStart', 'MoveEnd', 'ReadCurrent'];
let mathcatReady = null;
function startMathCAT() {
  if (!mathcatReady) mathcatReady = (async () => {
    const r = await fetch(here('../mathcat-wasm/mathcat-wasm.bin'));
    if (!r.ok) throw new Error('mathcat-wasm.bin not found (HTTP ' + r.status + ')');
    const bytes = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    await initMathCAT({ module_or_path: bytes });
    MC.init();
    for (const [k, v] of PREFS) MC.setPreference(k, v);
    return MC.version();
  })();
  return mathcatReady;
}

// MathCAT's SSML as plain text with bookmark positions: a pause becomes "," or ";", the letter "a"
// becomes "eigh", MathCAT's stray "[[" is removed. Same rules as the MathCat TTS reader.
function ssmlToSpeech(ssml) {
  const d = new DOMParser().parseFromString('<speak>' + ssml + '</speak>', 'application/xml');
  if (d.getElementsByTagName('parsererror').length) return { text: ssml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), marks: [] };
  let text = ''; const marks = [];
  const addWords = (t) => { t = t.replace(/\s+/g, ' ').trim(); if (!t) return; if (text && !/\s$/.test(text)) text += ' '; text += t; };
  const addPause = (ms) => {
    if (ms <= 50) return; text = text.replace(/\s+$/, ''); if (!text) return;
    const p = ms <= 250 ? ',' : ';';
    if (/[,;]$/.test(text)) { if (p === ';') text = text.slice(0, -1) + ';'; } else text += p;
    marks.push({ at: text.length, id: null });
  };
  (function walk(nodes) {
    for (const n of nodes) {
      if (n.nodeType === 3) { addWords(n.data.replace(/\[\[|\]\]/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (tag === 'mark') marks.push({ at: text.length, id: n.getAttribute('name') });
      else if (tag === 'break') { const t = n.getAttribute('time') || ''; addPause(/ms$/.test(t) ? parseFloat(t) : parseFloat(t) * 1000 || 0); }
      else if (tag === 'say-as') { const t = n.textContent.trim(); addWords(/^a$/i.test(t) ? 'eigh' : t); }
      else if (tag !== 'audio') walk(n.childNodes);
    }
  })(d.documentElement.childNodes);
  text = text.replace(/[\s,;]+$/, '');
  return { text, marks: marks.filter((m) => m.at < text.length || m.id === null) };
}

function pregenerateFormula(source, drawnLabels, rootLabel) {
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  // MathCAT gives the groupings it adds new random ids on every setMathML, so positions are recorded
  // as paths through MathCAT's tidied tree ("0.2.1"), which stay the same between calls, and turned
  // back into ids against the tree MathCAT holds now (`cdoc`, replaced on every reload).
  const pathOf = (doc, id) => {
    let el = doc.querySelector('[id="' + id + '"]'); if (!el) return null;
    const steps = [];
    while (el.parentElement) { steps.unshift(Array.prototype.indexOf.call(el.parentElement.children, el)); el = el.parentElement; }
    return steps.join('.');
  };
  const nodeAt = (doc, p) => { let el = doc.documentElement; if (p) for (const i of p.split('.')) el = el.children[+i]; return el; };
  const keyOf = (doc, id, offset) => {
    const p = pathOf(doc, id);
    if (p === null) throw new Error('MathCAT moved to "' + id + '", which is not in its tidied MathML');
    return p + ':' + offset;
  };
  const said = [], saidIndex = new Map();
  const speechId = (ssml) => { const t = ssmlToSpeech(ssml).text; if (!saidIndex.has(t)) { saidIndex.set(t, said.length); said.push(t); } return saidIndex.get(t); };
  // 1. keys pressed first on a fresh formula (MathCAT's starting position), each on a fresh copy
  const startMoves = COMMANDS.map((cmd) => {
    const doc = parse(MC.setMathML(source));
    const ssml = MC.doNavigateCommand(cmd);
    const [id, offset] = MC.getNavigationMathMLId();
    return { key: keyOf(doc, id, offset), sp: speechId(ssml), cmd };
  });
  // 2. the tidied copy used for everything else
  let cdoc = parse(MC.setMathML(source));
  const reload = () => { cdoc = parse(MC.setMathML(source)); };
  const whole = ssmlToSpeech(MC.getSpokenText());
  const resolve = (node) => { const id = node.getAttribute('id'); if (id && drawnLabels.has(id)) return [id]; return Array.from(node.children).flatMap(resolve); };
  const parts = [], partIndex = new Map();
  const partFor = (id) => {                            // -1 = the whole formula; null = nothing to box
    if (id == null) return null;
    const p = pathOf(cdoc, id);
    if (id === rootLabel || p === '' || (p === '0' && cdoc.documentElement.children.length === 1)) return -1;
    const node = p === null ? null : nodeAt(cdoc, p);
    const labels = node ? resolve(node) : (drawnLabels.has(id) ? [id] : []);
    if (!labels.length) return null;
    const key = labels.join(' ');
    if (!partIndex.has(key)) { partIndex.set(key, parts.length); parts.push(key); }
    return partIndex.get(key);
  };
  const marks = [];
  for (const { at, id } of addStructureMarks(whole.text, whole.marks, cdoc)) {   // structure-marks.js
    if (id === null) { marks.push([at, null]); continue; }
    const p = partFor(id);
    if (p !== null) marks.push([at, p]);
  }
  // 3. every other position: put MathCAT there and try every key
  const states = [{ key: 'start', path: [], part: -1 }];
  const byKey = new Map([['start', 0]]);
  const addState = (key, fromPath, cmd) => {
    if (!byKey.has(key)) {
      const [p, offset] = key.split(':');
      byKey.set(key, states.length);
      states.push({ key, nodePath: p, offset: +offset, path: [...fromPath, cmd], part: partFor(nodeAt(cdoc, p).getAttribute('id')) });
    }
    return byKey.get(key);
  };
  const moves = [startMoves.map((m) => [addState(m.key, [], m.cmd), m.sp])];
  let replays = 0, restarts = 0;
  const RESTART = -1;                                // a move after which the formula starts over (stored as "r")
  // MathCAT 0.7.7 refuses to be put on some positions it reports itself (the whole formula with
  // offset 1, reached by ZoomOutAll from some places). There, it is reloaded and the same keys are
  // pressed again from the start, which leaves it exactly where a student pressing them would be.
  const goTo = (st) => {
    try { MC.setNavigationNode(nodeAt(cdoc, st.nodePath).getAttribute('id'), st.offset); return; }
    catch (e) { if (e instanceof WebAssembly.RuntimeError) throw e; }
    reload();
    for (const c of st.path) MC.doNavigateCommand(c);
    replays++;
  };
  for (let s = 1; s < states.length && s < 2000; s++) {
    moves[s] = [];
    for (const cmd of COMMANDS) {
      goTo(states[s]);
      let ssml;
      try { ssml = MC.doNavigateCommand(cmd); }
      catch (e) {                                      // MathCAT can't move from here: the readers start the formula over
        if (e instanceof WebAssembly.RuntimeError) throw e;
        moves[s].push([0, RESTART]); restarts++;
        continue;
      }
      const [id, offset] = MC.getNavigationMathMLId();
      moves[s].push([addState(keyOf(cdoc, id, offset), states[s].path, cmd), speechId(ssml)]);
    }
  }
  // compact exploring map: "part|own speech|move,move,…" (base 36; ".speech" only when MathCAT says
  // something other than the target position's own "read current" speech)
  const silent = restarts ? speechId('') : -1;          // (only formulas with a restart get an empty speech entry)
  const own = moves.map((mv) => { const x = mv[COMMANDS.indexOf('ReadCurrent')][1]; return x === RESTART ? silent : x; });
  const enc = (x) => x.toString(36);
  const nav = states.map((st, i) => (st.part === -1 ? '-' : st.part === null ? '' : enc(st.part)) + '|' + enc(own[i]) + '|' +
    moves[i].map(([to, sp]) => (sp === RESTART ? 'r' : sp === own[to] ? enc(to) : enc(to) + '.' + enc(sp))).join(','));
  return { data: { t: whole.text, m: marks, p: parts, s: said, n: nav }, states: states.length, replays, restarts };
}

async function pregenerate(html) {
  const version = await startMathCAT();
  const doc = parseHtml(html);
  const xml = new XMLSerializer();
  const data = { commands: COMMANDS, generator: 'MathCAT ' + version + ', ClearSpeak, Verbose (NVDA add-on defaults)', formulas: [] };
  const stats = { formulas: 0, positions: 0, failed: 0, replays: 0, restarts: 0 };
  for (const c of Array.from(doc.querySelectorAll('mjx-container'))) {
    const hidden = c.querySelector('mjx-assistive-mml > math[data-atc-formula]');
    if (!hidden) continue;
    const n = parseInt(hidden.getAttribute('data-atc-formula'), 10);
    const drawnLabels = new Set(Array.from(c.querySelectorAll(':scope > mjx-math [data-atc-id]')).map((e) => e.getAttribute('data-atc-id')));
    const copy = hidden.cloneNode(true);
    copy.removeAttribute('data-atc-formula');
    for (const el of [copy, ...copy.querySelectorAll('*')]) { el.setAttribute('id', el.getAttribute('data-atc-id')); el.removeAttribute('data-atc-id'); }
    try {
      const r = pregenerateFormula(xml.serializeToString(copy), drawnLabels, hidden.getAttribute('data-atc-id'));
      data.formulas[n] = r.data; stats.positions += r.states; stats.replays += r.replays; stats.restarts += r.restarts; stats.formulas++;
    } catch (e) {
      data.formulas[n] = { t: '', m: [], p: [], s: [], n: [] }; stats.failed++;
      console.warn('MathCAT could not pre-generate formula ' + (n + 1) + ':', e);
    }
    for (const el of [hidden, ...hidden.querySelectorAll('*')]) el.removeAttribute('data-atc-id');   // not needed by screen readers
    c.setAttribute('data-atc-formula', String(n));
  }
  const json = doc.createElement('script');
  json.type = 'application/json'; json.id = 'atc-rd-mcspeech';
  json.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  doc.body.appendChild(json);
  stats.speechBytes = json.textContent.length;
  return { html: serialize(doc), stats, mathcatVersion: version };
}

window.rdWorkbench = { ready: MathJax.startup.promise.then(() => true), drawMath, pregenerate };
