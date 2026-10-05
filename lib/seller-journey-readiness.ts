type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type JourneyCheck={key:string;label:string;status:'configured'|'blocked'|'unverified';detail:string};
export async function sellerJourneyReadiness(db:Database,env:Record<string,string|undefined>){
 const [summary]=await db<{processing_enabled:boolean;allowance_available:boolean;markets:number;active_accounts:number;senders:number;voice_accounts:number;pending_responses:number;held_responses:number;started_responses:number}[]>('rpc/icash_seller_response_readiness','POST',{});
 if(!summary)throw Error('Journey status unavailable');
 const checks:JourneyCheck[]=[
  {key:'lookup',label:'Property research',status:summary.processing_enabled&&summary.allowance_available?'configured':'blocked',detail:summary.processing_enabled&&summary.allowance_available?'Automatic research for each submitted address, within the lookup allowance.':'Needs an available lookup allowance and current data-use configuration.'},
  {key:'assignment',label:'Lead delivery',status:summary.active_accounts>0?'configured':'blocked',detail:summary.active_accounts>0?'Completed research goes directly to an eligible funded account at 3× its recorded cost basis. Up to three recipients.':'No active funded daily accounts.'},
  {key:'sms',label:'First text',status:summary.senders>0&&!!env.CONTIGUITY_API_KEY&&!!env.CONTIGUITY_WEBHOOK_SECRET?'configured':'blocked',detail:'A bound seller thread, recipient permission and available credits are checked before every send.'},
  {key:'voice',label:'First call',status:summary.voice_accounts>0&&env.ICASH_RECORDED_OUTBOUND_READY==='true'?'configured':'blocked',detail:summary.voice_accounts>0&&env.ICASH_RECORDED_OUTBOUND_READY==='true'?'Call configuration is present. A completed acceptance call is still required to verify the live path.':'Recorded outbound release and an enabled account voice configuration are required.'},
  {key:'signing',label:'Contract signing',status:'unverified',detail:'Templates and automated tests do not prove a completed provider signing. Run a test-mode envelope through both signers.'},
  {key:'closing',label:'Buyer to closing',status:'unverified',detail:'Buyer outreach requires an executed purchase and approved terms. Title and funding milestones require verified replies.'},
 ];
 return {checks,pending:summary.pending_responses,needsAttention:summary.held_responses,started:summary.started_responses};
}
