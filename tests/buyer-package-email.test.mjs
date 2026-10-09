process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {dealTermsSchema} from '../lib/deal-documents.ts';
let stage='under_contract',paused=false,manual=false,signed=true,prior=[],writes=[],sends=0;
const terms=dealTermsSchema.parse({address:'Fixture only',priceCents:10000000,assignmentFeeCents:2000000});
const db=async(path,method,body)=>{
 if(path.startsWith('icash_accounts'))return [{owner_user_id:'owner',bot_paused:paused}];
 if(path.startsWith('icash_deal_files'))return [{terms,stage,screening_id:'screen'}];
 if(path.startsWith('icash_disposition_authorities'))return [{purchase_envelope_id:'purchase',asking_price_cents:12000000,expires_at:'2099-01-01'}];
 if(path==='rpc/icash_ensure_buyer_package')return {url:'https://www.geticashx.com/d/'+'a'.repeat(32)};
 if(path==='rpc/icash_deal_email_contacts')return [{contact_key:'buyer-request:request',party:'buyer',email:'fixture@example.invalid'},{contact_key:'signer:other',party:'buyer',email:'other@example.invalid'}];
 if(path.startsWith('icash_operation_rates'))return [{id:'rate'}];
 if(path.startsWith('icash_signing_envelopes'))return signed?[{id:'purchase'}]:[];
 if(path.startsWith('icash_screening_jobs'))return [{snapshot:{propertyId:'prop_1'}}];
 if(path.startsWith('icash_property_controls'))return manual?[{}]:[];
 if(path.startsWith('icash_deal_emails'))return prior;
 if(path==='rpc/icash_queue_deal_email'){writes.push(body);return 'email';}
 throw Error(path);
};
globalThis.__package={createHash,db,dealEmailConfigured:()=>true,dispatchDealEmail:async()=>{sends++;return {status:'email_accepted'};},dealTermsSchema};
let source=ts.transpileModule(readFileSync('lib/buyer-package-email.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {sendRequestedBuyerPackages}=await import('data:text/javascript;base64,'+Buffer.from('const {createHash,db,dealEmailConfigured,dispatchDealEmail,dealTermsSchema}=globalThis.__package;\n'+source).toString('base64'));
assert.equal((await sendRequestedBuyerPackages('account','deal')).accepted,1);assert.equal(sends,1);
assert.match(writes[0].p_body,/\$120,000.00/);assert(!/Underlying purchase price|Assignment fee:|\$100,000|\$20,000/.test(writes[0].p_body));assert.equal(writes[0].p_contact,'buyer-request:request');
prior=[{id:'email',state:'accepted'}];await sendRequestedBuyerPackages('account','deal');assert.equal(sends,1);
prior=[{id:'email',state:'needs_review'}];await sendRequestedBuyerPackages('account','deal');assert.equal(sends,1);
prior=[];paused=true;await sendRequestedBuyerPackages('account','deal');assert.equal(sends,1);
paused=false;manual=true;await sendRequestedBuyerPackages('account','deal');assert.equal(sends,1);
manual=false;signed=false;await sendRequestedBuyerPackages('account','deal');assert.equal(sends,1);
delete globalThis.__package;
console.log('Requested buyer packages: exact deal/prices, explicit request, no duplicate, uncertain-delivery hold, pause/takeover and signed-contract checks passed. No email sent.');

// Title milestones do not invalidate the same signed purchase and requested package.
paused=false;manual=false;signed=true;prior=[];
for(stage of ['title_open','closing'])assert.equal((await sendRequestedBuyerPackages('account','deal')).accepted,1);
for(stage of ['draft','closed','cancelled'])assert.equal((await sendRequestedBuyerPackages('account','deal')).accepted,0);
