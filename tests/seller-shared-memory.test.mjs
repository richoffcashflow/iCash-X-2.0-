import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {sellerOfferQualification,sellerDialogueState,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {chronologicalSellerHistory,readSellerMemory,sellerMemoryPrompt,sellerMemoryInboundTurns} from '../lib/seller-memory.ts';
import {sellerRequestsPrice} from '../lib/seller-conversation-efficiency.ts';
import {sellerConversionIntent} from '../lib/seller-conversion-intent.ts';
import {sellerCommunicationIntent,sellerCommunicationPreferences} from '../lib/seller-communication-intent.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional fixtures only');};
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const replay=[a('Are you the owner?'),u('Yes.'),a('Would you be interested in selling?'),u('I said sure.'),
 a('What condition is it in?'),u('Excellent.'),a('Is it occupied?'),u('It is occupied.'),
 a('Does it need repairs?'),u("I said it is excellent and there is nothing that needs to be done."),
 a('Are you looking to sell?'),u("I've already told you once, Mr. AI, I would."),
 a('When would you like to close?'),u('Whenever you want. How much are you offering?')];
let q=sellerOfferQualification({transcript:replay});assert.deepEqual(q.missing,['listing']);
assert.equal(q.nextQuestion,'Is the property currently listed with a real estate agent?');
for(const [question,fact] of [['What repairs are needed?','condition'],['Is anyone living there?','occupancy'],['When would you sell?','timing'],['Why are you selling?','situation']]){
 for(const answer of ['How did you get my phone number?','Who are you?','Call me tomorrow.','Email.','What repairs do you think it needs?']){
  q=sellerOfferQualification({transcript:[a(question),u(answer)]});assert(q.missing.includes(fact),question+' / '+answer);
 }
}
for(const source of ['Whenever you want. How much are you offering?','Yes. What would you pay?'])assert(sellerRequestsPrice(source));
for(const source of ['The last buyer asked what would you pay.','She said: How much are you offering?','How much? Stop calling.'])assert(!sellerRequestsPrice(source));
assert.equal(sellerConversionIntent('It depents of your offer'),'price');
assert.equal(sellerCommunicationIntent('Can I call you later?'),'return_call');
assert.equal(sellerCommunicationIntent('Email.'),'email');
assert.equal(sellerCommunicationIntent("I don't understand English."),'language');
assert.equal(sellerCommunicationIntent('Can I call you later? Stop texting.'),null);
assert.deepEqual(sellerCommunicationPreferences([{transcript:[a('What language would you prefer? / Que idioma prefiere?'),u('Spanish'),u('Email.')]}]),{language:'Spanish',channel:'email'});
const otherPerson=sellerOfferQualification({transcript:[u("I'm his son.")]},[{transcript:qualifiedSellerTurns}]);
assert(otherPerson.missing.includes('ownership'));
const ownerYes=sellerOfferQualification({transcript:[a('Are you the owner?'),u('Yes.')]});
assert(ownerYes.missing.includes('interest'));
const state=sellerDialogueState({sourceId:'fixture',transcript:[a('What repairs does it need?'),u("I don't know.")]});
assert.equal(state.facts.condition.status,'unknown');assert(!state.qualification.missing.includes('condition'));

// Actual speech timestamps win over late transcript ingestion. Each SMS keeps
// its own thread question, including simultaneous messages from another thread.
const history=chronologicalSellerHistory([
 {sourceId:'call',channel:'voice',startedAt:'2026-11-15T12:00:00Z',at:'2026-11-15T12:10:00Z',transcript:[{...a('When would you sell?'),seconds:5},{...u('Next month.'),seconds:10}]},
 {sourceId:'sms',channel:'sms',transcript:[{...a('When would you sell?'),threadId:'one',at:'2026-11-15T12:00:15Z'},{...a('Are you the owner?'),threadId:'two',at:'2026-11-15T12:00:18Z'},{...u('Actually next year.'),threadId:'one',sourceId:'correction',at:'2026-11-15T12:00:20Z'}]},
]);
assert.equal(sellerDialogueState(null,history).facts.timing.quote,'Actually next year.');
assert.equal(sellerDialogueState(null,history).facts.ownership,undefined);

