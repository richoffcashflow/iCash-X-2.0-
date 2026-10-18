import {instantLeadsEnabled} from '../lib/meta-instant-lead-service.ts';
// ISOLATED SIMULATION. Real dispatch/receipt service bodies and PostgreSQL functions;
// fixed-size synthetic work, in-memory database, provider stubs, no network or live credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {saveTextReceipt} from '../lib/text-receipt.ts';
import {reliabilitySchema} from '../lib/reliability.ts';

const require=createRequire(import.meta.url);
const CONCURRENCY=12,ACCOUNTS=2,MESSAGES_PER_ACCOUNT=6,REPLAYS=8;
const originalFetch=globalThis.fetch,originalEnvironment={CONTIGUITY_API_KEY:process.env.CONTIGUITY_API_KEY,CONTIGUITY_WEBHOOK_SECRET:process.env.CONTIGUITY_WEBHOOK_SECRET,SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};
globalThis.fetch=async()=>{throw Error('Network is forbidden in bounded concurrency simulation');};
process.env.CONTIGUITY_API_KEY='SIMULATION ONLY';process.env.CONTIGUITY_WEBHOOK_SECRET='SIMULATION ONLY';
let pg;
const measurements=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function batch(name,tasks){
 let cursor=0,active=0,peak=0;const latencies=[];const started=performance.now();
 const results=Array(tasks.length);
 const workers=await Promise.allSettled(Array.from({length:Math.min(CONCURRENCY,tasks.length)},async()=>{
  while(cursor<tasks.length){const index=cursor++;active++;peak=Math.max(peak,active);const start=performance.now();
   try{results[index]=await tasks[index]();}finally{latencies.push(performance.now()-start);active--;}
  }
 }));
 const failed=workers.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 latencies.sort((a,b)=>a-b);
 const round=value=>Math.round(value*100)/100;
 measurements.push({phase:name,requests:tasks.length,peakInFlight:peak,durationMs:round(performance.now()-started),p50Ms:round(latencies[Math.ceil(latencies.length*.5)-1]),p95Ms:round(latencies[Math.ceil(latencies.length*.95)-1])});
 return results;
}
try{
 ({pg}=await createJourneyDb(require.resolve('@electric-sql/pglite')));
 await pg.exec(readFileSync(new URL('../config/text-ai.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/reliability-monitor-and-receipts.sql',import.meta.url),'utf8'));
 const {db,rpc,q}=databaseAdapter(pg),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
 const from='+14243948384',accounts=[],messages=[];
 const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
 const costs=Object.fromEntries(categories.map(name=>[name,name==='messaging'?1000:0]));
 const manifest=Object.fromEntries(categories.map(name=>[name,{amountMicros:costs[name],evidenceRef:'SIMULATION provider and complete cost receipt'}]));
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('sms_send',$1,100,$2,'SIMULATION complete cost quote',now()-interval '1 minute',now()+interval '1 day',true) returning id",[randomUUID(),costs])).id;
 await q('update icash_operating_budget set enabled=true,funded_micros=1000000000,protected_micros=0,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1');
 const timezone=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1")).name;
 for(let index=0;index<ACCOUNTS;index++){
  const user=randomUUID(),account=randomUUID(),to='+1202555010'+index;
  await q('insert into auth.users(id,email) values($1,$2)',[user,`bounded-${index}@example.invalid`]);
  await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'SIMULATION',false,100000)",[account,user]);
  await q("insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values($1,100000,0,'USD')",[account]);
  const screening=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state) values($1,$2,$3,'complete') returning id",[account,randomUUID(),{propertyId:'SIMULATION-'+index}])).id;
  const deal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'under_contract','{}') returning id",[account,screening])).id;
  const thread=(await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused) values($1,$2,$3,$4,now()+interval '1 day','SIMULATION explicit permission',$5,now(),true,$6,false) returning id",[account,deal,from,to,timezone,rate])).id;
  accounts.push({account,thread,to});
  for(let number=0;number<MESSAGES_PER_ACCOUNT;number++)messages.push({account,thread,to,key:randomUUID(),body:`Synthetic message ${index} ${number}`,ambiguous:number===0,lostReceipt:number===1});
 }
 const queue=message=>rpc('icash_queue_text',{p_account:message.account,p_thread:message.thread,p_key:message.key,p_body:message.body,p_assets:'{}'});
 await batch('duplicate enqueue',messages.flatMap(message=>Array.from({length:REPLAYS},()=>async()=>{
  const id=await queue(message);if(message.id)assert.equal(id,message.id);else message.id=id;
 })));
 assert.equal(Number((await one('select count(*) n from icash_text_messages')).n),messages.length,'A request key queues one message');
 // Cross-account attempts must never reveal or operate on another tenant's message.
 await batch('tenant isolation',messages.map(message=>async()=>{
  const other=accounts.find(account=>account.account!==message.account);
  await assert.rejects(queue({...message,account:other.account,thread:other.thread}),/Message key conflict/);
  assert.equal(await rpc('icash_claim_text',{p_account:other.account,p_message:message.id,p_sender:from}),null);
 }));
 const byBody=new Map(messages.map(message=>[message.body,message])),byId=new Map(messages.map(message=>[message.id,message]));
 const sends=new Map(),receiptAttempts=new Map();
 const fixtureDb=async(path,method,body,signal)=>{
  if(path.startsWith('icash_meta_lead_messages?'))return []; // These synthetic messages belong to ordinary property threads.
  const result=await db(path,method,body,signal);
  if(path==='rpc/icash_accept_text'){
   const count=(receiptAttempts.get(body.p_message)||0)+1;receiptAttempts.set(body.p_message,count);
   if(byId.get(body.p_message)?.lostReceipt&&count===1)throw Error('SIMULATION commit succeeded but response was lost');
  }
  return result;
 };
 const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',{instantLeadsEnabled,
  db:fixtureDb,saveTextReceipt,smsWorkEnabled:()=>true,liveWorkReady:()=>true,sameBusinessNumber:(a,b)=>a===b,
  elevenRequest:async()=>{throw Error('Voice provider is forbidden in this fixture');},
  textPayload:payload=>{assert.equal(payload.from,from);assert(byBody.has(payload.message));},
  sendContiguityText:async payload=>{
   const message=byBody.get(payload.message);assert(message);assert.equal(payload.to,message.to);
   sends.set(message.id,(sends.get(message.id)||0)+1);assert.equal(sends.get(message.id),1,'Duplicate provider dispatch');
   await sleep(message.lostReceipt?25:10);
   if(message.ambiguous)throw Error('SIMULATION unknown provider outcome');
   return {messageId:'SIMULATION-'+message.id};
  }
 });
 const results=await batch('contending dispatch',messages.flatMap(message=>Array.from({length:REPLAYS},()=>()=>dispatchTextMessage(message.account,message.id))));
 assert.equal(sends.size,messages.length);assert(results.every(result=>['message_held','message_accepted','message_delivery_needs_review'].includes(result.status)));
 for(const message of messages){
  const row=await one('select account_id,state,provider_id from icash_text_messages where id=$1',[message.id]);
  assert.equal(row.account_id,message.account);assert.equal(row.state,message.ambiguous?'needs_review':'accepted');
  assert.equal(row.provider_id,message.ambiguous?null:'SIMULATION-'+message.id);
  if(message.lostReceipt)assert.equal(receiptAttempts.get(message.id),2,'Only the receipt save is retried');
 }
 const known=messages.filter(message=>!message.ambiguous);
 await batch('duplicate delivery callbacks',known.flatMap(message=>{
  const event={id:'SIMULATION-delivered-'+message.id,type:'text.delivery.confirmed',timestamp:Date.now()/1000,data:{message_id:'SIMULATION-'+message.id,from,to:message.to}};
  return Array.from({length:REPLAYS},()=>()=>rpc('icash_ingest_text_event',{p_event:event,p_optout:false}));
 }));
 await batch('duplicate verified settlements',known.flatMap(message=>Array.from({length:REPLAYS},()=>()=>rpc('icash_settle_complete_costs',{p_operation:'text:'+message.id,p_charge:100,p_components:manifest,p_evidence:'SIMULATION verified complete usage '+message.id}))));
 assert.equal(Number((await one('select count(*) n from icash_cost_manifests')).n),known.length,'One cost manifest per known outcome');
 assert.equal(Number((await one('select count(*) n from icash_fractional_usage')).n),known.length,'One fractional charge per known outcome');
 assert.equal(Number((await one('select count(*) n from icash_text_events')).n),known.length,'Duplicate callbacks create no extra events');
 for(const {account} of accounts){
  const sums=await one('select sum(customer_price_micros) price from icash_text_messages where account_id=$1 and state=\'delivered\'',[account]);
  const wallet=await one('select balance_cents from icash_wallets where account_id=$1',[account]);
  assert.equal(Number(wallet.balance_cents),100000-Math.floor(Number(sums.price)/10000),'Wallet contains exactly one verified charge per message');
 }
 const state=(await q('select state,count(*)::integer count from icash_text_messages group by state order by state')).rows;
 assert.deepEqual(state,[{state:'delivered',count:10},{state:'needs_review',count:2}]);
 await batch('retries after uncertain outcomes',messages.flatMap(message=>Array.from({length:REPLAYS},()=>async()=>assert.equal((await dispatchTextMessage(message.account,message.id)).status,'message_held'))));
 assert.equal([...sends.values()].reduce((sum,count)=>sum+count,0),messages.length,'Neither ambiguous nor successful sends are repeated');
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SECRET_KEY='SIMULATION ONLY';
 let probes=0;
 const component={status:'ok',checkedAt:new Date().toISOString()};
 const workflow={status:'ok',fresh:true,components:{worker:component,maintenance:component},snapshot:null};
 const {serviceHealth}=await loadService('lib/service-health.ts',{reliabilitySchema,fetch:async url=>{
  assert(url.startsWith('https://fixture.invalid/'));probes++;await sleep(25);
  return Response.json(url.includes('/rpc/')?workflow:url.includes('/rest/')?[{id:1}]:{});
 }});
 await batch('health probe coalescing',Array.from({length:96},()=>async()=>assert.equal((await serviceHealth()).status,'ok')));
 assert.equal(probes,3,'96 health requests must share one database, auth and workflow probe');
 let failedProbes=0;
 const unhealthy=await loadService('lib/service-health.ts',{reliabilitySchema,fetch:async()=>{failedProbes++;await sleep(25);return new Response('SIMULATION unavailable',{status:503});}});
 await batch('health outage coalescing',Array.from({length:96},()=>async()=>assert.equal((await unhealthy.serviceHealth()).status,'degraded')));
 assert.equal(failedProbes,3,'Failed health probes also coalesce; callers must not stampede the database');
 console.log(JSON.stringify({result:'PASS',mode:'isolated PGlite; single database connection',concurrency:CONCURRENCY,accounts:ACCOUNTS,uniqueMessages:messages.length,providerStubCalls:messages.length,verifiedSettlements:known.length,uncertainOutcomesHeld:2,duplicateSends:0,duplicateCharges:0,tenantMismatches:0,healthyProbeRequests:probes,outageProbeRequests:failedProbes,measurements,limitations:'Concurrent service requests; PGlite serializes SQL. Not multi-connection lock contention, production provider latency, or production capacity.'},null,2));
}finally{
 await pg?.close();globalThis.fetch=originalFetch;
 for(const [key,value] of Object.entries(originalEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
