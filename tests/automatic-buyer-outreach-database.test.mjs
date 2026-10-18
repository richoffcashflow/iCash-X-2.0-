import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-buyer-disposition-pglite.mjs',require.resolve('@electric-sql/pglite')],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:60000});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
assert.equal(result.status,0,result.error?.message||'Automatic buyers must reach real SQL contact, queue and final claims without campaign setup');
