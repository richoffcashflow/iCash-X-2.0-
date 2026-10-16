// Bounded in-memory database replay; no network, provider calls or customer spend.
import {spawnSync} from 'node:child_process';
const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-optin-call-now-pglite.mjs'],{stdio:'inherit',timeout:60000});
if(run.error||run.status!==0)process.exit(run.status||1);
