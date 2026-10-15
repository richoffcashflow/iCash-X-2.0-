import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const suite of ['scripts/test-bot-demo-pglite.mjs','tests/browser-phone-database.mjs']){
 const run=spawnSync(process.execPath,['--experimental-strip-types',suite,require.resolve('@electric-sql/pglite')],{stdio:'inherit',timeout:60000});
 if(run.error||run.status!==0)process.exit(run.status||1);
}
