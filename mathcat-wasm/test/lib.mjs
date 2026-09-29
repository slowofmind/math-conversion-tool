// lib.mjs — tiny test helpers (no framework).
let failed = 0, passed = 0;
export function check(name, cond, detail = '') {
  if (cond) { passed++; }
  else { failed++; console.log('  FAIL', name, detail ? '\n       ' + detail : ''); }
}
export function eq(name, got, want) {
  check(name, got === want, `got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`);
}
export function done(label) {
  console.log(`${label}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
export const collapse = (s) => s.split(/\s+/).join(' ').trim();
