import {after} from 'next/server';
import {recordSoftwareAccess} from '@/lib/purchase-acceptance';
import {resolveRequestedPropertyMarket} from '@/lib/requested-property-market';
import {discoveryAccountReadiness,contactAccountReadiness} from '@/lib/discovery-channel-readiness';
import {smsAccountReady} from '@/lib/sms-channel-readiness';
import {liveWorkReady} from '@/lib/live-work-admission';
import {launchReadiness} from '@/lib/launch-readiness';
import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {db} from '@/lib/stripe-test';
import {accountMode} from '@/lib/account-mode';
import {membershipAccessible} from '@/lib/membership-policy';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {workspaceAcknowledgmentCurrent,type WorkspaceAcknowledgmentRecord} from '@/lib/workspace-acknowledgment';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Snapshot={accountId:string;account:{billingModel:string;membership:{state:string;paid_through:string|null}|null;balanceCents:number;billingReview:boolean;[key:string]:unknown}};
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'},started=Date.now();let stage='authentication';
 try{
  const mode=accountMode(),user=await currentUser(true);
  if(!user||!mode)return NextResponse.json({signedIn:false,signInReady:process.env.ICASH_AUTH_EMAIL_READY==='true'},{headers});
  stage='account_snapshot';
  const snapshot=await db<Snapshot>('rpc/icash_load_workspace_account','POST',{p_user:user.id,p_mode:mode});
  if(!snapshot?.accountId||!snapshot.account||!Number.isSafeInteger(snapshot.account.balanceCents))throw Error('Invalid account snapshot');
  const {membership,...account}=snapshot.account;
  const membershipActive=membershipAccessible(membership);
  const [access,acknowledgments]=await Promise.all([
   db<{vip:boolean;vipFeatures:boolean;adminPlan:'standard'|'vip'|null}>('rpc/icash_workspace_vip_access','POST',{p_account:snapshot.accountId}),
   db<WorkspaceAcknowledgmentRecord[]>(`icash_accounts?id=eq.${snapshot.accountId}&owner_user_id=eq.${user.id}&select=workspace_ack_version,workspace_ack_user_id,workspace_ack_hash&limit=1`)
  ]);
  const workspaceAcknowledged=!!acknowledgments[0]&&workspaceAcknowledgmentCurrent(acknowledgments[0],user.id);
  const base={...account,...access,workspaceAcknowledged,signedIn:true,mode,email:user.email,pendingEmail:user.new_email&&user.new_email!==user.email?user.new_email:null,membershipActive,isBillingOwner:user.id===ownerInboundTarget.ownerUserId};
  const canCheck=workspaceAcknowledged&&mode==='live'&&account.balanceCents>0&&!account.billingReview&&(account.billingModel!=='membership_credits'||membershipActive);
  const core=req&&new URL(req.url).searchParams.get('view')==='core';
  const held={workReady:false,smsWorkReady:false,discoveryWorkReady:false,contactWorkReady:false,discoveryQuote:null,contactQuote:null,discoveryBlocker:account.balanceCents<=0?'available_credits_required':null};
  if(core&&workspaceAcknowledged&&mode==='live'&&membershipActive)after(()=>recordSoftwareAccess(req,snapshot.accountId,user.id));
  // The page paints its verified account first. Provider/setup checks are a later request.
  if(core||!canCheck)return NextResponse.json({...base,...held,readinessPending:!!core&&canCheck},{headers});
  stage='work_readiness';
  await resolveRequestedPropertyMarket(snapshot.accountId,user.id);
  const readChecks=()=>Promise.all([
   launchReadiness(snapshot.accountId),smsAccountReady(snapshot.accountId,user.id),
   discoveryAccountReadiness(snapshot.accountId,user.id),contactAccountReadiness(snapshot.accountId,user.id)
  ]);
  let [readiness,smsReady,discovery,contacts]=await readChecks();
  // Funding is retained if its setup trigger fails. Retry missing setup once on
  // the authenticated readiness request, including nationwide/inbound accounts.
  // Existing disabled/expired configurations are operator decisions, not gaps.
  try{
   const missingDiscovery=discovery.reason==='discovery_configuration_required';
   const missingVoice=!missingDiscovery&&readiness.blockers?.includes('voice')&&!(await db<{account_id:string}[]>(`icash_voice_configs?account_id=eq.${snapshot.accountId}&select=account_id&limit=1`)).length;
   if(missingDiscovery||missingVoice){
    await db('rpc/icash_provision_funded_account','POST',{p_account:snapshot.accountId});
    [readiness,smsReady,discovery,contacts]=await readChecks();
   }
  }catch{console.warn('[account-setup-recovery]',{status:'pending'});}
  return NextResponse.json({...base,readinessPending:false,workReady:liveWorkReady()&&readiness.ready,smsWorkReady:smsReady,discoveryWorkReady:discovery.ready,contactWorkReady:contacts.ready,discoveryQuote:discovery.quote,contactQuote:contacts.quote,discoveryBlocker:discovery.ready?null:discovery.reason??'readiness_unavailable'},{headers});
 }catch(error){
  console.error('[account-load]',{stage,elapsedMs:Date.now()-started,error:error instanceof Error?error.name:'UnknownError'});
  return NextResponse.json({error:'Your account is temporarily unavailable. Please retry.'},{status:503,headers});
 }
}
