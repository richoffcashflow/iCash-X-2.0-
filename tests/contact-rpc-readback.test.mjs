import assert from 'node:assert/strict';
import {checkContactRpcs} from '../scripts/check-contact-rpcs.mjs';
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',phone='+12025550101';
const env={VERCEL_ENV:'production',SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'fixture-secret'};
let failed=false;const paths=[];
const fetcher=async(url,options)=>{
 const path=new URL(url).pathname.split('/rest/v1/')[1],body=options.body?JSON.parse(options.body):null;paths.push(path);
 assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
 assert(options.signal instanceof AbortSignal);
 if(path.startsWith('rpc/')){
  assert.equal(options.method,'POST');assert.equal(body.p_account,account);
  if(path!=='rpc/icash_manual_text_reason')assert.equal(body.p_screening,screen);
  if(path==='rpc/icash_manual_contacts')return new Response(JSON.stringify(failed?{code:'25006',message:'private details'}:[{phone,blocked:false}]),{status:failed?405:200});
  if(path==='rpc/icash_customer_call_sender')return new Response(JSON.stringify('+12025550199'));
  if(['rpc/icash_manual_contact_reason','rpc/icash_manual_text_reason'].includes(path))return new Response('null');
  throw Error('Unexpected RPC or mutation '+path);
 }
 assert.equal(options.method,'GET');
 const tables={icash_screening_jobs:[{id:screen,account_id:account}],icash_call_recordings:[],icash_customer_phone_calls:[],icash_deal_files:[{id:screen}],icash_text_threads:[{id:screen,sender:'+12025550199'}]};
 assert(Object.hasOwn(tables,path),'Unexpected table '+path);
 if(path!=='icash_screening_jobs')assert.equal(new URL(url).searchParams.get('account_id'),'eq.'+account);
 return new Response(JSON.stringify(tables[path]));
};
const result=await checkContactRpcs({env,fetcher});assert.equal(result.status,'passed');assert.equal(result.checked.length,1);
assert(!JSON.stringify(result).includes(screen));assert(!JSON.stringify(result).includes(phone));
for(const endpoint of ['icash_manual_contacts','icash_manual_contact_reason','icash_customer_call_sender','icash_manual_text_reason'])assert(paths.includes('rpc/'+endpoint));
failed=true;await assert.rejects(checkContactRpcs({env,fetcher}),error=>error.message==='Contact API verification failed: rpc/icash_manual_contacts HTTP 405');
const noRequests=()=>{throw Error('No database or provider calls outside production');};
assert.equal((await checkContactRpcs({env:{VERCEL_ENV:'preview'},fetcher:noRequests})).status,'not_requested');
assert.equal((await checkContactRpcs({env:{},fetcher:noRequests})).status,'not_requested');
console.log('PASS contact API readback: real RPC paths, account scope, bounded read-only requests, HTTP failure blocks release, no customer data in output.');
