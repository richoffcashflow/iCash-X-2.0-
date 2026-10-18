import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-seller-intake-contacts-pglite.mjs',require.resolve('@electric-sql/pglite'),'--automatic'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:60000});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
assert.equal(result.status,0,result.error?.message||'Automatic account channels must reach the actual SMS, call and final recording claims without any campaign records');
