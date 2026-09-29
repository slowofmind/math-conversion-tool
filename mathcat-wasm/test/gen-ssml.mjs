// gen-ssml.mjs — step 1 of golden generation (plan T1).
// Drives the built MathCAT wasm DIRECTLY (not through mathcat.js) in the call
// order NVDA release-2026.2 uses, and records MathCAT's SSML per fixture:
//   startup  MathCAT.py L313-329: SetRulesDir, TTS=SSML, applyUserPreferences()
//   per math MathCAT.py L331-380: Language, SetMathML, CapitalLetters_*, GetSpokenText
// applyUserPreferences values = NVDA configSpec defaults (preferences.py
// defaults() L299-327; configSpec.py [math] L394+), BrailleCode skipped as NVDA does.
import init, * as mc from '../mathcat_wasm.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

await init({ module_or_path: gunzipSync(readFileSync(new URL('../mathcat-wasm.bin', import.meta.url))) });
mc.init();
mc.setPreference('TTS', 'SSML');
const userPrefs = [
  ['Impairment', 'Blindness'], ['Language', 'en'], ['Verbosity', 'Medium'],
  ['MathRate', '100'], ['PauseFactor', '100'], ['SpeechSound', 'None'],
  ['SpeechStyle', 'ClearSpeak'], ['SubjectArea', 'General'], ['Chemistry', 'SpellOut'],
  ['NavMode', 'Enhanced'], ['ResetNavMode', 'false'], ['Overview', 'false'],
  ['ResetOverview', 'true'], ['NavVerbosity', 'Medium'], ['AutoZoomOut', 'true'],
  ['CopyAs', 'MathML'], ['BrailleNavHighlight', 'EndPoints'],
];
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
