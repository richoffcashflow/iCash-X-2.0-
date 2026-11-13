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
const saved=JSON.parse(read('./fixtures/requested-seller-predecessors.json'));
const savedFn=n=>saved.find(x=>x.signature.startsWith(n+'(')).definition+';';
await pg.exec(`
 create table icash_seller_controls(id int,limited_contact_enabled boolean);insert into icash_seller_controls values(1,true);
 create table icash_seller_intakes(id uuid,phone text,ai_consented boolean,state text);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,assigned_at timestamptz);
 create table icash_contact_suppressions(contact_key text);
 create table icash_contract_text_deliveries(envelope_id uuid,account_id uuid,message_id uuid);
 create schema icash_seller_agreement_private;create schema icash_call_offer_private;
 create table icash_seller_agreement_private.confirmations(envelope_id uuid,account_id uuid,deal_id uuid);
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid);
 create function icash_confirmed_seller_contract_text_current(uuid,uuid) returns boolean language sql as $$select false$$;
 alter table icash_text_messages add column asset_ids uuid[] default '{}';
 drop function icash_seller_limited_contact(uuid,uuid);
 drop function icash_prepare_limited_seller_text(uuid,uuid,uuid);
`);
const limited=read('../config/seller-limited-contact.sql').match(/create or replace function public\.icash_seller_limited_contact[\s\S]*?\$\$;/)[0].replace("='payoff_may_exceed_budget'","in ('payoff_may_exceed_budget','title_review_needed')");
const limitedTable=read('../config/seller-limited-text-replies.sql').match(/create table public\.icash_seller_limited_text_replies[\s\S]*?\n\);/)[0];
await pg.exec(limited+limitedTable+savedFn('icash_prepare_limited_seller_text')+savedFn('icash_claim_text_before_owner_question'));
async function limitedSeed(){
 const c=await seed(),lead=randomUUID();
 await q("update icash_screening_jobs set snapshot=jsonb_build_object('propertyId',id,'sellerRequest',jsonb_build_object('id',$2::text)),result='{\"financialCheck\":{\"status\":\"hold\"},\"property\":{\"financialScreening\":{\"status\":\"title_review_needed\"}},\"offerAuthorized\":false}' where id=$1",[c.s,lead]);
 await q("insert into icash_seller_intakes values($1,'+15550000123',true,'assigned')",[lead]);
 await q('insert into icash_seller_matches values($1,$2,$3,now())',[lead,c.a,c.s]);
 await q('insert into icash_sms_seller_openings(account_id,thread_id,owner_question_id) values($1,$2,$3)',[c.a,c.t,randomUUID()]);
 return {...c,lead};
}
const original=await limitedSeed(),blocked=await incoming(original,'How much would you offer?');
assert.equal(blocked.j.state,'needs_review','reproduces supported ownership clarification rejected by title-review eligibility');
const fix=read('../config/limited-seller-ownership-reply.sql');
assert.equal(fix,read('../supabase/migrations/20261113170819_limited_seller_ownership_reply.sql'));
await pg.exec(fix);
assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[blocked.j.id])).state,'needs_review','migration never replays historical replies');
const c=await limitedSeed(),turn=await incoming(c,'How much would you offer?');
assert.equal(turn.j.analysis.dialogueAction,'clarify_ownership');assert.equal(turn.j.state,'drafted');
const sent=await dispatch(c,turn.j);assert.match(sent.body,/Are you the owner/);
assert.equal((await one('select result from icash_screening_jobs where id=$1',[c.s])).result.financialCheck.status,'hold');
assert.equal((await one('select count(*)::int n from icash_offer_authorities where account_id=$1',[c.a])).n,0);
assert.equal((await one('select count(*)::int n from icash_signing_envelopes where account_id=$1',[c.a])).n,0);
await q('delete from icash_sms_seller_openings where thread_id=$1',[c.t]);
const yes=await incoming(c,'Yes');
const payoff=await rpc('icash_prepare_limited_seller_text',[c.a,c.t,yes.m]);assert(payoff,'delivered ownership clarification allows existing bounded payoff question even with no opener receipt');
assert.equal((await one('select body from icash_text_messages where id=$1',[payoff])).body,'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?');
assert.equal(await rpc('icash_prepare_limited_seller_text',[c.a,c.t,yes.m]),payoff,'same source produces one message');
for(const [change,label] of [
 ["update icash_seller_intakes set ai_consented=false where id=$2",'missing consent'],
 ["update icash_seller_matches set account_id=gen_random_uuid() where lead_id=$2",'other account'],
 ["update icash_seller_matches set assigned_at=now()-interval '2 days' where lead_id=$2",'expired review'],
 ["update icash_screening_jobs set result=jsonb_set(result,'{offerAuthorized}','true') where account_id=$1",'changed offer authority'],
 ["update icash_text_threads set paused=true where account_id=$1",'pause'],
 ["update icash_sms_routes set revision=2 where account_id=$1",'changed route'],
 ]){
 const f=await limitedSeed(),source=await incoming(f,'How much would you offer?');
 const out=await rpc('icash_resume_seller_text_ai',[f.a,source.j.id]);assert.equal(out.mode,'dispatch');
 await q(change.replace('$2',"'"+f.lead+"'"),change.includes('$1')?[f.a]:[]);
 assert.equal(await rpc('icash_claim_text',[f.a,out.messageId,'+15550000001']),null,label);
}
const price=await limitedSeed(),priceTurn=await incoming(price,'No third parties');
assert.equal(priceTurn.j.state,'needs_review','limited exception is ownership clarification only');
await pg.close();console.log('PASS limited title/payoff reply: real dialogue prepare/queue/final claim, one delivered ownership clarification into bounded payoff details, current controls, no replay or invented offer/contract authority.');
