import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let authorized=true,exists=true,available=true,providerMatches=true,reads=0,media=0;
const id='11111111-1111-4111-8111-111111111111',accountId='account-fixture';
const mocks={z,workAccount:async()=>{if(!authorized)throw Error('Not signed in');return {accountId};},
 getCustomerPhoneCall:async(call,account)=>{assert.equal(call,id);assert.equal(account,accountId);return exists?{id,provider_account_sid:'account-provider',recording_sid:'recording-fixture'}:null;},
 customerPhoneAudioAvailable:()=>available,
 customerPhoneProvider:()=>({account:'account-provider',recordings:{getRecording:async()=>{reads++;return {};},media:async()=>{media++;return new Uint8Array([1,2,3]);}}}),
 customerPhoneRecordingReceipt:()=>providerMatches?{status:'completed'}:null,
};
globalThis.__audioRoute=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/work/business-call/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__audioRoute;\n'+source).toString('base64'));
const get=()=>GET(new Request('https://example.test/api/work/business-call?id='+id+'&audio=1'));
authorized=false;assert.equal((await get()).status,503);assert.equal(reads,0);authorized=true;
exists=false;assert.equal((await get()).status,404);assert.equal(reads,0);exists=true;
available=false;assert.equal((await get()).status,404);assert.equal(reads,0);available=true;
providerMatches=false;assert.equal((await get()).status,404);assert.equal(media,0);providerMatches=true;
const response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Content-Type'),'audio/mpeg');assert.equal(media,1);
delete globalThis.__audioRoute;
console.log('PASS private manual-call audio: authenticated account scope, unavailable/expired media gate, canonical provider verification and no public audio URL.');
