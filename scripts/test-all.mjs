import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep every suite isolated: route tests intentionally replace globals and env.
const root = fileURLToPath(new URL('../', import.meta.url));
const suites = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs')).sort();
if (!suites.length) throw new Error('No test suites found');
for (const suite of suites) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', `tests/${suite}`], {
    cwd: root, stdio: 'inherit', timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    console.error(`Failed: ${suite}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}
console.log(`All ${suites.length} test suites passed.`);