// Exercise the real bound qualification service when an SMS lands mid-call.
const liveStart='2026-11-15T12:00:00Z',liveId='conv_fixture';
const liveRaw={binding:{accountId:'account',dealId:'deal',screeningId:'screen',phone:'+12125550123'},fingerprint:'fixture',complete:true,cached:{version:'seller-memory-v1'},liveCalls:[{conversationId:liveId,startedAt:liveStart}],conversations:[
 {sourceId:'older',channel:'sms',at:'2026-11-14T12:00:00Z',transcript:qualifiedSellerTurns},
 {sourceId:'newer',channel:'sms',at:'2026-11-15T12:00:40Z',transcript:[a('Are you looking to sell?'),u('No, I am not selling.')]},
]};
const liveBinding={...liveRaw.binding,conversationId:liveId};
const currentSpeech={transcript:[a('Are you looking to sell?'),u('Yes.')]};
const liveDb=async()=>liveRaw;
assert.equal((await boundSellerQualification(liveDb,liveBinding,currentSpeech)).stop,true,'new text refusal beats earlier spoken yes');
liveRaw.conversations[1].transcript=[a('When would you sell?'),u('Next year.')];
let fetches=0;
const providerCurrent=async()=>{fetches++;return {conversation_id:liveId,metadata:{start_time_unix_secs:Date.parse(liveStart)/1000},transcript:[{...a('Are you looking to sell?'),time_in_call_secs:5},{...u('Yes.'),time_in_call_secs:10}]};};
assert.equal((await boundSellerQualification(liveDb,liveBinding,currentSpeech,providerCurrent)).ready,true);assert.equal(fetches,1);
assert.equal((await boundSellerQualification(liveDb,liveBinding,currentSpeech,async()=>({...await providerCurrent(),conversation_id:'conv_other'}))).stop,true,'another call cannot supply ordering');
assert.equal((await boundSellerQualification(liveDb,liveBinding,currentSpeech,async()=>{throw Error('GET unavailable');})).stop,true,'unknown timing cannot manufacture chronology');
assert.equal((await boundSellerQualification(liveDb,liveBinding,currentSpeech,async()=>({...await providerCurrent(),metadata:{start_time_unix_secs:Date.parse(liveStart)/1000-86400}}))).stop,true,'unrelated provider clock cannot reorder a live call');
assert.doesNotThrow(()=>sellerMemoryInboundTurns({metadata:{start_time_unix_secs:1e100},transcript:[{...u('Yes.'),time_in_call_secs:1}]}));
const hugeQuote='It needs repairs. '+('The roof needs work. '.repeat(1200));
const largeSource={...liveRaw,liveCalls:[],cached:null,conversations:[{sourceId:'large',channel:'voice',at:liveStart,transcript:[a('What repairs are needed?'),u(hugeQuote)]}]};
const largeMemory=await readSellerMemory(async path=>{assert.equal(path,'rpc/icash_seller_memory_context','oversized projection must not retry a rejected cache write');return largeSource;},liveBinding);
assert.equal(largeMemory.state.facts.condition.quote,hugeQuote.trim());assert(largeMemory.complete);
for(const answer of ['My agent said I am the owner.','She said I want to sell.'])assert(sellerOfferQualification({transcript:[a('Are you the owner?'),u(answer)]}).missing.includes('ownership'));
const pg=await PGlite.create();
await pg.exec(`create role anon;create role authenticated;create role service_role;
create schema icash_seller_agreement_private;create schema icash_recorded_reception_private;
create table icash_accounts(id uuid primary key);
create table icash_screening_jobs(id uuid primary key);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table icash_contact_permissions(account_id uuid,screening_id uuid,phone text,party text);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,party text,retired_at timestamptz);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,body text,provider_id text,event_id text,created_at timestamptz);
create function icash_sms_reply_time(p uuid) returns numeric language sql stable as $$select extract(epoch from created_at) from public.icash_text_messages where id=p$$;
create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,operation_key text,completed_at timestamptz,result jsonb,conversation_id text);
create table icash_call_recordings(account_id uuid,operation_key text,provider_started_at timestamptz);
create table icash_seller_agreement_private.call_history(session_id uuid,account_id uuid,screening_id uuid,contact_key text,completed_at timestamptz,transcript jsonb,conversation_id text);
create table icash_recorded_reception_private.sessions(id uuid,account_id uuid,provider_started_at timestamptz,conversation_id text,from_phone text,call_ended_at timestamptz);`);
await pg.exec(readFileSync(new URL('../config/seller-shared-memory.sql',import.meta.url),'utf8'));
const query=(sql,args=[])=>pg.query(sql,args),rpc=async(name,args)=>(await query(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')}) value`,Object.values(args))).rows[0].value;
const account=randomUUID(),screen=randomUUID(),deal=randomUUID(),thread=randomUUID(),phone='+12125550123';
const binding={accountId:account,screeningId:screen,dealId:deal,phone};
await query('insert into icash_accounts values($1)',[account]);await query('insert into icash_screening_jobs values($1)',[screen]);
await query("insert into icash_deal_files values($1,$2,$3,'draft','{}')",[deal,account,screen]);
await query("insert into icash_text_threads values($1,$2,$3,$4,'seller',null)",[thread,account,deal,phone]);
let reads=0,saves=0;const db=async(path,_method,args)=>{if(path.endsWith('context'))reads++;else saves++;return rpc(path.slice(4),args);};
assert.equal(await readSellerMemory(db,binding),null,'inactive installation has no behavior');
await pg.exec('update icash_seller_memory_private.settings set enabled=true');
let tick=0;const at=()=>new Date(Date.now()-86400000+tick++*1000).toISOString();
async function turn(role,message,which=thread){return (await query("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,event_id,created_at) values($1,$2,$3,$4,$5,'fixture','fixture-event',$6) returning id",[account,which,role==='agent'?'outgoing':'incoming',role==='agent'?'delivered':'received',message,at()])).rows[0].id;}
for(const t of qualifiedSellerTurns)await turn(t.role,t.message);
for(let i=0;i<210;i++)await turn('user','Thank you.');
let memory=await readSellerMemory(db,binding);
assert(memory.complete);assert(memory.state.qualification.ready,'the first answers survive 48/200-message windows');
assert.equal(memory.state.facts.ownership.channel,'sms');assert(memory.state.facts.ownership.sourceId);
assert.equal(saves,1);await readSellerMemory(db,binding);assert.equal(saves,1,'same source has one durable snapshot');
assert((await boundSellerQualification(db,binding,{transcript:[u('I am calling back.')]})).ready,'actual voice service reuses SMS');
await turn('agent','When would you like to sell?');const correction=await turn('user','Next year.');
memory=await readSellerMemory(db,binding);assert.equal(memory.state.facts.timing.sourceId,correction);
assert.equal((await query('select count(*)::int n from icash_seller_memory_private.snapshots')).rows[0].n,2,'corrections preserve prior immutable evidence');
assert.equal(sellerMemoryPrompt(memory).facts.timing.quote,'Next year.');
const cached=await rpc('icash_seller_memory_context',{p_account:account,p_screening:screen,p_phone:phone});
await turn('user','Actually in two weeks.');
assert.equal(await rpc('icash_save_seller_memory',{p_account:account,p_screening:screen,p_phone:phone,p_fingerprint:cached.fingerprint,p_projection:cached.cached}),false,'concurrent new source rejects old projection');
assert.equal(await readSellerMemory(db,{...binding,accountId:randomUUID()}),null);
assert.equal(await readSellerMemory(db,{...binding,screeningId:randomUUID()}),null);
assert.equal(await readSellerMemory(db,{...binding,phone:'+12125550124'}),null);
const current=await rpc('icash_seller_memory_context',{p_account:account,p_screening:screen,p_phone:phone});
assert.equal(await rpc('icash_save_seller_memory',{p_account:account,p_screening:screen,p_phone:phone,p_fingerprint:current.fingerprint,p_projection:{version:'seller-memory-v1',facts:{ownership:{quote:'fabricated',sourceId:correction}}}}),false);
// The complete provider-bound inbound source retains answers in the middle.
const session=randomUUID(),ended=new Date(Date.now()-10000).toISOString();
const provider={metadata:{start_time_unix_secs:Math.floor((Date.now()-300000)/1000)},transcript:Array.from({length:120},(_,i)=>({role:i%2?'user':'agent',message:i===61?'The property needs a new roof.':i===60?'What repairs are needed?':'Thank you.',time_in_call_secs:i}))};
const full=sellerMemoryInboundTurns(provider),plain=full.map(({role,message})=>({role,message}));
const legacy=[...plain.slice(0,40),...plain.slice(-40)];
await query('insert into icash_recorded_reception_private.sessions(id,account_id,provider_started_at) values($1,$2,$3)',[session,account,new Date(Date.now()-310000).toISOString()]);
await query("insert into icash_seller_agreement_private.call_history values($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),$5,$6,$7)",[session,account,screen,phone,ended,legacy,'conv_fixture']);
assert.equal((await readSellerMemory(db,binding)).complete,false,'old clipped context is explicitly incomplete');
assert.equal(await rpc('icash_save_seller_memory_inbound_history',{p_session:session,p_conversation:'conv_fixture',p_transcript:full}),true);
memory=await readSellerMemory(db,binding);assert(memory.complete);assert.equal(memory.state.facts.condition.quote,'The property needs a new roof.');
await query('delete from icash_seller_agreement_private.call_history where session_id=$1',[session]);
assert.equal((await readSellerMemory(db,binding)).state.facts.condition.quote,'The property needs a new roof.','durable source survives legacy history expiry');
await pg.exec("update icash_seller_memory_private.settings set account_ids='{}'");assert.equal(await readSellerMemory(db,binding),null,'account outside prospective cohort retains existing path');
await pg.exec('update icash_seller_memory_private.settings set account_ids=null');
// Four old calls and a correction, outside the former 30-day/three-call window.
for(let i=0;i<5;i++)await query("insert into icash_live_conversations(id,account_id,screening_id,contact_key,party,state,operation_key,completed_at,result) values($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller','complete',$5,$6,$7)",[randomUUID(),account,screen,phone,'voice:'+randomUUID(),new Date(Date.now()-(50-i)*86400000).toISOString(),{transcript:i===0?qualifiedSellerTurns:[a('When would you like to sell?'),u('Next year.')]}]);
memory=await readSellerMemory(db,binding);assert.equal(memory.history.filter(h=>h.channel==='voice').length,72);
await query("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,event_id,created_at) select $1,$2,'incoming','received','Filler','fixture','event',now()-interval '1 hour' from generate_series(1,1001)",[account,thread]);
memory=await readSellerMemory(db,binding);assert.equal(memory.complete,false);assert.equal(memory.state.qualification.stop,true,'oversize history is explicit, never partial qualification');
assert.equal((await query("select has_schema_privilege('anon','icash_seller_memory_private','usage') allowed")).rows[0].allowed,false);
assert.equal((await query("select has_function_privilege('authenticated','icash_seller_memory_context(uuid,uuid,text)','execute') allowed")).rows[0].allowed,false);
await pg.close();
console.log('PASS shared seller memory: live-class paraphrases, unrelated answers, correction ordering, long histories, actual qualification service, immutable snapshots, source races and tenant/contact isolation. No provider calls.');
