import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {parseExportCsv,inspectSavedActiveExport} from '../scripts/dealmachine-export-artifact.mjs';
import {runApprovedActiveExport} from '../scripts/run-approved-dealmachine-active-export.mjs';
import {activeExportRetryProvider} from '../scripts/verify-dealmachine-active-export.mjs';
const csv='dm_person_id,full_name,phones\r\nper_456,"Fixture, Owner","[{""number"":""2025550123"",""type"":""wireless"",""do_not_call"":false}]"\r\n';
assert.equal(parseExportCsv(csv)[1][1],'Fixture, Owner');
for(const invalid of ['a,b\nx\n','a,a\nx,y\n','a\n"unfinished','a\nx\ny\n'])assert.throws(()=>parseExportCsv(invalid),/EXPORT_/);
let row={status:'response_saved',httpStatus:200,runId:'fixture',personId:'per_456',request:{people_ids:['per_456']},receipt:{record_count:1,credits:{used:1,people:1},download_urls:[{url:'https://storage.googleapis.com/fixture/signed.csv.gz?private=fixture'}]}},gets=0,writes=0;
const db=async(path,method,body)=>{if(method==='PATCH'){writes++;assert(path.includes('result->artifact=is.null'));row=body.result;}return [{result:row}];};
const transport=async(url,options)=>{gets++;assert.equal(options.method,'GET');assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return new Response(gzipSync(csv));};
const result=await inspectSavedActiveExport({db,transport});
assert.equal(result.status,'saved');assert.equal(result.rowCount,1);assert.equal(result.columns[0].type,'requested_owner_id');
assert.deepEqual(result.columns[2].objectKeys,['number','type','do_not_call']);assert.equal(row.artifact.csv,csv);assert.equal(gets,1);assert.equal(writes,1);
assert.doesNotMatch(JSON.stringify(result),/2025550123|Fixture, Owner|private=fixture/);
assert.equal((await inspectSavedActiveExport({db,transport})).status,'already_saved');assert.equal(gets,1);
delete row.artifact;row.receipt.download_urls[0].url='https://example.invalid/file';await assert.rejects(inspectSavedActiveExport({db,transport}),/HOST_INVALID/);assert.equal(gets,1);
row.receipt.download_urls[0].url='https://storage.googleapis.com/fixture/signed.csv.gz?private=fixture';
for(const value of [{2025550123:'wireless',FixtureOwner:'private'},[{2025550123:'wireless',FixtureOwner:'private'}]]){
 delete row.artifact;
 const dictionaryCsv='dm_person_id,phones\nper_456,"'+JSON.stringify(value).replaceAll('"','""')+'"\n';
 const summary=await inspectSavedActiveExport({db,transport:async()=>new Response(gzipSync(dictionaryCsv))});
 assert.equal(summary.columns[1].otherKeyCount,2);assert.doesNotMatch(JSON.stringify(summary),/2025550123|FixtureOwner/);assert.equal(row.artifact.csv,dictionaryCsv);
}
let loads=0;assert.equal((await runApprovedActiveExport({VERCEL_ENV:'production'},async()=>{loads++;})).status,'not_requested');assert.equal(loads,0);
assert.equal((await runApprovedActiveExport({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027'},async()=>{loads++;})).status,'configuration_unavailable');assert.equal(loads,0);
const retryPath=`icash_integration_checks?provider=eq.${activeExportRetryProvider}`;
delete row.artifact;
await inspectSavedActiveExport({provider:activeExportRetryProvider,transport,db:async(path,...args)=>{
 assert(path.startsWith(retryPath),'The retry artifact must not overwrite v1');return db(path,...args);
}});
await assert.rejects(inspectSavedActiveExport({provider:'unapproved',db:async()=>assert.fail('No database read')}),/OPERATION_INVALID/);
const previewEnv={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/dealmachine-active-phone-contract-20261027',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'FIXTURE'};
const unapproved=await runApprovedActiveExport(previewEnv,async()=>async(path,method)=>{
 assert.equal(method,undefined);assert.equal(path,retryPath+'&select=result');return [];
});
assert.equal(unapproved.verification.status,'approval_required');assert.equal(unapproved.artifact.status,'not_requested');
console.log('PASS original export artifact: bounded free download, host/redirect controls, private CSV receipt, safe schema output, exact scope, no repeated download, production/foreign configuration blocked.');
