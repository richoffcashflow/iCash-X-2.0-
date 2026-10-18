import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['scripts/test-meta-instant-leads-pglite.mjs'],{stdio:'inherit',timeout:60000});
