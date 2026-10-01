import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let screeningState='running',paths=[],fullReady=true,smsReady=false,discoveryReady=false,contactReady=false;
const mocks={contactAccountReadiness:async(account,user)=>{assert.equal(account,'account');assert.equal(user,'user');return {ready:contactReady,quote:contactReady?{chargeCents:174,maxContacts:25,costBasis:'planning_estimate'}:null};},discoveryAccountReadiness:async(account,user)=>{assert.equal(account,'account');assert.equal(user,'user');return {ready:discoveryReady,quote:discoveryReady?{chargeCents:84,maxProperties:5,costBasis:'planning_estimate'}:null};},liveWorkReady:()=>fullReady,smsAccountReady:async(account,user)=>{assert.equal(account,'account');assert.equal(user,'user');return smsReady;},launchReadiness:async()=>({ready:true}),accountMode:()=> 'live',currentUser:async()=>({id:'user',email:'fixture@example.invalid'}),NextResponse:{json:(body,options={})=>({body,status:options.status??200})},db:async(path,method,body)=>{
 paths.push(path);
 if(path==='rpc/icash_claim_funding')return 'account';
 if(path.startsWith('rpc/icash_funding_account_totals'))return {creditCents:1000,phone:null};
 if(path.startsWith('rpc/'))return null;
 if(path.startsWith('icash_accounts?'))return [{id:'account',assistant_name:'Scout',bot_paused:false,daily_limit_cents:1000}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture'}];
 if(path.startsWith('icash_wallets'))return [{balance_cents:1000,reserved_cents:200}];
 if(path.startsWith('icash_screening_jobs'))return path.includes(screeningState)?[{id:'job'}]:[];
 if(['icash_bot_setups','icash_billing_reviews','icash_live_conversations','icash_daily_plans'].some(t=>path.startsWith(t)))return [];
 throw Error('Unexpected '+path);
}};
globalThis.__accountActivity=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/account/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__accountActivity;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
for(const state of ['queued','running']){screeningState=state;const r=await GET();assert.equal(r.status,200);assert.equal(r.body.activeWork,true,state);assert.equal(r.body.balanceCents,800);}
screeningState='complete';const r=await GET();assert.equal(r.body.activeWork,false);assert(paths.some(p=>p.includes('state=in.(queued,running)')));
fullReady=false;smsReady=true;const sms=await GET();assert.equal(sms.body.workReady,false);assert.equal(sms.body.smsWorkReady,true);smsReady=false;assert.equal((await GET()).body.smsWorkReady,false);
discoveryReady=true;const discovery=await GET();assert.equal(discovery.body.workReady,false);assert.equal(discovery.body.smsWorkReady,false);assert.equal(discovery.body.discoveryWorkReady,true);assert.deepEqual(discovery.body.discoveryQuote,{chargeCents:84,maxProperties:5,costBasis:'planning_estimate'});
contactReady=true;const contacts=await GET();assert.equal(contacts.body.contactWorkReady,true);assert.equal(contacts.body.contactQuote.chargeCents,174);
delete globalThis.__accountActivity;
console.log('Account activity uses real queued/running screening states, completed work idle and net available balance.');
