import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
export function sqlFunction(file,name){
 const s=read('../../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'(');assert(start>=0,name);
 const tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);
 return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);
}
const fixture=read('./seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
export const setup=fixture.slice(0,split)+read('../fixtures/seller-progress-original-functions.sql')+fixture.slice(split)
 +sqlFunction('seller-response-policy','icash_seller_direct_response_match')
 +sqlFunction('seller-response-policy','icash_seller_response_disposition')
 +sqlFunction('seller-gap-recovery','icash_seller_contact_stop')
 +read('../../config/seller-reply-progress.sql')+read('./deal-supervisor-fixture.sql')
 +sqlFunction('platform-shared-learning','icash_learning_signature_verified')
 +sqlFunction('platform-shared-learning','icash_learning_deal_outcomes')
 +read('../../config/deal-supervisor.sql');
if(process.env.DEAL_SUPERVISOR_FIXTURE_OUTPUT)writeFileSync(process.env.DEAL_SUPERVISOR_FIXTURE_OUTPUT,setup);
