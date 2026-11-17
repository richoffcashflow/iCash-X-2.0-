import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {db as requestDb} from '../lib/stripe-test.ts';
import * as failures from '../lib/voice-budget-failure.ts';
import {loadService,databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {automationTick,WorkerOperationError} from '../worker/runner.mjs';
import {createScheduler} from '../worker/scheduler.mjs';

// Actual base claim, HTTP error mapper, text service, route and worker. Final
// financial admission is an explicit fixture; this does not reconstruct every
// production claim wrapper or infer that a previous provider send happened.
const pg=new PGlite(),nativeFetch=globalThis.fetch,env={...process.env};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),deal=id(2),thread=id(3),message=id(4),rate=id(5),sender='+12125550100';
const adapter=databaseAdapter(pg);
let nextTicket=100,tickets=new Map(),mode='late_refusal',finishes=[],sends=0,claimCalls=0,patches=0,logs=[];
const row=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
const addTicket=()=>{const n=nextTicket++,token=id(n).repeat(2);tickets.set(token,{id:id(n),token,accountId:account,kind:'seller_opener',openerMessageId:message,state:'issued'});return {token};};
const transport=async(url,options={})=>{
 assert(String(url).startsWith('https://database.example.invalid/rest/v1/'),'No external network');
 const path=String(url).slice('https://database.example.invalid/rest/v1/'.length),body=options.body?JSON.parse(options.body):undefined;
 if(path==='rpc/icash_consume_automation'){
  const t=tickets.get(body.p_token);if(!t||t.state!=='issued')return Response.json(null);
  t.state='consumed';return Response.json(t);
 }
 if(path==='rpc/icash_finish_automation'){
  if(mode==='finish_unknown')throw Error('Fixture finish transport unknown');
  const t=[...tickets.values()].find(t=>t.id===body.p_id);assert(t);assert.equal(t.state,'consumed');
  t.state=body.p_success?'complete':'held';t.outcome=body.p_outcome;finishes.push(structuredClone(body));return Response.json(null);
 }
 if(path==='rpc/icash_claim_text'||path==='rpc/icash_claim_customer_text'){
  claimCalls++;
  if(mode==='transport_unknown')throw Error('Fixture claim transport unknown');
  if(mode==='http_503')return Response.json({code:'P0001',message:'Text already dispatched'},{status:503});
  if(mode==='sql_other')return Response.json({code:'40P01',message:'Text already dispatched'},{status:400});
  if(mode==='late_refusal'||mode==='finish_unknown')await pg.exec('update fixture_admission set allowed=false');
  try{return Response.json(await adapter.db('rpc/icash_claim_text','POST',body));}
  catch(error){assert.equal(error.code,'P0001');assert.equal(error.message,'Text already dispatched');return Response.json({code:error.code,message:error.message,details:null,hint:null},{status:400});}
 }
 if(options.method==='PATCH')patches++;
 if(mode==='read_unknown')return Response.json({code:'P0001',message:'Text already dispatched'},{status:400});
 return Response.json(await adapter.db(path,options.method,body));
};
const dependencies={...failures,db:requestDb,instantLeadsEnabled:()=>false,smsWorkEnabled:()=>true,liveWorkReady:()=>true,
 sameBusinessNumber:(a,b)=>a===b,textPayload:()=>{},
 sendContiguityText:async()=>{sends++;if(mode==='provider_unknown')throw Error('Fixture provider outcome unknown');if(mode==='provider_typed')throw new failures.TextClaimRefusedError();return {messageId:'fixture-original-receipt'};},
 saveTextReceipt:async(_db,a,m,p)=>{assert.equal(a,account);assert.equal(m,message);await pg.query("update icash_text_messages set state='accepted',provider_id=$1 where id=$2",[p,m]);return {status:'message_accepted'};},
};
const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',dependencies);
const {POST}=await loadService('app/api/internal/automation/route.ts',{
 db:requestDb,dispatchTextMessage,ProspectingBudgetError:failures.ProspectingBudgetError,
 automationWorkReady:()=>true,newLiveWorkKinds:new Set(),NextResponse:{json:Response.json},console:{error:(...x)=>logs.push(x)},
});
const post=t=>POST(new Request('https://fixture.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+t.token}}));
const reset=async(nextMode='late_refusal')=>{
 mode=nextMode;tickets.clear();finishes=[];logs=[];claimCalls=0;patches=0;sends=0;
 await pg.exec("truncate fixture_reservations;update fixture_admission set allowed=true;update icash_text_messages set state='ready',provider_id=null;");
};
try{
 await pg.exec(`
 create table icash_accounts(id uuid primary key,bot_paused boolean);insert into icash_accounts values('${account}',false);
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);insert into icash_screening_jobs values('${deal}','${account}','{"propertyId":"fictional-property"}');
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);insert into icash_deal_files values('${deal}','${account}','${deal}','draft');
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,sender text,recipient text,paused boolean,permission_until timestamptz,permission_evidence text,dnc_clear boolean,dnc_checked_at timestamptz,timezone text,sms_rate_id uuid,mms_rate_id uuid,sender_pool_assigned boolean);
 insert into icash_text_threads values('${thread}','${account}','${deal}','${sender}','+12125550101',false,now()+interval '1 day','Offline fixture permission',true,now(),(select name from pg_timezone_names where extract(hour from now() at time zone name)=12 order by name limit 1),'${rate}',null,true);
 create table icash_text_messages(id uuid primary key,thread_id uuid,account_id uuid,body text,attachments jsonb,asset_ids uuid[],state text,direction text,provider_id text,updated_at timestamptz);
 insert into icash_text_messages values('${message}','${thread}','${account}','Offline fixture message','[]','{}','ready','outgoing',null,now());
 create table icash_text_senders(phone text,enabled boolean);insert into icash_text_senders values('${sender}',true);
 create table icash_text_suppressions(phone text);
 create table icash_text_assets(id uuid,account_id uuid,deal_id uuid,url text,verified_until timestamptz);
 create table icash_voice_configs(account_id uuid,phone_number_id text,enabled boolean);
 create table icash_operation_rates(id uuid,operation text,enabled boolean,expires_at timestamptz);insert into icash_operation_rates values('${rate}','sms_send',true,now()+interval '1 day');
 create table fixture_admission(allowed boolean);insert into fixture_admission values(true);
 create table fixture_reservations(operation_key text);
 create function icash_reserve_operation(uuid,text,uuid,timestamptz) returns void language sql as $$insert into public.fixture_reservations values($2)$$;
 create function icash_claim_operation(text) returns boolean language sql as $$select allowed from public.fixture_admission$$;
 `);
 const source=readFileSync(new URL('../config/text-messaging.sql',import.meta.url),'utf8');
 const claim=source.match(/create function public\.icash_claim_text\([\s\S]*?end \$\$;/)?.[0];assert(claim);await pg.exec(claim);
 Object.assign(process.env,{SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'fixture',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture'});
 globalThis.fetch=transport;

 // The preflight sees ready; the final operation gate changes before the real
 // claim. PostgreSQL raises and rolls back the entire attempted reservation.
 await reset();const first=addTicket(),response=await post(first);
 assert.equal(response.status,200,'Known atomic pre-send refusal is a held job, not an outage');
 assert.equal((await response.json()).status,'message_held');
 assert.equal(finishes.at(-1).p_success,false);assert.equal(finishes.at(-1).p_outcome,'message_held');
 assert.equal((await row('select count(*)::int n from fixture_reservations')).n,0);
 assert.deepEqual(await row('select state,provider_id from icash_text_messages'),{state:'ready',provider_id:null});
 assert.equal(sends,0);assert.equal(patches,0);assert.equal(claimCalls,1);assert.equal(logs.length,0);
 assert.equal((await post(first)).status,401);assert.equal(claimCalls,1,'Consumed capability cannot retry the refusal');
 for(const manual of [false,true]){await reset();assert.equal((await dispatchTextMessage(account,message,manual)).status,'message_held');assert.equal(sends,0);assert.equal(claimCalls,1);}

 const rejection={code:'P0001',message:'Text already dispatched'};
 for(const path of ['rpc/icash_claim_text','rpc/icash_claim_customer_text'])assert(await failures.voiceReservationFailure(path,400,Response.json(rejection)) instanceof failures.TextClaimRefusedError);
 for(const [path,status,body] of [
  ['rpc/icash_claim_text',503,rejection],['rpc/icash_claim_text',401,rejection],['rpc/icash_meta_claim_text',400,rejection],['rpc/icash_reserve_operation',400,rejection],
  ['rpc/icash_claim_text?query=1',400,rejection],['rpc/icash_claim_text',400,{...rejection,code:'57014'}],['rpc/icash_claim_text',400,{...rejection,code:'40P01'}],
  ['rpc/icash_claim_text',400,{...rejection,message:'Text already dispatched (unknown)'}],['rpc/icash_claim_text',400,null],
 ])assert(!(await failures.voiceReservationFailure(path,status,Response.json(body)) instanceof failures.TextClaimRefusedError));
 assert(!(await failures.voiceReservationFailure('rpc/icash_claim_text',400,new Response('private invalid body')) instanceof failures.TextClaimRefusedError));

 // Fresh independent capabilities keep progressing without infrastructure
 // backoff, but each original remains held and no provider work is invented.
 await reset();let now=0,issued=0;const queue=[addTicket(),addTicket()];
 const scheduler=createScheduler({now:()=>now,automationPools:['messages'],screening:async()=>false,
  automation:()=>automationTick(async()=>{issued++;return queue.shift()??null;},(_url,options)=>POST(new Request('https://fixture.invalid/api/internal/automation',options)),'messages')});
 for(const expected of [1,2]){
  now=(expected-1)*250;scheduler.run();
  for(let n=0;n<200&&finishes.length<expected;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(finishes.length,expected,'Next fresh capability is eligible without 30-second error backoff');
  // Allow the in-process route result to release this scheduler slot.
  for(let n=0;n<200&&scheduler.health().body.automationInFlight;n++)await new Promise(resolve=>setTimeout(resolve,5));
 }
 await scheduler.stop();assert.equal(finishes.length,2);assert(issued>=2);assert.equal(scheduler.health().body.automation,'available');assert.notEqual(scheduler.health().body.status,'degraded');assert.equal(sends,0);

 for(const bad of ['transport_unknown','http_503','sql_other','finish_unknown']){
  await reset(bad);const ticket=addTicket();
  await assert.rejects(automationTick(async()=>ticket,()=>post(ticket),'messages'),error=>error instanceof WorkerOperationError&&error.code==='AUTOMATION_HELD',bad);
  assert.equal(sends,0);assert.equal(patches,0);assert.equal(claimCalls,1);
 }
 await reset('read_unknown');await assert.rejects(dispatchTextMessage(account,message),/Database request failed/);assert.equal(sends,0);assert.equal(claimCalls,0);
 for(const uncertain of ['provider_unknown','provider_typed']){
  await reset(uncertain);assert.equal((await dispatchTextMessage(account,message)).status,'message_delivery_needs_review');assert.equal(sends,1);assert.equal(patches,1);
  assert.equal((await row('select state from icash_text_messages')).state,'needs_review');
  assert.equal((await dispatchTextMessage(account,message)).status,'message_held');assert.equal(sends,1,'An uncertain provider attempt cannot be sent again');
 }
 await reset('admitted');assert.equal((await dispatchTextMessage(account,message)).status,'message_accepted');assert.equal(sends,1);assert.equal(claimCalls,1);
 assert.equal((await dispatchTextMessage(account,message)).status,'message_held');assert.equal(sends,1);
 console.log('PASS actual atomic text refusal→HTTP mapper→service→route→worker: reservation rollback, one-use holds, no false outage/replay, unknown DB/provider outcomes retained. Financial admission is a fixture, not a production eligibility proof.');
}finally{globalThis.fetch=nativeFetch;await pg.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
