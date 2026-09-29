// run-all.mjs — runs every test file (plan section 5, Phase B) and the build
// gates' cheap re-checks. `npm test` from this folder.
import { spawnSync } from 'node:child_process';
const files = ['test-t1-engine.mjs', 'test-t1b-conversion.mjs', 'test-t2-agent.mjs',
               'test-t3-presenter.mjs', 'test-t4-messaging.mjs', 'test-e2e.mjs',
               // navigation (PLAN-MATHCAT-NAVIGATION.md section 6)
               'test-nt1-nav-engine.mjs', 'test-nt2-keytable.mjs', 'test-nt3-tagging.mjs',
               'test-nt4-highlight.mjs', 'test-nt5-agent-keys.mjs', 'test-nt6-relay.mjs',
               'test-nt7-stacking.mjs', 'test-n21-off.mjs'];
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
  const out = (r.stdout + r.stderr).split('\n').filter(l => l && !l.startsWith('MathJax: Invalid option'));
  console.log(out.join('\n'));
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} test file(s) FAILED` : '\nALL TEST FILES PASSED');
process.exit(bad ? 1 : 0);
