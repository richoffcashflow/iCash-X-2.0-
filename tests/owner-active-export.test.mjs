import assert from 'node:assert/strict';
import {activeOwnerColumns,activeOwnerExportRequest,parseOwnerExportCsv,allocateActiveOwnerExport,enrichActiveOwners,recoverOwnerActiveExports} from '../lib/owner-active-export.ts';
import {ownerBatchAudience} from '../lib/owner-batch.ts';
import {OwnerPreviewRateLimitError} from '../lib/owner-enrichment-deferral.ts';
const now=new Date().toISOString(),account='00000000-0000-4000-8000-000000000001';
const owner=id=>({dm_person_id:id,contact_type:'owner',availability:{phones:3}});
const snapshot=id=>({propertyId:id,propertyType:'house',fetchedAt:now,sellerCostReserveCents:100000,raw:{data:{dm_property_id:id,full_address:'Fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}});
const candidates=[1,2,3].map(n=>({screeningId:String(n),snapshot:snapshot('prop_'+n)}));
const preview={data:candidates.map((c,i)=>({dm_property_id:c.snapshot.propertyId,found:true,contacts:i===0?[owner('per_9007199254740993123')]:i===1?[owner('per_9007199254740993123'),owner('per_2')]:[owner('per_3')]})),totals:{submitted:3,found:3,not_found:0},credits:{used:0,people:0,properties:0,deduplicated:0}};
const audience=ownerBatchAudience(preview,candidates,25),ids=[...new Set(audience.flatMap(a=>a.ids))];
const row=(id,phone='2145550100')=>Object.fromEntries(activeOwnerColumns.map(k=>[k,({internal_person_id:id.slice(4),person_full_name:'Synthetic, Owner',phone_1:phone,is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'})[k]??'']));
const csvOf=rows=>[activeOwnerColumns,...rows.map(r=>activeOwnerColumns.map(k=>r[k]))].map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
const csv=csvOf([row(ids[0]),row(ids[1],'2145550101')]);
const receipt=()=>({httpStatus:200,raw:{export_id:'export-fixture',record_count:2,file_count:1,credits:{used:1,people:2}},rawText:'{}'});
const base={id:'00000000-0000-4000-8000-000000000009',createdAt:now,request:activeOwnerExportRequest(ids),receipt:receipt()};
const allocated=allocateActiveOwnerExport(base,csv,audience);
assert.deepEqual(allocated.map(a=>[a.result.creditsUsed,a.result.peopleCredits,a.result.allocation.sharedContacts,a.result.contacts.length]),[[1,1,0,1],[0,1,1,2],[0,0,0,0]]);
assert.equal(allocated[0].result.contacts[0].personId,ids[0]);assert.equal(allocated[0].result.contacts[0].name,'Synthetic, Owner');
assert.equal(allocated[0].result.contacts[0].phones[0].activityBasis,'provider_export_filter');
for(const a of allocated){assert.deepEqual(a.result.providerCredits,{used:1,people:2});assert.equal(a.result.outreachAuthorized,false);assert(!('deduplicated' in a.result.providerCredits));}
for(const mutate of [r=>{delete r.raw.credits.used;},r=>{r.raw.credits.used=3;},r=>{r.raw.credits.properties=1;},r=>{r.httpStatus=500;},r=>{r.raw.credits.premium=1;},r=>{r.raw.record_count=3;}]){const bad=structuredClone(base);mutate(bad.receipt);assert.throws(()=>allocateActiveOwnerExport(bad,csv,audience));}
for(const mutate of [r=>{r.internal_person_id='4';},r=>{r.is_phone_1_dnc='Yes';},r=>{r.is_phone_1_dnc='';},r=>{r.has_active_phone_number='No';},r=>{r.phone_1='';},r=>{r.phone_2=r.phone_1;r.is_phone_2_dnc='No';r.people_phone_2_type_id='Wireless';}]){const bad=row(ids[0]);mutate(bad);assert.throws(()=>allocateActiveOwnerExport(base,csvOf([bad,row(ids[1])]),audience));}
assert.throws(()=>allocateActiveOwnerExport(base,csvOf([row(ids[0]),row(ids[0])]),audience));
assert.throws(()=>parseOwnerExportCsv(csv.replace('"internal_person_id"','"invented_id"')));
assert.throws(()=>parseOwnerExportCsv(csv+'"unterminated'));
assert.throws(()=>parseOwnerExportCsv('x'.repeat(1048577)));
assert.throws(()=>activeOwnerExportRequest(['per_alpha']));
assert.throws(()=>activeOwnerExportRequest(['per_1','per_1']));
const free={...base,receipt:receipt()};free.receipt.raw.credits.used=0;assert.equal(allocateActiveOwnerExport(free,csv,audience).reduce((n,x)=>n+x.result.creditsUsed,0),0);

let paid=0,downloads=0,gets=0,claimed=false,saved=null,results=null,quota=true,busy=false,timeout=false,artifactFail=false;
const config={contact_rate_id:'rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:'2099-01-01',research_version:2};
const db=async(path,method,p)=>{
 if(path==='rpc/icash_owner_batch_candidates')return candidates;
 if(path==='rpc/icash_take_dealmachine_request')return quota;
 if(path==='rpc/icash_finish_dealmachine_request')return true;
 if(path==='rpc/icash_admit_owner_active_export'){
  if(busy)return 'export_busy';if(claimed)return 'held';claimed=true;
  assert.deepEqual(p.p_request,activeOwnerExportRequest(ids));
  saved={id:p.p_batch,accountId:account,createdAt:now,items:p.p_items,preview:p.p_preview,request:p.p_request,csv:null,lease:'fixture-lease'};return 'claimed';
 }
 if(path==='rpc/icash_record_owner_export_receipt'){saved.receipt=p.p_receipt;assert.equal(paid,1);return true;}
 if(path==='rpc/icash_claim_owner_export_recovery')return saved?.receipt?structuredClone(saved):null;
 if(path==='rpc/icash_record_owner_export_recovery'){saved.recovery=p.p_receipt.raw;return true;}
 if(path==='rpc/icash_record_owner_export_artifact'){saved.csv=p.p_csv;return !artifactFail;}
 if(path==='rpc/icash_save_owner_active_export'){results=p.p_results;assert.equal(p.p_rows.length,2);return true;}
 throw Error('Unexpected DB '+path);
};
const transport=async(url,options)=>{
 url=String(url);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
 if(url.endsWith('/properties/ids'))return Response.json(preview);
 if(url.endsWith('/people/export')){assert(claimed);assert(!saved.receipt);paid++;if(timeout)throw Error('timeout');const r=receipt().raw;return Response.json(r);}
 if(url.endsWith('/exports/export-fixture')){gets++;assert(saved.receipt);return Response.json({data:{export_id:'export-fixture',status:'completed',record_count:2,download_urls:[{url:'https://storage.googleapis.com/fixture.csv.gz'}]}});}
 if(url==='https://storage.googleapis.com/fixture.csv.gz'){downloads++;assert(!options.headers,'Provider authorization must never reach storage');return new Response(csv);}
 throw Error('Unexpected transport');
};
const reset=()=>{paid=0;downloads=0;gets=0;claimed=false;saved=null;results=null;quota=true;busy=false;timeout=false;artifactFail=false;};
const originalKey=process.env.DEALMACHINE_API_KEY,originalWarn=console.warn;process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';console.warn=()=>{};
try{
 assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,transport)).status,'contacts_saved');assert.equal(paid,1);assert.equal(downloads,1);assert.equal(results.length,3);
 assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,transport)).status,'held');assert.equal(paid,1);
 // Quota and organization contention cannot create a purchase or wallet claim.
 reset();quota=false;await assert.rejects(enrichActiveOwners(db,account,candidates[0],config,250000,transport),OwnerPreviewRateLimitError);assert.equal(paid,0);assert.equal(claimed,false);
 reset();busy=true;await assert.rejects(enrichActiveOwners(db,account,candidates[0],config,250000,transport),OwnerPreviewRateLimitError);assert.equal(paid,0);assert.equal(claimed,false);
 reset();timeout=true;await assert.rejects(enrichActiveOwners(db,account,candidates[0],config,250000,transport),/timeout/);assert.equal(paid,1);assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,transport)).status,'held');assert.equal(paid,1);
 // A lost artifact-write acknowledgment resumes from the original saved CSV.
 reset();artifactFail=true;assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,transport)).status,'export_receipt_held');assert(saved.csv);artifactFail=false;
 assert.equal((await recoverOwnerActiveExports(db,transport)).status,'contacts_saved');assert.equal(paid,1);assert.equal(gets,1);assert.equal(downloads,1);
 reset();const hugeRecovery=(url,options)=>String(url).includes('/exports/')?new Response('x'.repeat(131073)):transport(url,options);
 assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,hugeRecovery)).status,'export_receipt_held');assert.equal(paid,1);assert.equal(downloads,0);assert.equal(results,null);
 reset();preview.data[0].contacts[0].availability.phones=0;
 assert.equal((await enrichActiveOwners(db,account,candidates[0],config,250000,transport)).status,'empty');assert.equal(paid,1);assert.equal(results.length,2);assert.equal(saved.items.length,2);
 preview.data[0].contacts[0].availability.phones=3;
}finally{console.warn=originalWarn;if(originalKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=originalKey;}
console.log('Owner active export: exact text IDs, partial/shared owners, raw credits, DNC/activity checks, bounded CSV, one POST, quota/concurrency holds and original-only recovery passed. Offline only.');
