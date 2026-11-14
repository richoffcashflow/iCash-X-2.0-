import assert from 'node:assert/strict';
import {activeOwnerColumns,activeOwnerExportRequest,recoverOwnerActiveExports} from '../lib/owner-active-export.ts';

const account='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002';
const request='00000000-0000-4000-8000-000000000003',lease='00000000-0000-4000-8000-000000000004';
const raw={export_id:'original-fixture',record_count:1,file_count:1,credits:{used:1,people:1}};
const saved={id:batch,accountId:account,createdAt:new Date().toISOString(),items:[{screeningId:'screen',snapshot:{propertyId:'prop_1'},ids:['per_1']}],
 preview:{data:[{dm_property_id:'prop_1',found:true,contacts:[{dm_person_id:'per_1',contact_type:'owner',availability:{phones:1}}]}],credits:{used:0,people:0,properties:0,deduplicated:0}},
 request:activeOwnerExportRequest(['per_1']),receipt:{httpStatus:200,raw,rawText:JSON.stringify(raw)},
 recovery:null,csv:null,lease,localOnly:false,atomicRecovery:true,quotaRequestId:request};
const fields={internal_person_id:'1',person_full_name:'Fixture',phone_1:'2145550100',is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'};
const csv=activeOwnerColumns.join(',')+'\n'+activeOwnerColumns.map(k=>fields[k]??'').join(',')+'\n';
const originalKey=process.env.DEALMACHINE_API_KEY,warn=console.warn;
process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';console.warn=()=>{};
try{
 for(const origin of ['ordinary','continuation']){
  const calls=[],http=[];
  const db=async(path,method,p)=>{
   calls.push(path);
   if(path==='rpc/icash_claim_owner_export_recovery')return origin==='ordinary'?structuredClone(saved):null;
   if(path==='rpc/icash_claim_owner_export_quota_recovery')return structuredClone(saved);
   if(path==='rpc/icash_finish_dealmachine_request'){assert.equal(p.p_request,request);assert.equal(p.p_result.outcome,'response');return true;}
   if(path==='rpc/icash_record_owner_export_quota_recovery'){assert.equal(p.p_batch,batch);assert.equal(p.p_lease,lease);assert.equal(p.p_request,request);assert.equal(p.p_receipt.raw.data.export_id,raw.export_id);return true;}
   if(path==='rpc/icash_record_owner_export_artifact'){assert.equal(p.p_csv,csv);return true;}
   if(path==='rpc/icash_save_owner_active_export'){assert.equal(p.p_results[0].result.creditsUsed,1);return true;}
   throw Error('Unexpected DB '+path);
  };
  const transport=async(url,options)=>{
   http.push(String(url));assert.equal(options.method,'GET');
   if(http.length===1){assert.equal(url,'https://api.v2.dealmachine.com/v1/exports/original-fixture');return Response.json({data:{export_id:raw.export_id,status:'completed',record_count:1,download_urls:[{url:'https://storage.googleapis.com/fixture.csv'}]}});}
   assert.equal(url.hostname,'storage.googleapis.com');return new Response(csv);
  };
  assert.equal((await recoverOwnerActiveExports(db,transport,batch)).status,'contacts_saved');
  assert.equal(http.length,2);assert(!calls.includes('rpc/icash_take_dealmachine_request'),'Atomic claim owns the only admission');
  assert.equal(calls.includes('rpc/icash_claim_owner_export_quota_recovery'),origin==='continuation');
 }
 // Null means no fresh admission, including quota deferral. No transport follows.
 let network=0;
 assert.equal((await recoverOwnerActiveExports(async()=>null,async()=>{network++;throw Error('No admission');})).status,'export_recovery_idle');
 assert.equal(network,0);
 // Any saved artifact, including an empty malformed one, stays local. SQL
 // does not admit a GET for its non-null artifact branch.
 const emptyArtifact={...saved,csv:'',atomicRecovery:undefined,quotaRequestId:undefined};
 assert.equal((await recoverOwnerActiveExports(async path=>{
  assert.equal(path,'rpc/icash_claim_owner_export_recovery');return emptyArtifact;
 },async()=>{network++;throw Error('Saved artifact cannot request a GET');})).status,'export_receipt_held');
 assert.equal(network,0);
 for(const origin of ['ordinary','continuation'])for(const mutate of [s=>delete s.quotaRequestId,s=>s.quotaRequestId='bad',s=>delete s.atomicRecovery,s=>s.atomicRecovery=false,s=>s.localOnly=true,s=>delete s.localOnly,s=>s.csv=csv]){
  const malformed=structuredClone(saved);mutate(malformed);let admissions=0;
  const db=async path=>{
   if(path==='rpc/icash_claim_owner_export_recovery')return origin==='ordinary'?malformed:null;
   if(path==='rpc/icash_claim_owner_export_quota_recovery')return malformed;
   admissions++;throw Error('Malformed claim must stop');
  };
  assert.equal((await recoverOwnerActiveExports(db,async()=>{network++;throw Error('Malformed claim');})).status,'export_receipt_held');
  assert.equal(network,0);assert.equal(admissions,0);
 }
 // Lost HTTP/body responses consume the exact admitted request as unknown.
 // The database's following idle claim must not cause a transport retry.
 for(const failure of ['transport','body']){
  let claimed=false,finished=null,http=0;
  const db=async(path,method,p)=>{
   if(path==='rpc/icash_claim_owner_export_recovery')return null;
   if(path==='rpc/icash_claim_owner_export_quota_recovery'){if(claimed)return null;claimed=true;return structuredClone(saved);}
   if(path==='rpc/icash_finish_dealmachine_request'){assert.equal(p.p_request,request);finished=p.p_result;return true;}
   throw Error('Uncertain request cannot save/settle or take another admission');
  };
  const transport=async()=>{http++;if(failure==='transport')throw Error('Disconnected');return new Response(new ReadableStream({start(c){c.error(Error('Body disconnected'));}}));};
  assert.equal((await recoverOwnerActiveExports(db,transport)).status,'export_receipt_held');
  assert.deepEqual(finished,{outcome:'unknown'});
  assert.equal((await recoverOwnerActiveExports(db,transport)).status,'export_recovery_idle');assert.equal(http,1);
 }
 let fallback=0;
 await assert.rejects(recoverOwnerActiveExports(async path=>{if(path==='rpc/icash_claim_owner_export_recovery')throw Error('Database unavailable');fallback++;return null;},async()=>{throw Error('No HTTP');}),/Database unavailable/);
 assert.equal(fallback,0,'Ordinary RPC failure is not idle or permission to use the fallback');
}finally{console.warn=warn;if(originalKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=originalKey;}
console.log('Owner export quota recovery: exact admitted GET, strict lane contract, lost-response hold, no duplicate admission or POST. Offline only.');
