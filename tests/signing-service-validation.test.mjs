import {signatureRequestMessage} from '../lib/signing-invitation.ts';
import {originalContractProfile,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';

// Exercise actual server send/auto-sign entry points with only in-memory database and provider fixtures.
let formProfile='legacy',payload=null,tamperPrice=false;
let now=Date.parse('2026-09-30T12:00:00Z'),advanceBeforeSend=false,advanceAfterAutoClaim=false,records=[],providerWrites=0,autoClaims=0;
let terms=dealTermsSchema.parse({seller:'Fixture seller',buyer:'Fixture principal',address:'Fixture only',legalDescription:'Fixture lot',state:'TX',priceCents:100000,priceSource:'seller_reported',earnestCents:0,closingDate:'2026-10-02'});
const recipients=[{id:'1',email:'seller@example.invalid',name:'Fixture seller',placeholder_name:'Seller'},{id:'2',email:'customer@example.invalid',name:'Fixture principal',placeholder_name:'Customer'}];
const envelope=()=>({id:'envelope',account_id:'account',deal_id:'deal',terms,kind:'purchase',terms_hash:signingTermsHash(terms),template_id:'template',provider_id:'123',state:'awaiting_counterparty',test_mode:true,recipients});
const template=()=>({form_profile:formProfile,id:'template',provider:'docuseal',provider_template_id:'123',placeholder_names:['Seller','Customer'],field_map:Object.fromEntries(Object.keys(signingFields(terms,'purchase',false,formProfile)).map(k=>[k,k])),test_mode:true,rate_id:null,reviewed_until:'2027-01-01T00:00:00Z',max_legal_description_chars:2000,automated_signing_reviewed:true,customer_signature_field:'signature',customer_consent_field:'consent'});
const db=async(path,method,body)=>{
 records.push({path,method,body});
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture principal'}];
 if(path.startsWith('icash_signing_templates'))return [template()];
 if(path==='rpc/icash_begin_signing'){if(advanceBeforeSend)now=Date.parse('2026-10-04T12:00:00Z');return envelope();}
 if(path.startsWith('icash_signing_envelopes'))return method==='PATCH'?[]:[envelope()];
 if(path==='rpc/icash_claim_signing_poll')return true;
 if(path==='rpc/icash_save_signing_status')return null;
 if(path==='rpc/icash_claim_auto_signature'){if(formProfile===originalContractProfile)return null;autoClaims++;if(advanceAfterAutoClaim)now=Date.parse('2026-10-04T12:00:00Z');return 'Fixture signature';}
 if(path==='icash_signature_authorizations')return null;
 throw Error('Unexpected fixture database call '+path);
};
const fixtureFetch=async(url,options)=>{
 assert(String(url).startsWith('https://api.docuseal.com/'));
 if(options.method!=='GET'){providerWrites++;payload=JSON.parse(options.body);assert(!JSON.parse(options.body).submitters?.some(s=>s.fields.some(f=>f.name==='earnestCents')));return Response.json([{submission_id:123},{submission_id:123}]);}
 return Response.json({id:123,submitters_order:'preserved',completed_at:null,submitters:recipients.map((r,index)=>({id:index+1,submission_id:123,email:r.email,external_id:`envelope:${r.id}`,status:index===0?'completed':'awaiting',completed_at:index===0?'2026-09-30T12:00:00Z':null,metadata:{terms_hash:signingTermsHash(terms)},values:Object.entries(signingFields(terms,'purchase',false,formProfile)).filter(([,value])=>formProfile!==originalContractProfile||value!=='').map(([field,value])=>({field,value:tamperPrice&&field==='priceCents'?'999.00':value})),slug:'fixture'}))});
};
globalThis.__signingValidationFixture={signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation:async(_i,send)=>send(),signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema};
let source=ts.transpileModule(readFileSync(new URL('../lib/signing-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema}=globalThis.__signingValidationFixture;\n'+source;
const {sendForSignatures,refreshSigning,customerSigningLink}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const oldFetch=globalThis.fetch,oldNow=Date.now,oldKey=process.env.DOCUSEAL_TEST_API_KEY,oldMode=process.env.DOCUSEAL_MODE;
globalThis.fetch=fixtureFetch;Date.now=()=>now;process.env.DOCUSEAL_TEST_API_KEY='fixture';process.env.DOCUSEAL_MODE='test';
const input={accountId:'account',userId:'user',customerEmail:'customer@example.invalid',dealId:'deal',kind:'purchase',signers:[{name:'Fixture seller',email:'seller@example.invalid'}],autoSignature:'Fixture signature'};
try{
 await sendForSignatures(input);assert.equal(providerWrites,1);
 records=[];providerWrites=0;terms={...terms,earnestCents:null};
 await sendForSignatures(input);assert.equal(providerWrites,1,'missing seller EMD does not block signing');
 records=[];providerWrites=0;terms={...terms,legalDescription:''};
 await assert.rejects(()=>sendForSignatures(input),/legal description/);
 assert.equal(providerWrites,0);assert(!records.some(r=>r.path==='rpc/icash_begin_signing'));

 terms={...terms,legalDescription:'Fixture lot'};advanceBeforeSend=true;records=[];
 await assert.rejects(()=>sendForSignatures(input),/deadline has passed/);
 assert.equal(providerWrites,0,'deadline is checked again after the server claim, before provider dispatch');
 assert(!records.some(r=>r.path==='icash_signature_authorizations'),'no auto-sign authorization saved after final validation fails');
 assert(records.some(r=>r.method==='PATCH'&&r.body.state==='needs_review'));

 records=[];
 await assert.rejects(()=>refreshSigning('account','envelope'),/deadline has passed/);
 assert.equal(autoClaims,0,'expired agreement never claims automatic signature authority');
 assert.equal(providerWrites,0);
 await assert.rejects(()=>customerSigningLink('account','envelope','customer@example.invalid'),/deadline has passed/);
 assert.equal(providerWrites,0);
 now=Date.parse('2026-09-30T12:00:00Z');advanceAfterAutoClaim=true;
 await assert.rejects(()=>refreshSigning('account','envelope'),/deadline has passed/);
 assert.equal(autoClaims,1);assert.equal(providerWrites,0,'expiry after an authorization claim still prevents the final signature write');
 now=Date.parse('2026-09-30T12:00:00Z');advanceBeforeSend=false;advanceAfterAutoClaim=false;formProfile=originalContractProfile;records=[];providerWrites=0;
 await sendForSignatures({...input,autoSignature:undefined});assert.equal(providerWrites,1);
 assert(payload.submitters[0].fields.some(f=>f.name==='priceCents'&&f.default_value==='1000.00'));
 assert(payload.submitters[1].fields.some(f=>f.name==='buyerPrinted'&&f.default_value==='Fixture principal'));
 assert(!payload.submitters.flatMap(s=>s.fields).some(f=>/escrow|email|notes|consent/i.test(f.name)));
 assert.equal((await refreshSigning('account','envelope')).status,'customer_signature_needed','blank optional fields may be absent in provider readback');
 tamperPrice=true;await assert.rejects(()=>refreshSigning('account','envelope'),/field values need review/);
}finally{
 globalThis.fetch=oldFetch;Date.now=oldNow;
 if(oldKey===undefined)delete process.env.DOCUSEAL_TEST_API_KEY;else process.env.DOCUSEAL_TEST_API_KEY=oldKey;
 if(oldMode===undefined)delete process.env.DOCUSEAL_MODE;else process.env.DOCUSEAL_MODE=oldMode;
 delete globalThis.__signingValidationFixture;
}
console.log('Actual signing service: incomplete terms blocked before claim, expired deadline rechecked before send/auto-sign/link, no provider writes on failure. All fixtures.');
