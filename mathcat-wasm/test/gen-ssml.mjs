// gen-ssml.mjs — step 1 of golden generation (plan T1).
// Drives the built MathCAT wasm DIRECTLY (not through mathcat.js) in the call
// order the MathCAT NVDA add-on 0.7.7 uses (globalPlugins/MathCAT/MathCAT.py),
// and records MathCAT's SSML per fixture:
//   startup  MathCAT.__init__: SetRulesDir, TTS=SSML; every other setting comes
//            from MathCAT's prefs.yaml, plus the modelled user's one change,
//            Verbosity = Verbose (Nicholas, 2026-11-09: "I want "verbose" as the default, but I will want to add some controls at a later time to adjust that.")
//   per math getSpeechForMathMl: Language, SetMathML, IgnoreBold,
//            CapitalLetters_*, GetSpokenText
// Before 2026-11-09: NVDA release-2026.2's built-in order and configSpec defaults
// (mathcat-proofing-v2/NOTE-MATHCAT-UPGRADE-0.7.7.md).
import init, * as mc from '../mathcat_wasm.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

await init({ module_or_path: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
mc.init();
mc.setPreference('TTS', 'SSML');
const userPrefs = [['Verbosity', 'Verbose']];
for (const [k, v] of userPrefs) mc.setPreference(k, v);

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
// NVDA's rebuild (ia2Web.py Math._get_mathMl): inner markup of <math>,
// comments removed, wrapped in a new <math xml:lang>. Done here with string
// operations, independently of the agent's DOM-based rebuildForNVDA.
export function nvdaForm(mathml, lang = 'en') {
  const inner = mathml.replace(/^\s*<math\b[^>]*>/, '').replace(/<\/math>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
  return `<math xml:lang="${lang}">${inner}</math>`;
}
function speakNvdaOrder(mathml) {
  let ssml = null, error = null;
  try {
    mc.setPreference('Language', 'en');
    mc.setMathML(mathml);
    // The add-on: IgnoreBold from NVDA's "Report highlighting" (default on).
    mc.setPreference('IgnoreBold', 'false');
    // OneCore synth defaults: beepForCapitals=false, sayCapForCapitals=false,
    // capPitchChange=30 (configSpec L54-56); OneCore supports PitchCommand.
    mc.setPreference('CapitalLetters_Beep', 'false');
    mc.setPreference('CapitalLetters_UseWord', 'false');
    mc.setPreference('CapitalLetters_Pitch', '30');
    ssml = mc.getSpokenText();
  } catch (e) { error = String(e); }
  return { ssml, error };
}
const out = [];
for (const f of fixtures) {
  const direct = speakNvdaOrder(f.mathml);
  const nvda = speakNvdaOrder(nvdaForm(f.mathml));
  out.push({ name: f.name, ssml: direct.ssml, error: direct.error,
             nvdaMathml: nvdaForm(f.mathml), nvdaSsml: nvda.ssml, nvdaError: nvda.error });
}
writeFileSync(new URL('./ssml.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('ssml for', out.length, 'fixtures;', out.filter(o => o.error).length, 'errors');
