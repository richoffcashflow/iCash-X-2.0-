import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-required-call-recording-pglite.mjs',fileURLToPath(import.meta.resolve('@electric-sql/pglite'))],{stdio:'inherit',timeout:60000,env:{...process.env,RECORDING_FINAL_CLOCK_ONLY:'1'}});
if(run.error||run.status!==0)process.exit(run.status||1);
