import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const result=spawnSync(process.execPath,['scripts/test-support-pglite.mjs',require.resolve('@electric-sql/pglite')],{stdio:'inherit',timeout:45000});
if(result.error||result.status!==0)throw result.error??Error('Support receipt database checks failed');
