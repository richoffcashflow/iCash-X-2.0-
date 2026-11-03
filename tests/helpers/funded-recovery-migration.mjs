import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function assertMigrationConfig(name,source){
 const bundle=readFileSync(new URL('../../supabase/migrations/20261103181214_funded_recovery_completion.sql',import.meta.url),'utf8');
 const start='-- BEGIN CONFIG '+name+'\n',end='-- END CONFIG '+name+'\n';
 assert.equal(bundle.split(start).length,2);assert.equal(bundle.split(end).length,2);
 assert.equal(bundle.split(start)[1].split(end)[0],source.split(/(?<=\n)/).filter(line=>!['begin;','commit;'].includes(line.trim())).join(''));
}
