import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseTextWebhook} from '../../lib/contiguity.ts';

export async function testOwnerDemoInbound(f){
 const {db,q,one,owner,other,otherDeal,a,b,c,smsOnly,disabled,voiceOnly,rank,sms,voice,reset,evidence,sameThread}=f;
 let sequence=1000;
 const inbound=async(phone=a,{age='1 hour',body='I received your message.',type='text.incoming.sms',milliseconds=false}={})=>{
  const thread=randomUUID(),id=randomUUID(),event='evt_'+id,recipient='+1202555'+(++sequence);
  const timestamp=Number((await one('select extract(epoch from now()-$1::interval) at',[age])).at);
  const payload=parseTextWebhook({id:event,type,timestamp:milliseconds?timestamp*1000:timestamp,data:{from:recipient,to:phone,body}});
  await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,$5,'seller')",[thread,other,otherDeal,phone,recipient]);
  await q('insert into icash_sms_routes(sender,recipient,account_id,needs_review) values($1,$2,$3,false)',[phone,recipient,other]);
  await q("insert into icash_text_events(id,type,payload,received_at) values($1,$2,$3,to_timestamp($4)+interval '1 second')",[event,payload.type,JSON.stringify(payload),timestamp]);
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,event_id,body,created_at) values($1,$2,$3,'incoming','received',$4,$5,to_timestamp($6)+interval '2 seconds')",[id,other,thread,event,body,timestamp]);
  return {thread,id,event,recipient,timestamp,payload,phone};
 };
 const checkRank=async(expected)=>assert.equal((await rank(a))[1],expected);
 const invalid=async(name,change,options={})=>{
  await reset();await evidence(b,8,5);const row=await inbound(a,options);await change(row);
  await checkRank(0);assert.equal(await sms(),b,name);assert.equal(await voice(),b,name);
 };
 await reset();await evidence(b,8,5);const received=await inbound();
 await checkRank(Math.floor(received.timestamp));assert.equal(await sms(),a,'Verified recent inbound precedes outbound volume');assert.equal(await voice(),a);
 await inbound(c,{age:'2 hours'});assert.equal(await sms(),a,'Newest original source time wins among confirmed inbound');
 await q("update icash_text_messages set created_at=now() where thread_id in(select id from icash_text_threads where sender=$1)",[c]);assert.equal(await sms(),a,'Re-ingestion does not refresh source recency');
 const snapshots=(await q('select id,account_id,thread_id,event_id,body,created_at from icash_text_messages order by id')).rows;
 await db.exec('begin read only');await sms();await voice();await db.exec('commit');assert.deepEqual((await q('select id,account_id,thread_id,event_id,body,created_at from icash_text_messages order by id')).rows,snapshots,'Ranking leaves source evidence unchanged');
 await sameThread(b);assert.equal(await sms(),b);assert.equal(await voice(),b,'Established current route precedes newer inbound elsewhere');
 await q('update icash_text_senders set enabled=false where phone=$1',[b]);assert.equal(await sms(),null,'A disabled established identity never rotates to inbound-preferred line');
 // The provider parser's supported cellular aliases preserve an exact raw receipt.
 for(const type of ['text.incoming.mms','communications.incoming.sms','communications.incoming.mms']){
  for(const milliseconds of [false,true]){await reset();const r=await inbound(a,{type,milliseconds});await checkRank(Math.floor(r.payload.timestamp));}
 }
 for(const type of ['communications.incoming.imessage','imessage.incoming'])await invalid('iMessage does not prove cellular reception',async()=>{}, {type});
 for(const body of ['Free Msg: Receiver unable to receive message - Message Blocking is active','  Free Msg: Network notice','Your verification code is 123456','Your one-time password is 123456','This is an automated message','Automatic reply: away','Auto-reply: away','Do not reply to this notice','!!!'])await invalid('Service/system notice is not reply transport evidence',async()=>{},{body});
 const mutations=[
  ['stale provider timestamp',"update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '25 hours')))"],
  ['future provider timestamp',"update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()+interval '1 second')))"],
  ['invalid provider timestamp',`update icash_text_events set payload=jsonb_set(payload,'{timestamp}','"invalid"')`],
  ['null provider timestamp',"update icash_text_events set payload=jsonb_set(payload,'{timestamp}','null')"],
  ['stale ingestion',"update icash_text_messages set created_at=now()-interval '25 hours' where direction='incoming'"],
  ['future ingestion',"update icash_text_messages set created_at=now()+interval '1 second' where direction='incoming'"],
  ['stale event receipt',"update icash_text_events set received_at=now()-interval '25 hours'"],
  ['future event receipt',"update icash_text_events set received_at=now()+interval '1 second'"],
  ['source after original receipt',"update icash_text_events set received_at=received_at-interval '1 minute'"],
  ['source after original message',"update icash_text_messages set created_at=created_at-interval '1 minute' where direction='incoming'"],
  ['missing event',"delete from icash_text_events"],
  ['wrong event identity',`update icash_text_events set payload=jsonb_set(payload,'{id}','"unrelated-event"')`],
  ['wrong event type',"update icash_text_events set type='text.delivery.confirmed'"],
  ['wrong payload type',`update icash_text_events set payload=jsonb_set(payload,'{type}','"text.delivery.confirmed"')`],
  ['wrong provider receipt',"update icash_text_messages set provider_id='unrelated-provider' where direction='incoming'"],
  ['wrong source phone',`update icash_text_events set payload=jsonb_set(payload,'{data,from}','"+12025559999"')`],
  ['wrong destination phone',`update icash_text_events set payload=jsonb_set(payload,'{data,to}','"+12025559999"')`],
  ['wrong source body',`update icash_text_events set payload=jsonb_set(payload,'{data,body}','"Unrelated message."')`],
  ['missing source body',"update icash_text_events set payload=payload #- '{data,body}'"],
  ['missing message account',"update icash_text_messages set account_id=null where direction='incoming'"],
  ['wrong message account',`update icash_text_messages set account_id='${owner}' where direction='incoming'`],
  ['unresolved message',"update icash_text_messages set state='needs_review' where direction='incoming'"],
  ['unbound message',"update icash_text_messages set thread_id=null where direction='incoming'"],
  ['missing route',"delete from icash_sms_routes"],
  ['route review',"update icash_sms_routes set needs_review=true"],
  ['foreign route',`update icash_sms_routes set account_id='${owner}'`],
 ];
 for(const [name,sql] of mutations)await invalid(name,()=>db.exec(sql));
 for(const [name,sql] of [
  ['retired thread','retired_at=now()'],['paused thread','paused=true'],['manual thread','manual_only=true'],
  ['review-only thread',"ai_mode='review'"],['other role',"party='buyer'"],['test thread','owner_buyer_test_id=gen_random_uuid()']
 ])await invalid(name,r=>q('update icash_text_threads set '+sql+' where id=$1',[r.thread]));
 for(const party of ['seller','buyer'])await invalid('Ambiguous active routing, including other roles',r=>q('insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,$5)',[owner,otherDeal,a,r.recipient,party]));
 await invalid('Test route also makes the source pair ambiguous',r=>q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party,owner_buyer_test_id) values($1,$2,$3,$4,'buyer',gen_random_uuid())",[other,otherDeal,a,r.recipient]));
 for(const [path,value] of [['providerEvent,type','communications.incoming.imessage'],['providerEvent,id','wrong'],['providerEvent,data,from','+12025559999'],['providerEvent,data,to',b],['providerEvent,data,body','Forged'],['providerEvent,timestamp',1],['channel','imessage']]){
  await invalid('Mismatched original alias '+path,()=>q('update icash_text_events set payload=jsonb_set(payload,$1::text[],$2::jsonb)',[path.split(','),JSON.stringify(value)]),{type:'communications.incoming.sms'});
 }
 await invalid('Malformed raw alias timestamp',()=>q("update icash_text_events set payload=jsonb_set(payload,'{providerEvent,timestamp}','\"bad\"')"),{type:'communications.incoming.sms'});
 await invalid('Unproven original provider envelope',()=>q("update icash_text_events set payload=jsonb_set(payload,'{providerEvent}','{}')"));
 // The bounded sample fails closed if the latest 500 are unproven; no broad
 // all-history rescan attempts to manufacture a higher confirmation score.
 await reset();const older=await inbound(a,{age:'2 hours'});
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at) select gen_random_uuid(),$1,$2,'incoming','received','Unproven source',now()-interval '1 hour' from generate_series(1,500)",[other,older.thread]);await checkRank(0);
 // Exact private helper ACL and rank remain read-only, even for raw source data.
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_owner_demo_sender_inbound_at(text)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_owner_demo_sender_inbound_at(text)','execute') allowed")).allowed,true);
 // A recent incoming receipt cannot override current capability changes.
 for(const phone of [smsOnly,disabled,voiceOnly]){await reset();await evidence(b,8,5);await inbound(phone);assert.equal(await sms(),b);assert.equal(await voice(),b);}
 for(const change of ['forwarding_ready=false,outbound_enabled=false','outbound_enabled=false','caller_id_sid=null,outbound_enabled=false']){
  await reset();await evidence(b,8,5);await inbound(a);await q('update icash_business_voice_numbers set '+change+' where phone=$1',[a]);assert.equal(await sms(),b);assert.equal(await voice(),b);
 }
 // Current source-bound delay recovery always precedes inbound recency.
 await reset();await evidence(a,1,1);await evidence(b,8,5);await inbound(a);
 const sent=await one("select m.id,m.provider_id from icash_text_messages m join icash_text_threads t on t.id=m.thread_id where t.sender=$1 and m.direction='outgoing' limit 1",[a]);
 await q("update icash_operation_spend set dispatched_at=now()-interval '7 minutes' where operation_key=$1",['text:'+sent.id]);
 await q("insert into icash_text_events(id,type,payload) values('inbound-delay','numbers.delayed',jsonb_build_object('id','inbound-delay','type','numbers.delayed','timestamp',extract(epoch from now()-interval '6 minutes'),'data',jsonb_build_object('reason','number_temporary_unavailable','original_number',$1::text,'affected_id',$2::text)))",[a,sent.provider_id]);
 assert.equal((await rank(a))[0],0);assert((await rank(a))[1]>0);assert.equal(await sms(),b,'A reply does not clear the existing unresolved carrier-delay penalty');
 // Leave source-verified evidence present for the parent fixture's exact
 // predecessor comparisons of foreign-account and owner-nonself behavior.
 await reset();await evidence(b,8,5);await inbound(a);
 console.log('PASS owner demo verified inbound: bounded original SMS/MMS source recency, aliases, forged/stale/future/system/ambiguous/test rejection, current capabilities, established identity, current-delay precedence and private read-only helper. No providers.');
}
