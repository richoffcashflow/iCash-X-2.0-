import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {dealTermsSchema,renderDealDocument} from '../lib/deal-documents.ts';
import {originalContractProfile,originalContractValues,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import {signingDocumentReadiness,signingReadiness,signingFields,signingTermsHash} from '../lib/signing-policy.ts';
import {prepareOriginalContracts} from '../scripts/prepare-original-contracts.mjs';
const forms=JSON.parse(readFileSync(new URL('../config/signing-templates/owner-originals.json',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const terms=dealTermsSchema.parse({seller:'Fixture Seller',buyer:'Fixture Buyer LLC',assignee:'Fixture Investor LLC',address:'123 MAIN ST, DALLAS, TX 75215',legalDescription:'LOT 1 BLOCK 2',state:'TX',priceCents:4812800,priceSource:'seller_reported',closingDate:'2030-11-11',assignmentFeeCents:1000000,assignmentDepositCents:50000});
const legacy=dealTermsSchema.omit({county:true}).parse(terms);
assert.equal(signingTermsHash(terms),sha(JSON.stringify(legacy)),'adding optional county does not change issued envelope hashes');
assert(!Object.hasOwn(terms,'county'));
const values=originalContractValues(terms,'purchase');
assert.equal(values.street,'123 MAIN ST');assert.equal(values.city,'DALLAS');assert.equal(values.zip,'75215');assert.equal(values.county,'');
assert.equal(values.priceCents,'48128.00');assert.equal(values.closingDate,'11/11/2030');
assert.equal(originalContractValues({...terms,county:'Dallas'},'purchase').county,'Dallas');
assert.equal(signingReadiness('assignment',terms,[{name:'Fixture Investor LLC',phone:'+12025550100'}],terms.buyer,'under_contract',Date.parse('2026-10-09'),originalContractProfile),true,'original deposit is direct to assignor, with no escrow blank');
assert.throws(()=>signingReadiness('assignment',terms,[{name:'Fixture Investor LLC',phone:'+12025550100'}],terms.buyer,'under_contract',Date.parse('2026-10-09')),/escrow/,'legacy agreements retain their original requirements');
assert.throws(()=>signingDocumentReadiness('purchase',{...terms,closingDate:''},Date.parse('2026-10-09'),originalContractProfile),/closing date/);
assert.equal(signingDocumentReadiness('assignment',{...terms,closingDate:'',effectiveDate:'2020-01-01'},Date.parse('2026-10-09'),originalContractProfile),true,'no invented 30-day clause');
for(const kind of ['purchase','assignment']){
 const form=forms[kind],bytes=readFileSync(new URL(`../public/contracts/owner-20261009/${kind}.pdf`,import.meta.url));
 assert.equal(sha(bytes),form.source.pdfSha256);assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 assert.equal(sha(Buffer.from(form.background.split(',')[1],'base64')),form.source.backgroundSha256);
 const fields=form.roles.flatMap(role=>originalContractFieldsForRole(kind,role,signingFields(terms,kind,false,originalContractProfile)));
 assert.equal(fields.length,Object.keys(form.fieldMap).length);assert.equal(new Set(fields.map(f=>f.name)).size,fields.length);
 assert(fields.every(f=>f.readonly===true));
 assert(!fields.some(f=>/escrow|email|notes|inspection|earnest|consent/i.test(f.name)));
 assert(!form.fields.some(f=>f.type==='checkbox'));
 assert(form.fields.every(f=>f.areas.every(a=>a.page===0&&a.x>=0&&a.y>=0&&a.x+a.w<=1&&a.y+a.h<=1)));
 assert.equal(form.fields.filter(f=>f.type==='signature'&&f.required).length,2);
 const html=renderDealDocument(kind,{...terms,dealNotes:'MUST NOT ADD A SECTION',escrowAgent:'MUST NOT ADD A CLOSER',titleEmail:'must-not-add@example.invalid'});
 assert(!html.includes('MUST NOT ADD'));assert(!html.includes('must-not-add@example.invalid'));
}
const env={VERCEL_ENV:'production',ICASH_DIRECT_CALLS_PREPARE:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SECRET_KEY:'fixture',DOCUSEAL_API_KEY:'live-fixture',DOCUSEAL_TEST_API_KEY:'test-fixture'};
for(const scenario of ['ok','unknown_create','bad_field']){
 const tasks=new Map(['test','live'].flatMap(mode=>['purchase','assignment'].map(kind=>[`icash-x-original-20261009-${mode}-${kind}-v1`,{state:'claimed',result:{ownerApproval:{approved:true,sourceSha256:forms[kind].source.sourceSha256}}}])));
 const templates=new Map();let creates=0,updates=0;
 const fetcher=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;
  assert(!/submissions|submitters/.test(u.pathname),'preparation must not send or sign');
  if(u.hostname==='db.invalid'){
   const row=tasks.get(u.searchParams.get('key').slice(3));assert(row);
   if(init.method==='PATCH'){if(u.searchParams.has('state')&&row.state!=='claimed')return Response.json([]);Object.assign(row,body);}
   return Response.json([row]);
  }
  assert.equal(u.hostname,'api.docuseal.com');
  if(init.method==='POST'){
   creates++;if(scenario==='unknown_create')throw Error('fixture network timeout');
   assert.equal(body.shared_link,false);assert.equal(body.documents.length,1);assert(!body.fields);
   assert.equal((await PDFDocument.load(Buffer.from(body.documents[0].file,'base64'))).getPageCount(),1);
   const template={id:creates,external_id:body.external_id,shared_link:false,name:body.name,schema:[{attachment_uuid:'page-'+creates}],documents:[{id:creates}],submitters:[],fields:[]};templates.set(creates,template);return Response.json(template);
  }
  const template=templates.get(Number(u.pathname.split('/').at(-1)));assert(template);
  if(init.method==='PUT'){updates++;Object.assign(template,body);if(scenario==='bad_field')template.fields[0].areas[0].x+=0.02;}
  return Response.json(template);
 };
 if(scenario==='ok'){
  assert.equal((await prepareOriginalContracts(env,fetcher)).templates.length,4);assert.equal(creates,4);assert.equal(updates,4);
  await prepareOriginalContracts(env,fetcher);assert.equal(creates,4);assert.equal(updates,4,'a rebuild never rewrites existing templates');
  assert([...tasks.values()].every(t=>t.state==='created'&&t.result.fieldValidation&&t.result.productionEnabled===false));
 }else{
  await assert.rejects(prepareOriginalContracts(env,fetcher),scenario==='unknown_create'?/timeout/:/FIELDS_UNCONFIRMED/);
  if(scenario==='unknown_create')await assert.rejects(prepareOriginalContracts(env,fetcher),/CREATE_OUTCOME_UNKNOWN/);
  assert.equal(creates,1,'unknown outcomes must never create duplicate templates');
 }
}
assert.equal((await prepareOriginalContracts({...env,VERCEL_ENV:'preview'},()=>{throw Error('network forbidden');})).status,'not_requested');
console.log('PASS exact original pages, price/address mapping, no added terms, unchanged legacy hashes, required signatures, provider coordinates and idempotent template preparation.');
