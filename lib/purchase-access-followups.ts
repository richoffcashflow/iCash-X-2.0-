import {purchaseAccessMessage,purchaseEmailReady} from './purchase-access-email.ts';
type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Environment=Record<string,string|undefined>;
type Claim={id:string;claimToken:string;membershipId:string;recipient:string;channel:'email'|'sms';sender:string|null;vip:boolean;message:Record<string,unknown>|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const phone=/^\+[1-9]\d{7,14}$/;
export function purchaseAccessFollowupMessage(job:Claim):Record<string,unknown>{
 if(!uuid.test(job.id)||!uuid.test(job.membershipId))throw Error('Invalid purchase follow-up');
 if(job.channel==='email'){
  const message=purchaseAccessMessage({...job,message:null},true);
  return {...message,tags:[{name:'icash_access_followup_id',value:job.id}]};
 }
 if(!job.sender||!phone.test(job.sender)||!phone.test(job.recipient))throw Error('Invalid purchase text');
 return {from:job.sender,to:job.recipient,message:'iCash X login: https://www.geticashx.com/access Use your checkout email. Need help? Choose Use my checkout phone. Reply STOP to opt out.',attachments:[],fast_track:false};
}

/** One reminder email and one permission-bound text per first payment. */
export async function processPurchaseAccessFollowups({db,env=process.env,transport=fetch,membershipId,limit=3}:{db:Database;env?:Environment;transport?:typeof fetch;membershipId?:string;limit?:number}){
 const emailReady=purchaseEmailReady(env),smsReady=env.VERCEL_ENV==='production'&&!!env.CONTIGUITY_API_KEY&&!!env.CONTIGUITY_WEBHOOK_SECRET;
 if(membershipId&&!uuid.test(membershipId))throw Error('Invalid membership');
 const results=await Promise.allSettled((['email','sms'] as const).map(async channel=>{
  let accepted=0,failed=0;
  if(!(channel==='email'?emailReady:smsReady))return {accepted,failed};
  for(let count=0;count<Math.min(5,limit);count++){
   const job=await db<Claim|null>('rpc/icash_claim_purchase_access_followup','POST',{p_channel:channel,p_membership:membershipId??null});
   if(!job)break;
   if(!uuid.test(job.id)||!uuid.test(job.claimToken)||job.channel!==channel)throw Error('Invalid purchase follow-up claim');
   let dispatched=false,retry=true,provider:string|null=null;
   try{
    const message=await db<Record<string,unknown>|null>('rpc/icash_authorize_purchase_access_followup','POST',{p_id:job.id,p_claim:job.claimToken,p_message:job.message??purchaseAccessFollowupMessage(job)});
    if(!message)continue;
    dispatched=true;
    const email=channel==='email';
    const response=await transport(email?'https://api.resend.com/emails':'https://api.contiguity.com/send/text',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:email?`Bearer ${env.RESEND_API_KEY}`:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json',...(email?{'Idempotency-Key':`purchase-access-followup-${job.id}`}:{})},body:JSON.stringify(message)});
    retry=response.status===429||response.status>=500||response.status===409;
    if(!response.ok)throw Error('Purchase message not accepted');
    retry=true;
    const receipt=await response.json(),id=email?receipt.id:receipt.data?.message_id;
    if(typeof id!=='string'||!id||id.length>200||email&&!uuid.test(id))throw Error('Missing purchase receipt');
    provider=id;
    await db('rpc/icash_finish_purchase_access_followup','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:provider});accepted++;
   }catch{
    failed++;
    // A known receipt can be saved again, but a text is never sent twice.
    // Unknown SMS outcomes stop here; only email has provider idempotency.
    try{await db('rpc/icash_finish_purchase_access_followup','POST',{p_id:job.id,p_claim:job.claimToken,p_provider:provider,p_outcome:channel==='sms'?(dispatched&&retry?'unknown':'failed'):retry?'retry':'failed'});}catch{/* The durable lease survives; SMS attempts are never replayed. */}
   }
  }
  return {accepted,failed};
 }));
 const counts=results.map(r=>r.status==='fulfilled'?r.value:{accepted:0,failed:1});
 return {ready:emailReady&&smsReady,emailReady,smsReady,accepted:counts.reduce((n,c)=>n+c.accepted,0),failed:counts.reduce((n,c)=>n+c.failed,0)};
}
