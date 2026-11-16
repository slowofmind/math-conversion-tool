// read-aloud/reader/assemble-block.js: puts a reader block together from its pieces, at conversion
// time (rd-packager.js, in the browser) or for tests and hand-made pages (Node). Nothing is built in
// advance, so replacing the interface means replacing its two files here.
//
//   assembleBlock(mode, io, { mathcatVersion }) -> Promise<{ html, info }>
//     mode  'tts' (MathCat TTS) or 'pregen' (MathCat Pregen TTS)
//     io    { text(path) -> Promise<string>, bytes(path) -> Promise<Uint8Array> }, paths relative
//           to the read-aloud/ folder
//     mathcatVersion  Pregen only: the MathCAT that produced the stored speech
//
// A block = the template's comments + the interface's styles + one script made of
//   speech source + structure-marks.js (MathCat TTS only) + reader-core.js + interface + start-up
// + (MathCat TTS only) the English-only MathCAT engine, gzipped, as base64 text.

// Which interface the blocks use. To try another design, add interface-<name>.js and .css next to
// these and change this line (or pass { ui: '<name>' }).
export const DEFAULT_INTERFACE = 'default';

const MODES = {
  tts:    { template: 'reader/block-mathcat-tts.html',    source: 'reader/speech-source-mathcat-live.js',   engine: 'engine/mathcat-wasm-en/' },
  pregen: { template: 'reader/block-mathcat-pregen.html', source: 'reader/speech-source-mathcat-stored.js', engine: null }
};

function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function assembleBlock(mode, io, opts = {}) {
  const m = MODES[mode];
  if (!m) throw new Error('unknown read-aloud mode: ' + mode);
  const ui = opts.ui || DEFAULT_INTERFACE;
  const [template, source, core, uiScript, uiStyle] = await Promise.all([
    io.text(m.template), io.text(m.source), io.text('reader/reader-core.js'),
    io.text('reader/interface-' + ui + '.js'), io.text('reader/interface-' + ui + '.css')
  ]);
  let script = source;
  let version = opts.mathcatVersion || '';
  let wasmB64 = '';
  if (m.engine) {
    const [glueRaw, info, marks, bin] = await Promise.all([
      io.text(m.engine + 'mathcat_wasm.js'), io.text(m.engine + 'BUILD-INFO.json'),
      io.text('structure-marks.js'), io.bytes(m.engine + 'mathcat-wasm.bin')
    ]);
    // wasm-bindgen's loader, with its exports turned into plain functions inside the reader's script
    const glue = glueRaw.replace(/^export function /gm, 'function ').replace(/^export \{ initSync, __wbg_init as default \};\s*$/m, '');
    if (/^export /m.test(glue)) throw new Error('unexpected export left in the MathCAT loader');
    script = splice(script, /\/\*@@GLUE@@\*\//, glue, 'GLUE');
    script = splice(script, /\/\*@@STRUCTURE-MARKS@@[^*]*\*\//, marks.replace(/\n+$/, ''), 'STRUCTURE-MARKS');
    version = JSON.parse(info).mathcatVersion;
    wasmB64 = base64(bin);
  }
  script = [script.replace(/\n+$/, ''), core.replace(/\n+$/, ''), uiScript.replace(/\n+$/, ''),
    '// ---------------------------------------------------------------- start\nmountInterface(createReader(createSpeechSource));'].join('\n\n');
  if (/<\/script|<!--/i.test(script)) throw new Error('the reader script contains text that would end or break its <script> element');
  let html = template;
  const put = (marker, value) => {
    if (html.split(marker).length !== 2) throw new Error('block template ' + m.template + ': marker ' + marker + ' must appear once');
    html = html.split(marker).join(value);
  };
  put('@@STYLE@@', uiStyle.replace(/\n*$/, '\n'));
  put('@@SCRIPT@@', script);
  put('@@MATHCAT_VERSION@@', version || 'unknown');
  put('@@INTERFACE@@', 'interface-' + ui + '.js and .css');
  if (m.engine) {
    put('@@WASM_B64@@', wasmB64.match(/.{1,1000}/g).join('\n'));     // 1,000-character lines, so editors can fold the block
    put('@@DATA_KB@@', String(Math.round(wasmB64.length / 1024)));
  }
  return { html, info: { mode, interface: ui, mathcatVersion: version, scriptKB: Math.round(script.length / 1024), blockKB: Math.round(html.length / 1024) } };
}

function splice(text, marker, value, name) {
  const parts = text.split(marker);
  if (parts.length !== 2) throw new Error('reader script: marker ' + name + ' must appear once');
  return parts[0] + value + parts[1];
}
