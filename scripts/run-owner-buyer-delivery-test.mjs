// A single owner-authorized delivery test, with real application send claims,
// transports and receipts. No credentials or recipient details are logged.
import {db} from '../lib/stripe-test.ts';
import {dispatchTextMessage} from '../lib/text-message-service.ts';
import {dispatchDealEmail} from '../lib/deal-email-service.ts';
export async function runOwnerBuyerDeliveryTest(){
 if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>=Date.parse('2026-10-10T00:00:00Z'))return;
 const account='48dfb798-8c1a-404f-88c0-c396cc067062',deal='f50f5183-9b83-4cb3-b099-76f246e7ac9b';
 const [run]=await db(`icash_owner_buyer_tests?account_id=eq.${account}&deal_id=eq.${deal}&revoked_at=is.null&expires_at=gt.${new Date().toISOString()}&select=id,owner_user_id,thread_id,email_rate_id,send_email&limit=1`);
 if(!run)return;
 const [prior]=await db(`icash_text_messages?account_id=eq.${account}&thread_id=eq.${run.thread_id}&direction=eq.outgoing&state=eq.needs_review&select=id,provider_id&limit=1`);
 if(prior?.provider_id){
  // Inspect the failed attempt without retrying or rotating its sender.
  const [thread]=await db(`icash_text_threads?id=eq.${run.thread_id}&account_id=eq.${account}&select=sender,recipient`);
  if(thread?.recipient!=='+12142185280')throw Error('TEST_RECIPIENT_CHANGED');
  const read=async path=>{
   const r=await fetch('https://api.contiguity.com'+path,{headers:{Authorization:'Token '+process.env.CONTIGUITY_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('PROVIDER_READ_'+r.status);return r.json();
  };
  const [history,leases]=await Promise.all([read('/conversations/history/message/'+encodeURIComponent(prior.provider_id)),read('/numbers/leased')]);
  const p=history.data??{},line=leases.data?.numbers?.find(n=>n.number?.e164===thread.sender);
  const result={messageId:prior.id,providerStatus:p.status,fromMatches:p.from===thread.sender,toMatches:p.to===thread.recipient,
   tracking:(Array.isArray(p.tracking)?p.tracking:[]).slice(-12).map(x=>({event:x.event,timestamp:x.timestamp,title:typeof x.title==='string'?x.title.slice(0,250):undefined})),
   line:{found:!!line,status:line?.lease_status,channels:line?.capabilities?.channels}};
  const provider='owner_buyer_delivery_20261009';
  const existing=await db(`icash_integration_checks?provider=eq.${provider}&select=provider`);
  await db(existing.length?`icash_integration_checks?provider=eq.${provider}`:'icash_integration_checks',existing.length?'PATCH':'POST',{provider,checked_at:new Date().toISOString(),result});
  console.log('Owner buyer SMS failure inspection saved. No retry.');
 }
 const content=await db('rpc/icash_owner_buyer_test_content','POST',{p_id:run.id});
 if(!content){console.log('Owner buyer test is held or expired. No message sent.');return;}
 const message=await db('rpc/icash_queue_buyer_package_text','POST',{p_account:account,p_thread:run.thread_id,p_body:content.sms});
 if(!message)throw Error('TEST_MESSAGE_REQUIRED');
 console.log('Owner buyer SMS test:',(await dispatchTextMessage(account,message)).status);
 if(run.send_email){
  const email=await db('rpc/icash_queue_deal_email','POST',{p_account:account,p_actor:run.owner_user_id,p_deal:deal,p_contact:'owner-buyer-test:'+run.id,p_key:run.id,p_subject:content.subject,p_body:content.email,p_rate:run.email_rate_id});
  if(!email)throw Error('TEST_EMAIL_REQUIRED');
  console.log('Owner buyer email test:',(await dispatchDealEmail(account,email)).status);
 }
}
if(process.argv[1]?.endsWith('/run-owner-buyer-delivery-test.mjs')){
 try{await runOwnerBuyerDeliveryTest();}
 catch{console.error('Owner buyer delivery test requires review. Existing sends will not be retried.');}
}
