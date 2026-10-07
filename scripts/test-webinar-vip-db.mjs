import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export async function verifyWebinarVip(q){
 const main={id:randomUUID(),revision:1,title:'Main',status:'draft'},vip={id:randomUUID(),revision:1,title:'VIP',status:'draft'};
 const pair=(await q('select * from icash_webinar_create_pair($1,$2)',[main,vip])).rows;
 assert.equal(pair.length,2);assert.equal(pair[0].parent_webinar_id,null);assert.equal(pair[1].parent_webinar_id,main.id);assert.notEqual(pair[0].public_code,pair[1].public_code);assert.equal(pair[0].config.intelligenceEnabled,false);
 const retry=(await q('select * from icash_webinar_create_pair($1,$2)',[main,{...vip,id:randomUUID()}])).rows;assert.deepEqual(retry.map(r=>r.id),pair.map(r=>r.id),'Retry retains both permanent links');
 await assert.rejects(()=>q('select * from icash_webinar_create_pair($1,$2)',[vip,{...vip,id:randomUUID()}]),'VIP cannot be another parent');
 const invalid={...main,id:randomUUID()};await assert.rejects(()=>q('select * from icash_webinar_create_pair($1,$2)',[invalid,vip]));assert.equal((await q('select count(*)::int as n from icash_webinars where id=$1',[invalid.id])).rows[0].n,0,'Failed pair creation is atomic');
 await assert.rejects(()=>q('insert into icash_webinars(id,config,parent_webinar_id) values($1,$2,$3)',[randomUUID(),{},main.id]),'One VIP per main');
 await q("update icash_webinar_settings set config=jsonb_set(config,'{optimizer,enabled}','true'::jsonb)");assert.equal((await q("select (config->'optimizer'->>'enabled')::boolean as enabled from icash_webinar_settings")).rows[0].enabled,false,'Legacy writers cannot reactivate testing');
 const grants=(await q("select has_function_privilege('anon','icash_webinar_create_pair(jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','icash_webinar_create_pair(jsonb,jsonb)','execute') as authenticated,has_function_privilege('service_role','icash_webinar_create_pair(jsonb,jsonb)','execute') as service")).rows[0];assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
 console.log('PASS VIP database: atomic pairs, stable retry links, unique relationships, forced fixed routing and private execution.');
}
