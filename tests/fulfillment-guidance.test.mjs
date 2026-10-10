import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
const accountId='00000000-0000-4000-8000-000000000001',dealId='00000000-0000-4000-8000-000000000002';
let owned=true,held=true;const calls=[];
const {GET}=await loadService('app/api/work/fulfillment/route.ts',{
 NextResponse:{json:(data,init)=>Response.json(data,init)},workAccount:async()=>({accountId}),
 db:async(path,method='GET',body)=>{
  calls.push({path,method,body});
  if(path.startsWith('icash_deal_files?')){assert(path.includes(`account_id=eq.${accountId}`));assert(path.includes(`id=eq.${dealId}`));return owned?[{id:dealId,stage:'under_contract',terms:{state:'TX'}}]:[];}
  if(path==='rpc/icash_buyer_outreach_held'){assert.equal(method,'POST');assert.deepEqual(body,{p_account:accountId,p_deal:dealId});return held;}
  if(path==='rpc/icash_buyer_package_data')return null;
  assert.equal(method,'GET','loading guidance never changes work controls or sends messages');return [];
 }
});
for(const hold of [true,false]){held=hold;calls.length=0;const response=await GET(new Request(`https://example.test/api/work/fulfillment?dealId=${dealId}`));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);const data=await response.json();assert.equal(data.dealStage,'under_contract');assert.equal(data.buyerOutreachHeld,hold);assert.equal(calls.filter(c=>c.path==='rpc/icash_buyer_outreach_held').length,1);}
owned=false;calls.length=0;assert.equal((await GET(new Request(`https://example.test/api/work/fulfillment?dealId=${dealId}`))).status,404);assert.equal(calls.length,1,'ownership is checked before title, buyers or hold status can be read');
calls.length=0;assert.equal((await GET(new Request('https://example.test/api/work/fulfillment?dealId=invalid'))).status,400);assert.equal(calls.length,0);
console.log('Fulfillment guidance: authenticated deal ownership, current hold state and private response passed. Fixture database only.');
