// Isolated PostgreSQL and synthetic evidence only. No external calls or paid tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),untouched=id(3),notice='Free Msg: Receiver 12025550123 unable to receive message - Message Blocking is active';
const pg=await PGlite.create(),q=(sql,params=[])=>pg.query(sql,params),rows=async(sql,p=[]) =>(await q(sql,p)).rows,scalar=async(sql,p=[])=>Object.values((await rows(sql,p))[0])[0];
try{
 await pg.exec(read('tests/fixtures/carrier-notice-projection-schema.sql'));
 await pg.exec(read('tests/fixtures/seller-reply-workspace-before.sql'));
 await pg.exec(read('config/seller-reply-visibility.sql'));
 await pg.exec(read('tests/fixtures/carrier-notice-projections-before.sql'));
 await pg.exec(`revoke all on function icash_text_thread_reply_summaries(uuid,uuid[]),icash_latest_seller_text_thread(uuid,uuid),icash_workspace_seller_texts(uuid,uuid[]),icash_refresh_opportunity_outcomes(uuid),icash_voice_sms_context(uuid,uuid) from public,anon,authenticated;grant execute on function icash_text_thread_reply_summaries(uuid,uuid[]),icash_latest_seller_text_thread(uuid,uuid),icash_workspace_seller_texts(uuid,uuid[]),icash_refresh_opportunity_outcomes(uuid),icash_voice_sms_context(uuid,uuid) to service_role;`);
 // Use the real shared predicate and message view, not another regex/oracle.
 const foundation=read('config/carrier-text-notice-classification.sql');
 const classifier=foundation.slice(foundation.indexOf('create function public.icash_is_carrier_text_notice'),foundation.indexOf('create view public.icash_response_text_attention'));
 await pg.exec(classifier);
 for(let n=10;n<23;n++){
  const a=n===22?other:account;
  await q(`insert into icash_screening_jobs(id,account_id,state,result) values($1,$2,$3,$4)`,[id(n),a,n===21?'archived':'complete',{property:{propertyId:n===20?'practice_fixture':'prop_'+n,address:n+' Fixture Street'}}]);
  await q(`insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)`,[id(n+100),a,id(n)]);
  await q(`insert into icash_text_threads(id,account_id,deal_id,party,recipient,retired_at) values($1,$2,$3,'seller','+12025550123',$4)`,[id(n+200),a,id(n+100),n===19?'2026-11-01T00:00:00Z':null]);
  await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'incoming','received',$4,'synthetic',now()-interval '2 days')`,[id(n+300),a,id(n+200),n===10||n>=19?notice:'Human reply '+n]);
  await q(`insert into icash_opportunity_outcomes(screening_id,account_id,responded,response_at) values($1,$2,true,now()-interval '2 days')`,[id(n),a]);
 }
 // A real earlier reply survives newer noise, even across enough notices to fill
 // the entire voice history window. The raw history remains unchanged.
 for(let n=0;n<55;n++)await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'incoming','received',$4,'synthetic',now()-interval '1 day'+$5*interval '1 second')`,[id(500+n),account,id(211),notice,n]);
 // Exact notice caption plus attachment is not proof of an automated message.
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,attachments,provider_id) values($1,$2,$3,'incoming','received',$4,'[{"url":"https://example.invalid/image"}]','synthetic')`,[id(600),account,id(212),notice]);
 // Bound source/account joins reject contamination, including late foreign rows.
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id) values($1,$2,$3,'incoming','received','Foreign human reply','synthetic')`,[id(601),other,id(210)]);
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id) values($1,$2,$3,'outgoing','delivered',$4,'synthetic')`,[id(602),account,id(210),notice]);
 await q(`insert into icash_operation_spend values($1,$2,now(),'settled',123)`,[account,'text:'+id(310)]);
 await q(`insert into icash_voice_contact_targets values($1,$2,$3,'+12025550123','seller')`,[id(900),account,id(11)]);
 // Notice-only SMS must not erase a genuine voice or seller-email response.
 for(const n of [17,18])await q(`update icash_text_messages set body=$1 where id=$2`,[notice,id(n+300)]);
 await q(`insert into icash_live_conversations values($1,$2,$3,'voice:fixture',now(),now()-interval '3 days','seller','voice_fixture','complete','{"response":true,"interested":true}')`,[id(901),account,id(17)]);
 await q(`insert into icash_seller_email_openers values($1,$2,$3,'seller@example.invalid')`,[account,id(118),id(902)]);
 await q(`insert into icash_deal_emails(id,account_id,deal_id,reply_to_id,direction,state,provider_id,recipient,body_text,created_at,updated_at) values($1,$2,$3,$4,'incoming','received','email_fixture','seller@example.invalid','I want to sell',now()-interval '3 days',now())`,[id(903),account,id(118),id(902)]);
 await q(`insert into icash_opportunity_refreshes values($1,now()),($2,now()),($3,now())`,[account,other,untouched]);
 await q(`insert into icash_workspace_revisions values($1,9,now())`,[account]);
 const beforeMessages=await rows('select * from icash_text_messages order by id'),beforeCosts=await rows('select * from icash_operation_spend'),beforeFields=await rows('select screening_id,account_id,attempted,interested,opted_out,purchase_signed,provider_cost_micros,costs_complete,refreshed_at from icash_opportunity_outcomes order by screening_id');
 assert((await scalar('select icash_workspace_text_reply_counts($1)',[account])).unreadMessages>50);
 const migration=read('config/carrier-text-notice-projections.sql');
 assert.equal(migration,read('supabase/migrations/20261108235000_carrier_text_notice_projections.sql'));
 await pg.exec(migration);
 for(const signature of ['icash_text_thread_reply_summaries(uuid,uuid[])','icash_latest_seller_text_thread(uuid,uuid)','icash_workspace_seller_texts(uuid,uuid[])','icash_refresh_opportunity_outcomes(uuid)','icash_voice_sms_context(uuid,uuid)']){
  for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
  assert.equal(await scalar("select has_function_privilege('service_role',$1,'execute')",[signature]),true);
  assert.equal(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure',[signature]),false,'No new security-definer privilege');
 }

 const counts=await scalar('select icash_workspace_text_reply_counts($1)',[account]);
 assert.deepEqual(counts,{properties:6,unreadProperties:6,unreadMessages:7});
 assert.equal(await scalar('select responded from icash_opportunity_outcomes where screening_id=$1',[id(10)]),false);
 for(const n of [11,12,17,18])assert.equal(await scalar('select responded from icash_opportunity_outcomes where screening_id=$1',[id(n)]),true);
 assert.equal(await scalar('select response_at from icash_opportunity_outcomes where screening_id=$1',[id(10)]),null);
 assert.equal(await scalar('select revision from icash_workspace_revisions where account_id=$1',[account]),10);
 assert.equal(await scalar("select refreshed_at='-infinity'::timestamptz from icash_opportunity_refreshes where account_id=$1",[account]),true);
 assert.equal(await scalar("select refreshed_at='-infinity'::timestamptz from icash_opportunity_refreshes where account_id=$1",[untouched]),false);
 assert.deepEqual(await rows('select * from icash_text_messages order by id'),beforeMessages,'Raw notices, outgoing states and human evidence stay untouched');
 assert.deepEqual(await rows('select * from icash_operation_spend'),beforeCosts,'Original costs stay untouched');
 assert.deepEqual(await rows('select screening_id,account_id,attempted,interested,opted_out,purchase_signed,provider_cost_micros,costs_complete,refreshed_at from icash_opportunity_outcomes order by screening_id'),beforeFields,'Only the two derived response fields change');
 const summaries=await rows('select * from icash_text_thread_reply_summaries($1,$2)',[account,[id(210),id(211)]]);
 assert.equal(summaries.length,1);assert.equal(summaries[0].message_id,id(311));assert.equal(Number(summaries[0].unread_count),1);
 const first=await rows("select * from icash_workspace_text_reply_ids($1,'',0,3,true)",[account]),second=await rows("select * from icash_workspace_text_reply_ids($1,'',3,3,true)",[account]);
 assert.equal(first.length,3);assert.equal(second.length,3);assert.equal(new Set([...first,...second].map(x=>x.screening_id)).size,6);assert(![...first,...second].some(x=>x.screening_id===id(10)));
 assert(!(await rows("select * from icash_workspace_opportunities($1,'',0,25,true)",[account])).some(x=>x.id===id(10)),'Stale cached true no longer qualifies response-only pagination');
 const voice=await scalar('select icash_voice_sms_context($1,$2)',[account,id(900)]);
 assert.equal(voice.messages.length,1);assert.equal(voice.messages[0].body,'Human reply 11','Filter before limit, not after a page full of notices');
 assert.equal(await scalar('select icash_voice_sms_context($1,$2)',[other,id(900)]),null);
 await q('select icash_refresh_opportunity_outcomes($1)',[account]);
 assert.equal(await scalar('select responded from icash_opportunity_outcomes where screening_id=$1',[id(10)]),false,'Regular refresh cannot reintroduce a notice');
 assert.equal(await scalar('select provider_cost_micros from icash_opportunity_outcomes where screening_id=$1',[id(10)]),123,'Original notice receipt cost is still counted');
 // Replay the late-arrival boundary: the original account refresh lock serializes
 // writers; a human arriving after repair is immediately visible and survives the
 // next real refresh. This is ordered replay, not a claim of native race coverage.
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at,updated_at) values($1,$2,$3,'incoming','received','Yes, please call tomorrow','synthetic',now(),now())`,[id(999),account,id(210)]);
 assert((await rows('select * from icash_workspace_seller_texts($1,$2)',[account,[id(10)]])).some(x=>x.message_id===id(999)));
 await q(`update icash_opportunity_refreshes set refreshed_at=now()-interval '1 minute' where account_id=$1`,[account]);
 await q('select icash_refresh_opportunity_outcomes($1)',[account]);
 assert.equal(await scalar('select responded from icash_opportunity_outcomes where screening_id=$1',[id(10)]),true);
 assert.equal(await scalar('select attempted from icash_opportunity_outcomes where screening_id=$1',[id(10)]),true,'Outgoing attempt remains an attempt');
 assert.equal(await scalar('select opted_out from icash_opportunity_outcomes where screening_id=$1',[id(10)]),false,'Notice never creates opt-out');
 console.log('PASS carrier notice projections: historical cache correction, source/tenant binding, pre-page unread counts, real voice/email/attachment evidence, raw history/cost preservation, bounded voice history and late-human ordered replay.');
}finally{await pg.close();}
