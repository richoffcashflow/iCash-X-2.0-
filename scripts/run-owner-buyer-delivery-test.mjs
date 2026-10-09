// A single owner-authorized delivery test, with real application send claims,
// transports and receipts. No credentials or recipient details are logged.
import {db} from '../lib/stripe-test.ts';
import {dispatchTextMessage} from '../lib/text-message-service.ts';
import {dispatchDealEmail} from '../lib/deal-email-service.ts';
export async function runOwnerBuyerDeliveryTest(){
 if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>=Date.parse('2026-10-10T00:00:00Z'))return;
 const account='48dfb798-8c1a-404f-88c0-c396cc067062',deal='f50f5183-9b83-4cb3-b099-76f246e7ac9b';
 const [run]=await db(`icash_owner_buyer_tests?account_id=eq.${account}&deal_id=eq.${deal}&revoked_at=is.null&expires_at=gt.${new Date().toISOString()}&select=id,owner_user_id,thread_id,email_rate_id&limit=1`);
 if(!run)return;
 const content=await db('rpc/icash_owner_buyer_test_content','POST',{p_id:run.id});
 if(!content)throw Error('TEST_SCOPE_NOT_CURRENT');
 const message=await db('rpc/icash_queue_buyer_package_text','POST',{p_account:account,p_thread:run.thread_id,p_body:content.sms});
 const email=await db('rpc/icash_queue_deal_email','POST',{p_account:account,p_actor:run.owner_user_id,p_deal:deal,p_contact:'owner-buyer-test:'+run.id,p_key:run.id,p_subject:content.subject,p_body:content.email,p_rate:run.email_rate_id});
 if(!message||!email)throw Error('TEST_MESSAGE_REQUIRED');
 console.log('Owner buyer SMS test:',(await dispatchTextMessage(account,message)).status);
 console.log('Owner buyer email test:',(await dispatchDealEmail(account,email)).status);
}
if(process.argv[1]?.endsWith('/run-owner-buyer-delivery-test.mjs')){
 try{await runOwnerBuyerDeliveryTest();}
 catch{console.error('Owner buyer delivery test requires review. Existing sends will not be retried.');process.exitCode=1;}
}
