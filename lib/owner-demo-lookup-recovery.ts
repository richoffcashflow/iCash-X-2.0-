import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {optinCallNowVersion} from './optin-call-now.ts';
import {processSellerIntake,type SellerDb} from './seller-pipeline.ts';

type PendingRequest={lead_id:string;requested_at:string;expires_at:string};
/** Give one original fresh owner request a targeted maintenance attempt before
 * the generic backlog. Selection never grants admission: the ordinary lookup
 * and atomic headroom claim retain all quota, source and spending decisions. */
export async function recoverPendingOwnerDemoLookup(db:SellerDb,key:string|undefined,transport:typeof fetch=fetch){
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const now=Date.now(),stamp=new Date(now).toISOString();
 const query=new URLSearchParams({
  select:'lead_id,requested_at,expires_at,intake:icash_seller_intakes!inner(id)',
  account_id:'eq.'+ownerInboundTarget.accountId,requested_by:'eq.'+ownerInboundTarget.ownerUserId,
  phone:'eq.'+ownerInboundTarget.ownerPhone,source:'eq.demo_form',request_version:'eq.'+optinCallNowVersion,
  request_reference:'eq.'+optinCallNowVersion,requested_at:'lte.'+stamp,expires_at:'gt.'+stamp,
  'intake.state':'eq.received','intake.claim_token':'is.null','intake.claimed_at':'is.null',
  'intake.canonical_id':'is.null','intake.contact_consent_scope':'eq.icash_x_demo',
  'intake.phone':'eq.'+ownerInboundTarget.ownerPhone,
  'intake.attribution->>demoAccountId':'eq.'+ownerInboundTarget.accountId,
  order:'requested_at.asc,lead_id.asc',limit:'1',
 });
 query.append('requested_at','gt.'+new Date(now-300000).toISOString());
 const [request]=await db<PendingRequest[]>('icash_optin_call_requests?'+query);
 if(!request||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.lead_id))return {status:'owner_demo_recovery_idle'};
 // A delayed read cannot extend the five-minute request. The headroom claim
 // and final call admission recheck the original receipt after their locks;
 // ordinary lookup retains its normal source, quota and spending admission.
 const requested=Date.parse(request.requested_at),expires=Date.parse(request.expires_at),current=Date.now();
 if(!Number.isFinite(requested)||expires!==requested+300000||requested>current||expires<=current)return {status:'owner_demo_recovery_idle'};
 const result=await processSellerIntake(db,key,transport,request.lead_id);
 return {...result,...(result.status==='property_checked'?{leadId:request.lead_id}:{})};
}
