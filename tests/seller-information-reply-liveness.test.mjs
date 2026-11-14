import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {planSellerProgress,sellerProgressInstructions} from '../lib/seller-progress-policy.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'(');assert(start>=0,name);const tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const rpc=async(n,args=[])=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
await pg.exec(fixture.slice(0,split)+read('./fixtures/seller-progress-original-functions.sql')+fixture.slice(split)+read('./helpers/seller-dialogue-fixture.sql')+read('./fixtures/seller-dialogue-original-functions.sql')+
 fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+
 `create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`+read('../config/seller-reply-progress.sql')+read('../config/seller-dialogue.sql'));
await pg.exec('update icash_seller_progress_settings set enabled=true,dialogue_enabled=true');
let tick=0;
const at=()=>new Date(Date.now()-300000+(++tick)*1000).toISOString();
async function seed(){const a=randomUUID(),t=randomUUID(),d=randomUUID(),s=randomUUID(),phone='+1555'+Math.floor(Math.random()*9999999).toString().padStart(7,'0');
 await q('insert into icash_accounts(id) values($1)',[a]);
 await q("insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)",[s,a,{propertyId:s},{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:12938400}]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)",[d,a,s,{address:'Fixture property'}]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[t,a,d,phone]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001',$1,$2)",[phone,a]);return {a,t,d,s};
}
async function incoming(c,body,extra={}){const event=extra.event??randomUUID();const m=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at,attachments) values($1,$2,'incoming','received',$3,$4,$5,$6) on conflict(event_id) do update set body=icash_text_messages.body returning id",[c.a,c.t,body,event,extra.at??at(),extra.attachments??[]])).id;return {m,j:(await one('select * from icash_text_ai_jobs where message_id=$1',[m]))};}
const context=(c,m)=>rpc('icash_seller_dialogue_context',[c.a,m]);
const progress=(c,m)=>rpc('icash_refresh_seller_reply_progress',[c.a,m]);
async function dispatch(c,j,{delivered=true}={}){const resumed=await rpc('icash_resume_seller_text_ai',[c.a,j.id]);assert.equal(resumed.mode,'dispatch',JSON.stringify(resumed));
 const msg=await one('select * from icash_text_messages where id=$1',[resumed.messageId]);assert(msg.body.length<=160,msg.body);
 assert.ok(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),'Actual production campaign/final-message guard admits expected copy');
 assert.equal(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),null,'One provider claim only');
 await q("update icash_text_messages set state=$2,provider_id=$3,created_at=$4 where id=$1",[msg.id,delivered?'delivered':'accepted','provider-'+msg.id,at()]);await progress(c,j.message_id);return msg;
}

