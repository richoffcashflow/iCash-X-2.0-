import Stripe from 'stripe';
import {pathToFileURL} from 'node:url';
import {summarizeDispute} from '../lib/disputes.ts';
export const disputeEvents=['charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'];
export async function prepareDisputeWebhooks(env=process.env,createStripe=key=>new Stripe(key,{maxNetworkRetries:1,timeout:10000})){
 const production=env.VERCEL_ENV==='production'&&(!env.VERCEL_TARGET_ENV||env.VERCEL_TARGET_ENV==='production')&&env.VERCEL_GIT_COMMIT_REF==='main';
 if(!production)return {status:'skipped'};
 if(!/^sk_live_/.test(env.STRIPE_SECRET_KEY??''))throw Error('LIVE_STRIPE_REQUIRED');
 const stripe=createStripe(env.STRIPE_SECRET_KEY),listed=await stripe.webhookEndpoints.list({limit:100});
 if(listed.has_more)throw Error('WEBHOOK_LIST_INCOMPLETE');
 const matches=listed.data.filter(e=>e.livemode&&e.status==='enabled'&&['https://www.geticashx.com/api/webhooks/stripe','https://geticashx.com/api/webhooks/stripe'].includes(e.url));
 if(!matches.length)throw Error('ICASH_WEBHOOK_NOT_FOUND');
 for(const endpoint of matches){
  if(endpoint.enabled_events.includes('*')||disputeEvents.every(e=>endpoint.enabled_events.includes(e)))continue;
  await stripe.webhookEndpoints.update(endpoint.id,{enabled_events:[...new Set([...endpoint.enabled_events,...disputeEvents])]});
  const confirmed=await stripe.webhookEndpoints.retrieve(endpoint.id);
  if(confirmed.url!==endpoint.url||!confirmed.livemode||confirmed.status!=='enabled'||!disputeEvents.every(e=>confirmed.enabled_events.includes(e)))throw Error('DISPUTE_WEBHOOK_NOT_CONFIRMED');
 }
 // Read actual response shapes without logging payment or customer records.
 const disputes=await stripe.disputes.list({limit:50});
 for(const dispute of disputes.data){if(!dispute.livemode)throw Error('DISPUTE_MODE_MISMATCH');summarizeDispute(dispute);}
 // This is a read-only check; do not change a shared account's public branding or paid Radar plan.
 let descriptor='unavailable';try{const account=await stripe.accounts.retrieve();descriptor=account.settings?.payments?.statement_descriptor??'not configured';}catch{}
 return {status:'ready',endpointCount:matches.length,statementDescriptor:descriptor,disputeRead:'verified'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Stripe dispute delivery: '+JSON.stringify(await prepareDisputeWebhooks()));}
 catch(error){console.error('Stripe dispute delivery: '+(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'SETUP_FAILED'));process.exitCode=1;}
}
