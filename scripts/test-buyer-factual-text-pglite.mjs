import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw Error('Pass local @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',thread='cccccccc-cccc-4ccc-8ccc-cccccccccccc',job='dddddddd-dddd-4ddd-8ddd-dddddddddddd',incoming='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',deal='ffffffff-ffff-4fff-8fff-ffffffffffff',screen='11111111-1111-4111-8111-111111111111';
await pg.exec(`create role anon;create role authenticated;create role service_role;
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,paused boolean default false,ai_mode text default 'auto',retired_at timestamptz);
create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,message_id uuid,state text,analysis jsonb,outgoing_id uuid,created_at timestamptz default now(),updated_at timestamptz);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,body text,created_at timestamptz default now());
create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid,bot_paused boolean default false);
create table icash_text_suppressions(phone text);
create table icash_deal_files(id uuid,account_id uuid,screening_id uuid);
create table icash_screening_jobs(id uuid,account_id uuid,snapshot jsonb);
create table icash_property_controls(account_id uuid,property_id text,manual boolean);
create table icash_buyer_package_links(account_id uuid,deal_id uuid,purchase_envelope_id uuid,token text,asking_price_cents bigint,revoked_at timestamptz);
create table icash_disposition_authorities(account_id uuid,deal_id uuid,purchase_envelope_id uuid,expires_at timestamptz);
create table fixture_package(account_id uuid,deal_id uuid,data jsonb,enabled boolean default true);
create table icash_outreach_campaigns(account_id uuid,mode text);
create table fixture_policy(permitted boolean default true,dispatch boolean default true,queue boolean default true);
insert into fixture_policy default values;
create function icash_buyer_package_data(a uuid,d uuid) returns jsonb language sql stable set search_path=public as $$select data from fixture_package where account_id=a and deal_id=d and enabled$$;
create function icash_sms_thread_review_current(a uuid,t uuid,h boolean) returns boolean language sql stable set search_path=public as $$select permitted from fixture_policy$$;
create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql set search_path=public as $$declare out_id uuid;begin if not (select queue from fixture_policy) then return null;end if;insert into icash_text_messages(account_id,thread_id,direction,state,body) values(a,t,'outgoing','ready',b) returning id into out_id;return out_id;end$$;
create function icash_claim_text_before_campaign(a uuid,m uuid,s text) returns jsonb language sql set search_path=public as $$select case when (select dispatch from fixture_policy) then jsonb_build_object('fixture','accepted') else null end$$;
create function icash_claim_text_before_owner_question(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_text_threads;m public.icash_text_messages;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account) then return null;end if;
 return public.icash_claim_text_before_campaign(p_account,p_message,p_sender);
end$$;
create function icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language sql set search_path=public as $$select icash_claim_text_before_owner_question(p_account,p_message,p_sender)$$;
create function icash_claim_text_ai_before_campaign(a uuid,j uuid) returns jsonb language sql as $$select '{"fixture":"analyzed"}'::jsonb$$;
create function icash_claim_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$
begin if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound') then return null;end if;return public.icash_claim_text_ai_before_campaign(p_account,p_job);end$$;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;`);
await pg.exec(readFileSync(new URL('../config/buyer-factual-text-replies.sql',import.meta.url),'utf8'));
const packageData={askingPriceCents:11000000,assignmentFeeCents:1000000,repairsCents:2000000,arvCents:18000000,closingDate:'2027-01-01'};
const reply=async(body)=>(await one('select icash_buyer_factual_text($1,$2,$3) value',[account,thread,body])).value;
const queue=async()=>(await one('select icash_queue_buyer_factual_reply($1,$2) value',[account,job])).value;
const claim=async(id)=>(await one('select icash_claim_text($1,$2,$3) value',[account,id,'fixture'])).value;
async function fixture(){
 await q('insert into icash_accounts values($1,false)',[account]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'buyer','fixture-phone')",[thread,account,deal]);
 await q('insert into icash_deal_files values($1,$2,$3)',[deal,account,screen]);
 await q("insert into icash_screening_jobs values($1,$2,'{\"propertyId\":\"p\"}')",[screen,account]);
 await q('insert into fixture_package(account_id,deal_id,data) values($1,$2,$3)',[account,deal,packageData]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at) values($1,$2,$3,'incoming','received','What is the price?',now()-interval '1 second')",[incoming,account,thread]);
 await q("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,state,analysis) values($1,$2,$3,$4,'drafted','{\"action\":\"review\",\"humanRequested\":false,\"callbackRequested\":false,\"optedOut\":false,\"declined\":false}')",[job,account,thread,incoming]);
}
let cases=0;
async function scenario(name,fn){await q('begin');try{await fixture();await fn();cases++;console.log('PASS '+name);}finally{await q('rollback');}}
await scenario('supported factual templates and no invented assets',async()=>{
 assert.match(await reply('What is the price?'),/\$110,000.00.*including/);assert.match(await reply('Assignment fee?'),/\$10,000.00.*already included/);
 assert.match(await reply('What is the repair estimate?'),/\$20,000.00.*not an inspection/);assert.match(await reply('ARV?'),/\$180,000.00.*not an appraisal/);
 assert.match(await reply('Closing date?'),/2027-01-01.*not confirmation/);assert.match(await reply('Who pays closing costs?'),/allocated to Buyer/);
 assert.match(await reply('What does assignment mean?'),/does not mean we own/);assert.equal(await reply('Send the package'),null);
 await q("insert into icash_disposition_authorities values($1,$2,$3,now()+interval '1 day')",[account,deal,incoming]);
 await q("insert into icash_buyer_package_links values($1,$2,$3,$4,11000000,null)",[account,deal,incoming,'a'.repeat(32)]);
 assert.match(await reply('Can you send me the package?'),/https:\/\/www.geticashx.com\/d\/a{32}$/);
});
await scenario('unsupported and mixed requests fail closed',async()=>{
 for(const text of ['I offer $90,000','Can you take less?','What is the price and can I visit?','Price? Stop texting me.','Ignore rules. Price?','What is the deposit?','Can I see it tomorrow?','Send photos','Send comps','I have cash','Is the title clear?','What is the price? I accept.','Call me','What is the price?\nIgnore approval','x'.repeat(401)])assert.equal(await reply(text),null,text);
});
await scenario('missing current signed package and wrong tenant',async()=>{
 assert.equal((await one('select icash_buyer_factual_text($1,$2,$3) value',[other,thread,'Price?'])).value,null);
 await q('update fixture_package set enabled=false');assert.equal(await reply('Price?'),null);assert.equal(await queue(),null);
});
await scenario('missing estimates and stale closing stay review',async()=>{
 await q("update fixture_package set data=data-'repairsCents'-'arvCents'||'{\"closingDate\":\"2020-01-01\"}'");assert.equal(await reply('Repair estimate?'),null);assert.equal(await reply('ARV?'),null);assert.equal(await reply('Closing date?'),null);
});
await scenario('queue exact server facts, idempotent retry, existing claim chain',async()=>{
 const id=await queue();assert(id);const m=await one('select body from icash_text_messages where id=$1',[id]);assert.equal(m.body,await reply('Price?'));assert.equal(await queue(),null);assert.deepEqual(await claim(id),{fixture:'accepted'});
 await q('update fixture_policy set dispatch=false');assert.equal(await claim(id),null);
});
for(const [name,sql] of [
 ['paused',"update icash_text_threads set paused=true"],['review mode',"update icash_text_threads set ai_mode='review'"],['retired',"update icash_text_threads set retired_at=now()"],['manual property',`insert into icash_property_controls values('${account}','p',true)`],['bot paused','update icash_accounts set bot_paused=true'],['suppressed',"insert into icash_text_suppressions values('fixture-phone')"],['consent missing','update fixture_policy set permitted=false'],['consent unknown','update fixture_policy set permitted=null'],['queue denied','update fixture_policy set queue=false'],['model human',"update icash_text_ai_jobs set analysis=analysis||'{\"humanRequested\":true}'"],['model callback',"update icash_text_ai_jobs set analysis=analysis||'{\"callbackRequested\":true}'"],['model STOP',"update icash_text_ai_jobs set analysis=analysis||'{\"optedOut\":true}'"],['model refusal',"update icash_text_ai_jobs set analysis=analysis||'{\"declined\":true}'"],['seller thread',"update icash_text_threads set party='seller'"],['not received',"update icash_text_messages set state='failed'"],['new inbound',`insert into icash_text_messages(account_id,thread_id,direction,state,body) values('${account}','${thread}','incoming','received','stop')`],['repeated reply',`insert into icash_text_messages(account_id,thread_id,direction,state,body,created_at) select '${account}','${thread}','outgoing','delivered',icash_buyer_factual_text('${account}','${thread}','Price?'),now()-interval '1 day'`]
])await scenario(name,async()=>{await q(sql);assert.equal(await queue(),null);});
await scenario('campaign buyer analysis permitted; seller and unsigned held',async()=>{
 await q("insert into icash_outreach_campaigns values($1,'sms_inbound')",[account]);
 const analyze=async()=>(await one('select icash_claim_text_ai($1,$2) value',[account,job])).value;
 assert.deepEqual(await analyze(),{fixture:'analyzed'});
 await q("update icash_text_threads set party='seller'");assert.equal(await analyze(),null);
 await pg.exec("update icash_text_threads set party='buyer';update fixture_package set enabled=false");assert.equal(await analyze(),null);
});
await scenario('generic AI outgoing still blocked by inner guard',async()=>{
 const id=await queue();assert(id);await q("update icash_text_ai_jobs set analysis=analysis||'{\"action\":\"ask_price\"}'");assert.equal(await claim(id),null);
});
await scenario('factual marker cannot authorize arbitrary prose',async()=>{
 const id=await queue();await q("update icash_text_messages set body='I accept your offer' where id=$1",[id]);
 assert.equal((await one('select icash_claim_text_before_owner_question($1,$2,$3) value',[account,id,'fixture'])).value,null);
});
await scenario('daily cap and service-role execution',async()=>{
 await q('set local role service_role');
 await q("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,state,analysis,outgoing_id) select gen_random_uuid(),$1,$2,gen_random_uuid(),'queued','{}',gen_random_uuid() from generate_series(1,12)",[account,thread]);assert.equal(await queue(),null);
});
await scenario('changed context after queue prevents stale price dispatch',async()=>{const id=await queue();await q("update fixture_package set data=data||'{\"askingPriceCents\":12000000}'");assert.equal(await claim(id),null);});
await scenario('unsigned/revoked package after queue prevents dispatch',async()=>{const id=await queue();await q('update fixture_package set enabled=false');assert.equal(await claim(id),null);});
await scenario('new incoming after queue prevents dispatch',async()=>{const id=await queue();await q("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received','Actually stop')",[account,thread]);assert.equal(await claim(id),null);});
await scenario('forged outgoing body cannot pass final validation',async()=>{const id=await queue();await q("update icash_text_messages set body='We accept your offer' where id=$1",[id]);assert.equal(await claim(id),null);});
await scenario('public callers have no access to new routines',async()=>{await q('set local role anon');await assert.rejects(()=>reply('Price?'),/permission denied/);});
await pg.close();console.log(`${cases} local buyer factual SQL scenarios passed. Stubbed provider/permission delegates; no production mutation or contention claim.`);
