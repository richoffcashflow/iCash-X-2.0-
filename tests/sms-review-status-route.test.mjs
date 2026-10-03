import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {authorityReviewStatus} from '../lib/authority-review-status.ts';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uid(1),screening=uid(2),deal=uid(3),thread=uid(4);
let current=true,owned=true,signedIn=true,calls=[];
const deps={z,authorityReviewStatus,NextResponse:{json:(body,o={})=>({body,status:o.status??200})},workAccount:async()=>{if(!signedIn)throw Error();return {accountId:account};},readContractCoverage:async()=>({states:[]}),contractCapability:()=>({supported:false,reason:'No test contract coverage'}),db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_sms_thread_review_current'){assert.deepEqual(body,{p_account:account,p_thread:thread,p_check_hour:false});return current;}
 assert.equal(method,undefined,'status cannot write');
 if(path.startsWith('icash_screening_jobs?')){assert(path.includes('account_id=eq.'+account)&&path.includes('id=eq.'+screening));return owned?[{id:screening}]:[];}
 if(path.startsWith('icash_accounts?'))return [{bot_paused:true}];
 assert(path.includes('account_id=eq.'+account),'All source reads are owner scoped');
 if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture business'}];
 if(path.startsWith('icash_wallets?'))return [{balance_cents:300,reserved_cents:0}];
 if(path.startsWith('icash_deal_files?'))return [{id:deal,terms:{state:'TX'}}];
 if(path.startsWith('icash_text_threads?')){assert(path.includes('deal_id=eq.'+deal));assert(!path.includes('sms_review_request_id=not.is.null')); return [{id:thread}];}
 return [];
}};
globalThis.__smsStatus=deps;
let source=ts.transpileModule(readFileSync(new URL('../app/api/work/review-status/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__smsStatus;\n'+source).toString('base64'));delete globalThis.__smsStatus;
const req=()=>new Request('https://example.invalid/api/work/review-status?screeningId='+screening);
let r=await GET(req());assert.equal(r.status,200);assert.equal(r.body.items.find(i=>i.key==='sms_contact_permission').status,'recorded');assert.equal(r.body.items.find(i=>i.key==='contact_permission').status,'blocked');assert(!JSON.stringify(r.body).includes(thread));
for(const reason of ['expired','revoked','suppressed','stale rate']){current=false;r=await GET(req());assert.equal(r.body.items.find(i=>i.key==='sms_contact_permission').status,'blocked',reason);}
current='true';r=await GET(req());assert.equal(r.body.items.find(i=>i.key==='sms_contact_permission').status,'blocked','only actual SQL boolean is current');
owned=false;calls=[];assert.equal((await GET(req())).status,404);assert.equal(calls.length,1);assert(!calls.some(x=>x.path.startsWith('rpc/')));
signedIn=false;calls=[];assert.equal((await GET(req())).status,503);assert.equal(calls.length,0);
console.log('SMS review status: actual route uses current-revision predicate, preserves voice separation, expired/revoked holds, tenant-scoped property and no raw contact evidence.');
