import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {propertyReceptionPolicyHash} from '../lib/reception-property-context.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const reception=read('config/reception-property-context.sql'),inbound=read('config/call-property-context.sql');
assert.equal((reception.match(new RegExp(propertyReceptionPolicyHash,'g'))??[]).length,2,'SQL approval constraint and read RPC must match the reviewed application prompt hash');
assert.match(reception,/context_policy text not null default 'message_only'/);
for(const [sql,name,signature] of [[inbound,'icash_inbound_property_context','text,text,text,text'],[reception,'icash_reception_property_context','text,text,text']]){
 const body=sql.slice(sql.indexOf('as $$')+5,sql.indexOf('end $$;'));
 assert(!/\b(?:insert\s+into|update\s+public\.|delete\s+from|perform\s+public\.)/i.test(body),'Context functions must be read-only');
 assert.match(sql,/language plpgsql stable security (?:invoker|definer) set search_path=''/);
 assert(sql.includes(`revoke all on function public.${name}(${signature}) from public,anon,authenticated;`));
 assert(sql.includes(`grant execute on function public.${name}(${signature}) to service_role;`));
 assert(!body.includes("terms->>'seller'"),'Never use record-owner name as caller name');
 assert.match(body,/direction='incoming' and m.state='received'/);
 assert.match(body,/sent.state in \('accepted','delivered'\)/);
 assert.match(body,/lower\(introduced.name\) not in \('interested','owner','selling','ready','not','yes','no'\)/);
}
assert(!/\bupdate\s+icash_reception_private\.config\b/i.test(reception),'Installing context must never enable/change an active configuration');
console.log('Call property-context SQL review passed: exact policy hash, default-off, read-only allowlists, private grants and received/sent name evidence.');
