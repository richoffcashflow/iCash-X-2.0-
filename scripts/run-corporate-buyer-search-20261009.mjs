// Owner-requested search of corporate owners for this signed property only.
// Uses the normal funded search claim. Never calls or messages a prospect.
import {db} from '../lib/stripe-test.ts';
import {discoverBuyersForDeal} from '../lib/buyer-discovery-service.ts';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>=Date.parse('2026-10-10T00:00:00Z'))process.exit(0);
const account='48dfb798-8c1a-404f-88c0-c396cc067062',deal='f50f5183-9b83-4cb3-b099-76f246e7ac9b',provider='buyer_corporate_search_20261009';
try{
 if((await db(`icash_integration_checks?provider=eq.${provider}&select=provider`)).length)process.exit(0);
 if(await db('rpc/icash_buyer_outreach_held','POST',{p_account:account,p_deal:deal})!==true)throw Error('OWNER_TEST_HOLD_REQUIRED');
 // Consume the one-time run before network activity, even on an ambiguous error.
 await db('icash_integration_checks','POST',{provider,checked_at:new Date().toISOString(),result:{status:'started',accountId:account,dealId:deal,outreach:false}});
 let result;
 try{result=await discoverBuyersForDeal(account,deal);}
 catch(error){result={status:'needs_review',code:error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?error.message:'SEARCH_UNCONFIRMED',canContinue:false};}
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{...result,accountId:account,dealId:deal,outreach:false}});
 console.log('Requested corporate-owner search:',result.status);
}catch{console.log('Requested corporate-owner search requires review; no automatic retry.');}
