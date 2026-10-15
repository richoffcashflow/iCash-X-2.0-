import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
execFileSync(process.execPath,['scripts/test-webinar-db.mjs',fileURLToPath(import.meta.resolve('@electric-sql/pglite'))],{stdio:'inherit',timeout:60000});
