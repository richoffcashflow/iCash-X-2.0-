import {signatureRequestMessage} from '../lib/signing-invitation.ts';
import {originalContractProfile,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';
import {normalizeSigningPhone} from '../lib/signing-phone.ts';
const terms=dealTermsSchema.parse({seller:'Fixture seller',buyer:'Fixture principal',address:'Fixture property',legalDescription:'Fixture lot',state:'TX',priceCents:100000,priceSource:'seller_reported',earnestCents:0});
const phone='+12025550100',recipients=[{id:'1',phone,name:'Fixture seller',placeholder_name:'Seller'},{id:'2',email:'owner@example.invalid',name:'Fixture principal',placeholder_name:'Customer'}];
let testMode=true,allowed=true,providerPhone=phone,pricing=400000,payload=null;
const envelope=()=>({id:'envelope',account_id:'account',deal_id:'deal',terms,kind:'purchase',terms_hash:signingTermsHash(terms),template_id:'template',provider_id:'123',state:'awaiting_counterparty',test_mode:testMode,recipients});
const template={id:'template',provider:'docuseal',provider_template_id:'123',placeholder_names:['Seller','Customer'],field_map:Object.fromEntries(Object.keys(signingFields(terms)).map(k=>[k,k])),rate_id:'rate',reviewed_until:'2099-01-01',max_legal_description_chars:2000};
const db=async(path,method)=>{
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture principal'}];
 if(path.startsWith('icash_text_threads'))return [{id:'thread'}];
 if(path==='rpc/icash_sms_thread_review_current')return allowed;
 if(path.startsWith('icash_text_suppressions'))return [];
 if(path.startsWith('icash_signing_templates'))return [template];
 if(path.startsWith('icash_operation_rates'))return [{operation:'contract_signing',enabled:true,expires_at:'2099-01-01',costs_micros:{messaging:pricing}}];
 if(path==='rpc/icash_begin_signing')return envelope();
 if(path.startsWith('icash_signing_envelopes')){assert(path.includes('account_id=eq.account')||method==='PATCH');return method==='PATCH'?[]:[envelope()];}
 throw Error('Unexpected fixture '+path);
};
const originals={fetch:globalThis.fetch,mode:process.env.DOCUSEAL_MODE,key:process.env.DOCUSEAL_TEST_API_KEY,liveKey:process.env.DOCUSEAL_API_KEY,live:process.env.ICASH_LIVE_WORK_READY};
globalThis.__contractFixture={signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation:async(_i,send)=>send(),signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema};
const src=ts.transpileModule(readFileSync(new URL('../lib/signing-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const service=await import('data:text/javascript;base64,'+Buffer.from('const {signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema}=globalThis.__contractFixture;\n'+src).toString('base64'));
globalThis.fetch=async(_url,options)=>{
 if(options.method==='POST'){payload=JSON.parse(options.body);return Response.json([{submission_id:123},{submission_id:123}]);}
 return Response.json({id:123,submitters_order:'preserved',completed_at:null,submitters:recipients.map((r,index)=>({id:index+1,submission_id:123,phone:index===0?providerPhone:undefined,email:r.email,external_id:`envelope:${r.id}`,status:'awaiting',completed_at:null,metadata:{terms_hash:signingTermsHash(terms)},slug:'fixture_only'}))});
};
const input={accountId:'account',userId:'user',customerEmail:'owner@example.invalid',dealId:'deal',kind:'purchase',signers:[{name:'Fixture seller',phone}]};
try{
 process.env.DOCUSEAL_MODE='test';process.env.DOCUSEAL_TEST_API_KEY='fixture';process.env.DOCUSEAL_API_KEY='fixture';process.env.ICASH_LIVE_WORK_READY='true';
 assert.equal(normalizeSigningPhone('(202) 555-0100'),phone);assert.equal(normalizeSigningPhone('2025550100 ext 4'),null);
 await service.sendForSignatures(input);assert.equal(payload.submitters[0].phone,phone);assert.equal(payload.submitters[0].send_sms,true);assert.equal(payload.submitters[0].send_email,false);assert.equal(payload.submitters[0].require_phone_2fa,true);assert.equal(payload.submitters[1].email,'owner@example.invalid');
 allowed=false;payload=null;await assert.rejects(()=>service.sendForSignatures(input),/current text conversation/);assert.equal(payload,null);allowed=true;
 await assert.rejects(()=>service.pendingCounterpartySigningLink('account','envelope',phone),/approved live/);
 testMode=false;process.env.DOCUSEAL_MODE='live';
 assert.deepEqual(await service.pendingCounterpartySigningLink('account','envelope',phone),{signerId:'1',url:'https://docuseal.com/s/fixture_only'});
 await assert.rejects(()=>service.pendingCounterpartySigningLink('account','envelope','+12025550199'),/next signer/);
 providerPhone='+12025550199';await assert.rejects(()=>service.pendingCounterpartySigningLink('account','envelope',phone),/Signer evidence/);providerPhone=phone;
 pricing=0;payload=null;await assert.rejects(()=>service.sendForSignatures(input),/pricing needs setup/);assert.equal(payload,null);
 console.log('PASS contract SMS payload, phone normalization, permission hold, phone-bound link, test/live isolation, provider identity, live SMS cost guard. No external requests.');
}finally{
 globalThis.fetch=originals.fetch;delete globalThis.__contractFixture;
 for(const [key,value] of Object.entries({DOCUSEAL_MODE:originals.mode,DOCUSEAL_TEST_API_KEY:originals.key,DOCUSEAL_API_KEY:originals.liveKey,ICASH_LIVE_WORK_READY:originals.live})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
