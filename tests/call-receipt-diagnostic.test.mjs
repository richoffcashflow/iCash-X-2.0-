import assert from 'node:assert/strict';
import {checkCallReceipts} from '../scripts/check-call-receipts-20261023.mjs';
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEY:'fixture-database-secret',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'fixture-carrier-secret-value'};
const row={id:'fixture-call',parent_sid:'CA'+'b'.repeat(32),provider_account_sid:env.TWILIO_ACCOUNT_SID,business_phone:'+12025550101',callback_phone:'client:fixture',state:'failed'},now=Date.parse('2026-10-23T18:00:00Z');
const calls=[],saves=[];
const fetcher=async(url,options)=>{
 calls.push(url);
 if(url.startsWith('https://api.twilio.com/')){assert.equal(options.method,'GET');return Response.json({sid:row.parent_sid,account_sid:row.provider_account_sid,from:row.business_phone,to:row.callback_phone,direction:'outbound-api',status:'completed',price:null,price_unit:null,duration:'12'});}
 if(url.includes('icash_customer_phone_calls?'))return Response.json([row]);
 assert(url.includes('icash_integration_checks?'));
 if(options.method==='POST'){saves.push(JSON.parse(options.body));return new Response(null,{status:204});}
 return Response.json([]);
};
assert.deepEqual(await checkCallReceipts(env,fetcher,now),{status:'checked',count:1});
assert.equal(saves[0].result.calls[0].price,null,'A missing price is not zero');
for(const privateValue of [env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY,row.business_phone,row.callback_phone,row.parent_sid])assert(!JSON.stringify(saves).includes(privateValue));
for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_GIT_COMMIT_REF:'feature'}])assert.equal((await checkCallReceipts({...env,...patch},()=>assert.fail('No requests'),now)).status,'not_requested');
assert.equal((await checkCallReceipts(env,()=>assert.fail('Expired diagnostic'),Date.parse('2026-10-26T00:00:00Z'))).status,'not_requested');
assert.equal((await checkCallReceipts(env,async()=>Response.json([{checked_at:'saved'}]),now)).status,'already_checked');
console.log('Call receipt diagnostic: production/expiry/idempotency gates, bounded existing GETs, no contact or financial mutations, and private-field exclusions passed.');