// Install exact current production admission guards, with external budget and
// transport delegates remaining fixture-only. No provider is contacted.
await pg.exec(`
 create table icash_contract_text_deliveries(envelope_id uuid,account_id uuid,message_id uuid);
 create schema icash_seller_agreement_private;create schema icash_call_offer_private;
 create table icash_seller_agreement_private.confirmations(envelope_id uuid,account_id uuid,deal_id uuid);
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid);
 create function icash_confirmed_seller_contract_text_current(uuid,uuid) returns boolean language sql as $$select false$$;
`+read('./fixtures/seller-information-reply-before.sql'));
const age=async c=>q("update icash_screening_jobs set completed_at=now()-interval '24 hours 13 minutes' where id=$1",[c.s]);
const blocked=await seed();await age(blocked);
const source=await incoming(blocked,'How much ');
assert.equal(source.j.state,'needs_review','reproduce fresh price question stopped only by 24h13m screening age');
assert.equal(source.j.analysis.dialogueAction,'explain_price');
assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[blocked.a])).n,0);
const patch=read('../config/seller-information-reply-liveness.sql');
assert.equal(patch,read('../supabase/migrations/20261114172357_seller_information_reply_liveness.sql'));
const metadata=async()=> (await q("select proname,prosecdef,provolatile,proconfig,proacl::text from pg_proc where proname in ('icash_seller_dialogue_reply','icash_claim_text_before_owner_question') order by proname")).rows;
const prior=await metadata();
await pg.exec('begin;'+patch+'commit;');
assert.deepEqual(await metadata(),prior,'existing security and ACLs remain unchanged');
assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[source.j.id])).state,'needs_review','original held source remains immutable; no historical replay');
assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[blocked.a])).n,0);
for(const body of ['How much?','How does this work?','Any fees?','Pictures are there']){
 const c=await seed();await age(c);
 const before=(await one('select completed_at,result from icash_screening_jobs where id=$1',[c.s]));
 const turn=await incoming(c,body);assert.equal(turn.j.state,'drafted',body);
 const outgoing=await dispatch(c,turn.j);
 assert(!/\$|[0-9]+|guarantee|sent.*contract|booked/.test(outgoing.body),'informational copy never quotes stale dollars or commitments');
 assert.deepEqual(await one('select completed_at,result from icash_screening_jobs where id=$1',[c.s]),before,'no screening renewal or price authority');
 assert.equal((await one('select count(*)::int n from icash_offer_authorities where account_id=$1',[c.a])).n,0);
 assert.equal((await one('select count(*)::int n from icash_signing_envelopes where account_id=$1',[c.a])).n,0);
 assert.equal((await progress(c,turn.m)).reason,'awaiting_seller_reply');
}
// New permissive metadata cannot transform another action or body into a price.
for(const mutation of ["update icash_text_messages set body='Our cash offer is $125,000' where id=$1", "update icash_text_ai_jobs set analysis=jsonb_set(analysis,'{dialogueAction}','\"cash_offer\"') where outgoing_id=$1"]){
 const c=await seed();await age(c);const turn=await incoming(c,'How much?');
 const out=await rpc('icash_resume_seller_text_ai',[c.a,turn.j.id]);await q(mutation,[out.messageId]);
 assert.equal(await rpc('icash_claim_text',[c.a,out.messageId,'+15550000001']),null,'modified price/copy never inherits informational permission');
}
for(const [change,label] of [
 ["update icash_accounts set bot_paused=true where id=$1",'Pause'],
 ["update icash_text_threads set manual_only=true where account_id=$1",'manual takeover'],
 ["update icash_text_threads set permission_until=now()-interval '1 second' where account_id=$1",'expired contact evidence'],
 ["update icash_sms_routes set revision=2 where account_id=$1",'changed route'],
 ["update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}' where account_id=$1",'current financial hold'],
 ["update icash_screening_jobs set completed_at=now()+interval '1 minute' where account_id=$1",'future screening'],
 ["update icash_screening_jobs set completed_at=null where account_id=$1",'missing screening'],
 ["insert into icash_text_suppressions select recipient from icash_text_threads where account_id=$1",'opt-out'],
 ["update icash_text_messages set event_id=null,provider_id=null where account_id=$1 and direction='incoming'",'unverified source'],
 ]){
 const c=await seed();await age(c);const turn=await incoming(c,'How much?');
 const out=await rpc('icash_resume_seller_text_ai',[c.a,turn.j.id]);assert.equal(out.mode,'dispatch');
 await q(change,[c.a]);assert.equal(await rpc('icash_claim_text',[c.a,out.messageId,'+15550000001']),null,label);
}
const newer=await seed();await age(newer);let turn=await incoming(newer,'How much?');let out=await rpc('icash_resume_seller_text_ai',[newer.a,turn.j.id]);await incoming(newer,'STOP');assert.equal(await rpc('icash_claim_text',[newer.a,out.messageId,'+15550000001']),null,'late seller stop remains final');
const other=await seed();assert.equal(await rpc('icash_seller_dialogue_reply',[other.a,turn.j.id]),null,'account isolation');
const special=await seed();await age(special);turn=await incoming(special,'No third parties');assert.equal(turn.j.state,'needs_review','third-party condition retains separate existing requirements');
const old=await seed();await age(old);turn=await incoming(old,'How much?',{at:new Date(Date.now()-48*3600000).toISOString()});assert.notEqual(turn.j?.state,'drafted','old reply never gains new source freshness');
await assert.rejects(pg.exec('begin;'+patch),/Seller information reply predecessor changed/);await pg.exec('rollback');
await pg.close();console.log('PASS seller information liveness: reproduced 24h13m price-query hold; real prepare/queue/final claim, immutable underwriting, no monetary authority, fresh-source/contact/copy/customer controls and no historical replay.');
