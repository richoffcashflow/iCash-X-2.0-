import assert from 'node:assert/strict';
import {inspectPhoneContract,inspectSavedPhoneContract,exportMetadataAdmission,exportVerificationFields} from '../scripts/check-dealmachine-phone-contract.mjs';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',DEALMACHINE_API_KEY:'fixture-secret'};
const catalog=exportVerificationFields.map(field_id=>({field_id,type:'STRING',billing_category:'people',name:'ignored private name',description:'ignored private text'}));
function provider({fields=catalog,states=[],hasMore=false,fieldPages=false,wrongDetail=false,error=false}={}){
 const calls=[],receipts=[];
 const transport=async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-secret');
  if(error)return Response.json({error:{message:'private error 2025550123',request_id:'private-request'}},{status:500});
  if(url.includes('/fields?'))return Response.json({data:fields,pagination:{has_next_page:fieldPages}});
  if(url==='https://api.v2.dealmachine.com/v1/exports?limit=5')return Response.json({data:states.map((status,i)=>({
   export_id:'private-export-'+i,status,name:'private export name',progress_stage:'private stage 2025550123',record_count:3,
   credits:{used:2,people:3},download_urls:[{filename:'people_export_fixture.csv.gz',url:'https://storage.googleapis.com/private-download?secret=fixture',size:234}],
  })),pagination:{total:states.length,has_more:hasMore}});
  const id=url.split('/').at(-1);assert.match(id,/^private-export-\d$/);
  return Response.json({data:{export_id:wrongDetail?'different':id,status:'failed',error:{message:'private error 2025550123'},download_urls:[{url:'https://storage.googleapis.com/private-download'}]}});
 };
 return {transport,calls,receipts,run:()=>inspectPhoneContract(env,transport,{saveReceipt:async r=>{receipts.push(r);}})};
}
const valid=provider(),good=await valid.run();
assert.equal(good.status,'checked');assert.equal(good.admission,'ready');assert.equal(good.paidRequests,0);assert.equal(valid.calls.length,2);
assert.deepEqual(good.requestedFields.map(f=>f.catalogStatus),['listed','listed','listed']);
assert.equal(good.existingExports.complete,true);assert.equal(good.existingExports.allStatuses,true);
const all=provider({states:['pending','processing','failed','completed']}),result=await all.run();
assert.equal(all.calls.length,5);assert.deepEqual(result.existingExports.stateCounts,{pending:1,processing:1,completed:1,failed:1,unknown:0});
assert.equal(result.admission,'export_in_progress');assert.equal(result.existingExports.samples[2].detailChecked,true);
assert.deepEqual(result.existingExports.samples[3].files,[{size:234,people:true,gzip:true}]);
assert.doesNotMatch(JSON.stringify(result),/fixture-secret|private-export|private export name|private-download|private stage|private error|2025550123|ignored private/);
assert.match(JSON.stringify(all.receipts),/private-download/,'Original metadata is retained privately, not discarded');
const actualCatalog=provider({fields:[{field_id:'person_full_name',type:'STRING'},{field_id:'has_active_phone_number',type:'BOOLEAN'}]});
const uncertain=await actualCatalog.run();assert.equal(uncertain.admission,'export_fields_unverified');assert(uncertain.requestedFields.every(f=>f.catalogStatus==='not_listed'));
for(const fields of [catalog.map(f=>({...f,billing_category:undefined})),catalog.map(f=>({...f,billing_category:'property'})),[...catalog,catalog[0]]]){
 assert.equal((await provider({fields}).run()).admission,'export_fields_unverified');
}
assert.equal((await provider({hasMore:true}).run()).admission,'export_history_incomplete');
assert.equal((await provider({states:['unknown-status']}).run()).admission,'export_history_incomplete');
const bounded=provider({fields:[],fieldPages:true});assert.equal((await bounded.run()).status,'catalog_incomplete');assert.equal(bounded.calls.filter(x=>x.includes('/fields?')).length,4);
await assert.rejects(provider({states:['failed'],wrongDetail:true}).run(),/METADATA_EXPORT_BINDING_INVALID/);
const blocked=provider();for(const overrides of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{DEALMACHINE_API_KEY:''}])await inspectPhoneContract({...env,...overrides},blocked.transport);assert.equal(blocked.calls.length,0);
assert.equal(exportMetadataAdmission({}), 'field_catalog_incomplete');

// Only the exact trusted preview can persist raw metadata. It uses a distinct
// insert-only key and never modifies either consumed paid approval/receipt.
const savedEnv={...env,VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'private-db-secret'};
function database(){
 let saved=null,writes=0;
 const db=async(path,method='GET',body)=>{
  if(method==='GET'){assert.match(path,/^icash_integration_checks\?provider=eq\.dealmachine_phone_contract_metadata_v2_[a-f0-9]{40}&select=result$/);return saved?[saved]:[];}
  assert.equal(method,'POST');assert.equal(path,'icash_integration_checks');assert.match(body.provider,/^dealmachine_phone_contract_metadata_v2_/);assert.equal(saved,null);saved=structuredClone(body);writes++;return [saved];
 };
 return {db,get saved(){return saved;},get writes(){return writes;}};
}
const storage=database(),savedProvider=provider({states:['failed']});
const snapshot=await inspectSavedPhoneContract(savedEnv,async()=>storage.db,savedProvider.transport);
assert.equal(snapshot.snapshot,'saved');assert.equal(storage.writes,1);assert.equal(storage.saved.result.receipts.length,3);
assert.match(JSON.stringify(storage.saved.result.receipts),/private error 2025550123/);
assert.doesNotMatch(JSON.stringify(snapshot),/2025550123|private-download|private-db-secret|fixture-secret/);
const before=savedProvider.calls.length;await inspectSavedPhoneContract(savedEnv,async()=>storage.db,savedProvider.transport);assert.equal(savedProvider.calls.length,before);assert.equal(storage.writes,1);
const failedStorage=database(),failedProvider=provider({error:true});const failed=await inspectSavedPhoneContract(savedEnv,async()=>failedStorage.db,failedProvider.transport);
assert.equal(failed.status,'metadata_unavailable');assert.equal(failedStorage.saved.result.receipts[0].httpStatus,500);assert.doesNotMatch(JSON.stringify(failed),/private error|2025550123/);
for(const overrides of [{VERCEL_ENV:'production'},{VERCEL_GIT_REPO_OWNER:'elsewhere'},{SUPABASE_URL:'https://other.supabase.co'},{VERCEL_GIT_COMMIT_SHA:'bad'}])await inspectSavedPhoneContract({...savedEnv,...overrides},async()=>assert.fail('Foreign configuration cannot load credentials'),()=>assert.fail('No provider request'));
console.log('PASS phone contract: exact field/billing validation before spend, bounded all-status history/details, private immutable raw metadata, no contact downloads or paid requests, safe output and preview-only scope.');
