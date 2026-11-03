import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const names=['new-user-request-reserve','new-user-request-reserve-scheduling','new-user-request-reserve-exclusions','new-user-request-reserve-monitoring'];
const expected='begin;\n'+names.map(name=>{
 const text=read('config/'+name+'.sql');
 assert.equal(text.split('\nbegin;\n').length,2);
 assert(text.endsWith('commit;\n'));
 return '-- Source: config/'+name+'.sql\n'+text.replace('\nbegin;\n','\n').slice(0,-'commit;\n'.length);
}).join('\n')+'commit;\n';
assert.equal(read('supabase/migrations/20261103192046_new_user_request_reserve.sql'),expected,'Installed atomic migration must match the independently exercised configuration sources');
console.log('PASS installed reserve migration matches every tested source in one atomic transaction.');
