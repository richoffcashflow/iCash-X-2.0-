import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {mergeStoredDealTerms} from '../lib/deal-term-update.ts';

const stored={...dealTermsSchema.parse({address:'SIMULATION ONLY',state:'TX'}),practice:true,provenance:{kind:'practice',source:'synthetic'}};
assert.equal(mergeStoredDealTerms({seller:'Changed fixture'},stored).practice,true);
assert.deepEqual(mergeStoredDealTerms({seller:'Changed fixture'},stored).provenance,stored.provenance);
assert.deepEqual(mergeStoredDealTerms({...stored,provenance:{source:'synthetic',kind:'practice'}},stored),stored);
for(const input of [{practice:false},{practice:null},{provenance:{}},{unreviewed:'new'}])assert.throws(()=>mergeStoredDealTerms(input,stored),/provenance/);
assert.throws(()=>mergeStoredDealTerms({practice:true},null),/provenance/);
assert.equal(mergeStoredDealTerms({seller:'Real seller'},null).seller,'Real seller');
assert.equal(mergeStoredDealTerms({}, {...stored,practice:false}).practice,false);
assert.throws(()=>mergeStoredDealTerms({priceCents:-1},stored));

const account='11111111-1111-4111-8111-111111111111',screening='22222222-2222-4222-8222-222222222222';
let current=stored,writes=[],origin=true,reads=[];
const deps={z,mergeStoredDealTerms,dealTermsSchema,NextResponse:{json:(body,o={})=>({body,status:o.status??200})},allowedOrigin:()=>origin,workAccount:async()=>({accountId:account}),db:async(path,method,body)=>{
 reads.push(path);
 if(path.startsWith('icash_deal_files?')){assert(path.includes('account_id=eq.'+account)&&path.includes('screening_id=eq.'+screening));return current?[{terms:current}]:[];}
 if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture buyer'}];
 if(path.startsWith('icash_screening_jobs?'))return [{result:{property:{legalDescription:'Fixture legal'}}}];
 if(path==='rpc/icash_prepare_deal'){writes.push(body);return 'fixture-deal';}
 throw Error(path);
}};
globalThis.__dealTermTest=deps;
const load=async(file,suffix)=>{
 const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__dealTermTest;\n'+source+'\n//'+suffix).toString('base64'));
};
const request=terms=>new Request('https://example.invalid/api/work/deals',{method:'POST',body:JSON.stringify({screeningId:screening,terms})});
if(process.argv[2]){
 const before=await load(process.argv[2],'before');
 assert.equal((await before.POST(request({seller:'Changed fixture'}))).status,200);
 assert.equal(writes.at(-1).p_terms.practice,undefined,'Baseline replaces practice terms with JSON lacking the marker');
 assert.equal((await before.POST(request(stored))).status,400,'Baseline normal UI echo of practice metadata is rejected');
 console.log('Baseline reproduced: omitted practice/provenance is passed to replacing SQL; unchanged UI metadata is rejected.');
}
const route=await load(new URL('../app/api/work/deals/route.ts',import.meta.url),'fixed');
writes=[];
for(const input of [{seller:'Changed fixture'},stored]){
 const response=await route.POST(request(input));assert.equal(response.status,200);
 assert.equal(writes.at(-1).p_terms.practice,true);assert.deepEqual(writes.at(-1).p_terms.provenance,stored.provenance);
 assert.equal(response.body.terms.practice,true);assert.equal(writes.at(-1).p_terms.buyer,'Fixture buyer');
}
const count=writes.length;
for(const input of [{practice:false},{provenance:{kind:'real'}},{unknown:'value'}])assert.equal((await route.POST(request(input))).status,400);
assert.equal(writes.length,count);
current=null;assert.equal((await route.POST(request({seller:'Real fixture'}))).status,200);assert.equal(writes.at(-1).p_terms.practice,undefined);
assert.equal((await route.POST(request({practice:true}))).status,400);
origin=false;reads=[];assert.equal((await route.POST(request({}))).status,403);assert.equal(reads.length,0);
delete globalThis.__dealTermTest;
console.log('Deal updates preserve server provenance, reject promotion/new metadata, remain tenant-scoped, and retain ordinary editable terms.');
