import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
assert.equal(readFileSync(new URL('../supabase/migrations/20261014195138_buyer_intent_context.sql',import.meta.url),'utf8'),readFileSync(new URL('../config/buyer-intent-context.sql',import.meta.url),'utf8'));
assert.equal(readFileSync(new URL('../supabase/migrations/20261014200116_buyer_viewing_short_time_request.sql',import.meta.url),'utf8'),readFileSync(new URL('../config/buyer-viewing-short-time-request.sql',import.meta.url),'utf8'));
// Exercise the actual SQL trigger/write paths, not copies of their regexes.
const result=spawnSync(process.execPath,['scripts/test-buyer-purchase-pglite.mjs',fileURLToPath(import.meta.resolve('@electric-sql/pglite'))],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:60000});
assert.equal(result.error,undefined,result.error?.message);
assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
assert.match(result.stdout,/PASS 5 buyer flows:/);
console.log(result.stdout.trim());
