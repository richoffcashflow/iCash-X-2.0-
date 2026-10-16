import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Actual owner-enrichment SQL/service with local provider fakes only.
const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-owner-enrichment-claim-pglite.mjs',fileURLToPath(import.meta.resolve('@electric-sql/pglite'))],{stdio:'inherit',timeout:60000});
if(result.error||result.status!==0)process.exit(result.status||1);
