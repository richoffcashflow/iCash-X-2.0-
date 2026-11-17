import assert from 'node:assert/strict';
import {completedMetaDays,metaSpendDays,syncSellerMetaCosts,listMetaCostAccounts} from '../lib/seller-meta-costs.ts';
const now=new Date('2026-10-18T02:00:00Z'),days=completedMetaDays('America/Chicago',now),campaign='987654321';
assert.equal(days[0],'2026-10-10');assert.equal(days[6],'2026-10-16','Use the ad account calendar, not UTC today');
assert.deepEqual(completedMetaDays('America/Chicago',new Date('2026-11-02T06:00:00Z')).slice(-2),['2026-10-31','2026-11-01'],'DST days remain calendar days');
const row={campaign_id:campaign,date_start:days[6],date_stop:days[6],spend:'11.20',account_currency:'USD'};
assert.equal(metaSpendDays({data:[row]},campaign,days)[6].spendMicros,11200000);
assert.equal(metaSpendDays({data:[]},campaign,days).length,7);
for(const bad of [{spend:'-1'},{spend:'NaN'},{spend:'1.0000001'},{account_currency:'EUR'},{campaign_id:'111111111'},{date_stop:days[0]},{date_start:'2026-10-17',date_stop:'2026-10-17'}])assert.throws(()=>metaSpendDays({data:[{...row,...bad}]},campaign,days));
assert.throws(()=>metaSpendDays({data:[row,row]},campaign,days));assert.throws(()=>metaSpendDays({data:[row],paging:{next:'https://example.com'}},campaign,days));
const env={VERCEL_ENV:'production',META_GRAPH_VERSION:'v26.0',META_ADS_READ_ACCESS_TOKEN:'synthetic-token'},calls=[],requests=[];
let fail=false;const transport=async(url,options)=>{
 const u=new URL(url);requests.push({url:u,options});assert.equal(u.origin,'https://graph.facebook.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(u.searchParams.has('access_token'),false);
 if(fail)return Response.json({error:{code:190,message:'sensitive provider text'}},{status:400});
 if(u.pathname.endsWith('/insights'))return Response.json({data:[row]});
 if(u.pathname.endsWith('/'+campaign))return Response.json({id:campaign,account_id:'123456789'});
 return Response.json({id:'act_123456789',currency:'USD',timezone_name:'America/Chicago'});
};
const db=async(path,method,body)=>{calls.push({path,method,body});if(path==='rpc/icash_seller_meta_access')return null;return path.includes('claim_')?{id:'synthetic-source',token:'synthetic-lease',accountId:'act_123456789',metaCampaignId:campaign}:true;};
assert.equal((await syncSellerMetaCosts(db,{...env,VERCEL_ENV:'preview'},transport,now)).status,'disabled_outside_production');assert.equal(calls.length,0);
assert.equal((await syncSellerMetaCosts(db,env,transport,now)).status,'synced');assert.equal(requests.length,3);assert.equal(calls.at(-1).body.p_days[6].spendMicros,11200000);
const insight=requests.at(-1).url;assert.equal(insight.searchParams.get('time_increment'),'1');assert.equal(JSON.parse(insight.searchParams.get('filtering'))[0].value[0],campaign);
fail=true;assert.equal((await syncSellerMetaCosts(db,env,transport,now)).status,'connection_required');assert.equal(calls.at(-1).body.p_days,null,'Provider errors cannot become zero spend');assert(!JSON.stringify(calls).includes('synthetic-token'));assert(!JSON.stringify(calls).includes('sensitive provider text'));
let pages=0;const accounts=await listMetaCostAccounts(env,async(url)=>{const u=new URL(url);pages++;assert.equal(u.origin,'https://graph.facebook.com');assert.equal(pages===2?u.searchParams.get('after'):null,pages===2?'safe-cursor':null);return Response.json({data:[{id:pages===1?'act_111111':'act_222222',name:'Synthetic',currency:pages===1?'USD':'EUR'}],...(pages===1?{paging:{next:'https://untrusted.example/token',cursors:{after:'safe-cursor'}}}:{})});});
assert.deepEqual(accounts,[{id:'act_111111',name:'Synthetic'}]);assert.equal(pages,2,'Pagination uses validated cursor on the original endpoint');
console.log('PASS automatic Meta costs: read-only requests, exact USD amounts, timezone/DST, complete reports, duplicate/currency rejection, safe pagination, secret redaction, failed reads preserve costs and preview does no work.');

// The public sync entry point must reject an oversized report while it is still
// arriving. It must not read the whole report before enforcing the existing cap.
const encoder=new TextEncoder(),limit=500000;
const accountInfo={id:'act_123456789',currency:'USD',timezone_name:'America/Chicago'};
async function syncBody(response){
 const writes=[];let reads=0;
 const database=async(path,method,body)=>{
  if(path==='rpc/icash_seller_meta_access')return null;
  if(path==='rpc/icash_claim_seller_cost_sync')return {id:'synthetic-source',token:'synthetic-lease',accountId:'act_123456789',metaCampaignId:campaign};
  assert.equal(path,'rpc/icash_finish_seller_cost_sync');writes.push(body);return true;
 };
 const result=await syncSellerMetaCosts(database,env,async()=>{
  reads++;
  return reads===1?response:reads===2?Response.json({id:campaign,account_id:'123456789'}):Response.json({data:[row]});
 },now);
 return {result,writes,reads};
}
function chunkedBody(text,chunkSize=65536,{cleanup='resolved',open=false}={}){
 const bytes=encoder.encode(text);let offset=0,cancelled=0,close,lateReject;
 const stream=new ReadableStream({
  start(controller){close=()=>{try{controller.close();}catch{}};},
  pull(controller){
   if(offset<bytes.length){const end=Math.min(offset+chunkSize,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}
   else if(!open)controller.close();
  },
  cancel(){cancelled++;if(cleanup==='rejected')return Promise.reject(Error('private cleanup failure'));if(cleanup==='pending')return new Promise((_,reject)=>{lateReject=reject;});},
 },{highWaterMark:0});
 const response=new Response(stream);
 if(cleanup==='synchronous'){
  const getReader=stream.getReader.bind(stream);
  stream.getReader=()=>{const reader=getReader();reader.cancel=()=>{cancelled++;throw Error('private cleanup failure');};return reader;};
 }
 return {response,bytesRead:()=>offset,cancellations:()=>cancelled,finish(){lateReject?.(Error('private late cleanup failure'));close();}};
}
{
 const fixture=chunkedBody('x'.repeat(2000000));
 const outcome=await syncBody(fixture.response);
 assert.equal(outcome.result.status,'invalid_report');
 assert(fixture.bytesRead()<=limit+65536,'Reject before consuming the remainder of an oversized provider report');
 assert.equal(outcome.reads,1,'Never fetch a replacement report');
 assert.equal(outcome.writes.length,1);assert.equal(outcome.writes[0].p_days,null,'Unknown cost never becomes zero spend');
 assert.equal(fixture.response.body.locked,false);
}
for(const cleanup of ['resolved','rejected','pending','synchronous']){
 const fixture=chunkedBody('x'.repeat(limit+1),65536,{cleanup,open:true});let timeout;
 try{
  const result=await Promise.race([syncBody(fixture.response),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Oversized body or cleanup blocked cost finalization')),500);})]);
  assert.equal(result.result.status,'invalid_report');assert.equal(result.reads,1);assert.equal(result.writes.length,1);assert.equal(result.writes[0].p_days,null);
  assert.equal(fixture.cancellations(),1);assert.equal(fixture.response.body.locked,false);
 }finally{clearTimeout(timeout);fixture.finish();await new Promise(resolve=>setImmediate(resolve));}
}
for(const character of ['x','é','界','😀']){
 const prefix=JSON.stringify({...accountInfo,extra:''}),available=limit-prefix.length;
 const body=JSON.stringify({...accountInfo,extra:character.repeat(Math.floor(available/character.length))+'x'.repeat(available%character.length)});
 assert.equal(body.length,limit);
 // Small odd-sized chunks split multi-byte code points. The old character cap
 // must not silently turn into a smaller byte cap or corrupt account evidence.
 const fixture=chunkedBody(body,8191);const outcome=await syncBody(fixture.response);
 assert.equal(outcome.result.status,'synced');assert.equal(outcome.reads,3);assert.equal(outcome.writes.length,1);assert.equal(outcome.writes[0].p_days[6].spendMicros,11200000);
 assert.equal(fixture.response.body.locked,false);
}
{
 const fixture=chunkedBody('\ufeff'+JSON.stringify(accountInfo),1);
 assert.equal((await syncBody(fixture.response)).result.status,'synced','Preserve response.text UTF-8 BOM decoding');
}
console.log('PASS Meta cost report streaming: early bounded rejection, original claim finalization, cleanup failures, exact character boundary and split UTF-8 evidence.');
