// N-T2 (PLAN-MATHCAT-NAVIGATION.md section 6): the agent's key -> command table
// equals the one in NVDA release-2026.2 source/mathPres/MathCAT/navCommands.py,
// downloaded at test time and never stored (M20). Also:
//   - the engine accepts exactly NVDA's command names (N14);
//   - every NVDA gesture, built as a browser keydown, maps to its command
//     (digits by physical key, event.code, because Shift+1 gives "!").
import { check, eq, done } from './lib.mjs';
import { makeNavEnv } from './nav-env.mjs';
import * as engineModule from '../mathcat.js';

const URL_ = 'https://raw.githubusercontent.com/nvaccess/nvda/release-2026.2/source/mathPres/MathCAT/navCommands.py';
let src = '';
try { const r = await fetch(URL_); src = r.ok ? await r.text() : ''; } catch (e) { src = ''; }
check('navCommands.py downloaded', src.includes('_buildNavCommands'), URL_);
check('placemarker loop is range(10)', /for n in range\(10\):/.test(src));
const want = {};
const RE = /NavCommand\(\s*\(((?:\s*f?"kb:[^"]+",?)+)\s*\),\s*(f?)"([A-Za-z]+(?:\{n\})?)"/g;
for (const m of src.matchAll(RE)) {
  const gestures = [...m[1].matchAll(/"(kb:[^"]+)"/g)].map((x) => x[1]);
  const ns = m[3].includes('{n}') ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [null];
  for (const n of ns) for (const gest of gestures) {
    const sub = (s) => (n === null ? s : s.split('{n}').join(String(n)));
    want[sub(gest)] = sub(m[3]);
  }
}
eq('NVDA gestures parsed', Object.keys(want).length, 73);
eq('NVDA commands parsed', new Set(Object.values(want)).size, 69);
const sortObj = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));

// ---- the agent's table (one layer, NVDA gesture names -> command names; N4) --
const env = makeNavEnv('');
const nav = env.agent && env.agent.nav;
check('agent exposes its navigation layer', !!(nav && nav.KEY_TABLE && nav.keyToCommand));
eq('agent KEY_TABLE == navCommands.py', sortObj(nav && nav.KEY_TABLE), sortObj(want));

// ---- the engine's accepted names (N14) ----------------------------------------
eq('engine NAV_COMMANDS == navCommands.py commands',
  JSON.stringify([...(engineModule.NAV_COMMANDS || [])].sort()),
  JSON.stringify([...new Set(Object.values(want))].sort()));

// ---- browser keydown -> NVDA gesture -> command -------------------------------
// This test's own map from NVDA key names to KeyboardEvent.code values.
const CODE = { leftArrow: 'ArrowLeft', rightArrow: 'ArrowRight', upArrow: 'ArrowUp', downArrow: 'ArrowDown',
  enter: 'Enter', space: 'Space', home: 'Home', end: 'End', backspace: 'Backspace' };
function eventFor(gesture) {
  const parts = gesture.slice(3).split('+'), k = parts.pop();
  return { code: CODE[k] || `Digit${k}`, key: k, ctrlKey: parts.includes('control'),
    altKey: parts.includes('alt'), shiftKey: parts.includes('shift'), metaKey: false };
}
if (nav && nav.keyToCommand) {
  for (const [gest, cmd] of Object.entries(want)) eq(`keydown ${gest}`, nav.keyToCommand(eventFor(gest)), cmd);
  const none = (label, init) => eq(`not a navigation key: ${label}`, nav.keyToCommand({ code: '', key: '',
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }), null);
  none('a', { code: 'KeyA', key: 'a' });
  none('Tab', { code: 'Tab', key: 'Tab' });
  none('Escape (handled separately, N3)', { code: 'Escape', key: 'Escape' });
  none('Meta+ArrowDown', { code: 'ArrowDown', key: 'ArrowDown', metaKey: true });
  none('Alt+ArrowDown (not in NVDA table)', { code: 'ArrowDown', key: 'ArrowDown', altKey: true });
  none('Ctrl+Alt+Shift+ArrowLeft', { code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: true, altKey: true, shiftKey: true });
  none('numpad 1 (NVDA names it numpad1)', { code: 'Numpad1', key: '1' });
  none('numpad Enter (NVDA names it numpadEnter)', { code: 'NumpadEnter', key: 'Enter' });
  eq('Shift+1 arrives as "!" but is Read1', nav.keyToCommand({ code: 'Digit1', key: '!', shiftKey: true,
    ctrlKey: false, altKey: false, metaKey: false }), 'Read1');
}
done('N-T2 key table');
