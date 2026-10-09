import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {sellerSubmissionStatus} from '../lib/seller-submission-status.ts';

assert.equal(sellerSubmissionStatus('unmatched').phase,'address_review');
assert.equal(sellerSubmissionStatus('unmatched').terminal,true);
assert.match(sellerSubmissionStatus('unmatched').message,/contact hasn’t started/);
assert.equal(sellerSubmissionStatus('checking').terminal,false);
assert.equal(sellerSubmissionStatus('qualified').phase,'matching');
assert.equal(sellerSubmissionStatus('assigned','queued').phase,'contacting');
assert.equal(sellerSubmissionStatus('assigned','contact_started').phase,'contact_started');
assert.equal(sellerSubmissionStatus('assigned','needs_setup').phase,'review');
assert.equal(sellerSubmissionStatus('assigned','queued','outside_contact_hours').phase,'scheduled');
assert.equal(sellerSubmissionStatus('assigned','contact_started','outside_contact_hours').phase,'contact_started','Confirmed contact takes precedence over an earlier schedule');
assert.doesNotMatch(sellerSubmissionStatus('assigned','needs_setup').message,/contact hasn’t started/i,'A partially sent response must not be labelled as no contact');

let token=null,owned=true,duplicate=false,state='unmatched',responseState='queued',reads=[];
const requestId='12345678-1234-4234-8234-123456789abc';
const guestHash=v=>createHash('sha256').update(v).digest('hex');
const mocks={cookies:async()=>({get:()=>token?{value:token}:undefined}),guestHash,validGuest:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),limitRequest:async()=>{},sellerSubmissionStatus,db:async(path,method)=>{
 assert.equal(method,undefined,'Status polling can only read; never spend, requeue or dispatch');reads.push(path);
 if(path.includes('request_id=')){
  assert(path.includes('request_id=eq.'+requestId));assert(path.includes('guest_hash=eq.'+guestHash(token)),'Receipt must belong to this browser');
  return owned?[{id:'fixture-lead',state:duplicate?'duplicate':state,canonical_id:duplicate?'fixture-canonical':null}]:[];
 }
 if(path.startsWith('icash_seller_intakes?id=eq.fixture-canonical'))return [{id:'fixture-canonical',state,canonical_id:null}];
 if(path.startsWith('icash_seller_responses?'))return [{state:responseState}];
 throw Error('Unexpected read');
}};
globalThis.__submissionStatus=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/seller/status/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__submissionStatus;\n'+source;
const route=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const req=(id=requestId)=>new Request('https://homeoffernetwork.com/api/seller/status?request='+id);
assert.equal((await route.GET(req('bad'))).status,400);
assert.equal((await route.GET(req())).status,404);assert.equal(reads.length,0);
token='a'.repeat(64);owned=false;assert.equal((await route.GET(req())).status,404);assert.equal(reads.length,1);
owned=true;const response=await route.GET(req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
assert.deepEqual(await response.json(),sellerSubmissionStatus('unmatched'));
duplicate=true;assert.equal((await (await route.GET(req())).json()).phase,'address_review');
state='assigned';responseState='contact_started';const started=await (await route.GET(req())).json();
assert.equal(started.phase,'contact_started');assert.deepEqual(Object.keys(started).sort(),['message','phase','terminal','title']);
console.log('PASS real progress states, private browser receipt, duplicate progress, no internal details, no contact or credit side effects.');
