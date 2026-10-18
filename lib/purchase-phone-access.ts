import {randomBytes,randomInt,randomUUID,createHash} from 'node:crypto';
export const phoneChallengeCookie='__Host-icash_phone_challenge';
export const phoneSessionCookie='__Host-icash_phone_session';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Auth=<T>(path:string,body?:unknown,access?:string,method?:'PUT')=>Promise<T>;
type Environment=Record<string,string|undefined>;
type Target={membershipId:string;email:string;phone:string;userId:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const accessHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function normalizeAccessPhone(value:unknown){
 if(typeof value!=='string'||value.length>40)return null;
 let phone=value.replace(/[ ()-]/g,'');if(/^\d{10}$/.test(phone))phone='+1'+phone;else if(/^1\d{10}$/.test(phone))phone='+'+phone;
 return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
}
export function phoneAccessReady(env:Environment=process.env){return env.VERCEL_ENV==='production'&&!!env.CONTIGUITY_API_KEY&&!!env.CONTIGUITY_WEBHOOK_SECRET;}
function challengeParts(value:string){const [id,secret]=value.split('.');if(!uuid.test(id??'')||!/^[a-f0-9]{64}$/.test(secret??''))throw Error('Request a new text code.');return {id,secret};}
/** Called only for an explicit request from the access form. Never retries a send. */
export async function requestPurchasePhoneCode({db,email,phone,priorChallenge,schedule,env=process.env,transport=fetch}:{db:Database;email:string;phone:string;priorChallenge?:string;schedule?:(task:()=>Promise<void>)=>void;env?:Environment;transport?:typeof fetch}){
 if(!phoneAccessReady(env))throw Error('Text sign-in is temporarily unavailable. Use email or contact support.');
 const id=randomUUID(),secret=randomBytes(32).toString('hex'),code=String(randomInt(10000000,100000000));
 const binding={p_id:id,p_secret_hash:accessHash(secret)};
 const job=await db<{id:string;phone:string;sender:string}|null>('rpc/icash_begin_phone_challenge_v2','POST',{...binding,p_email:email,p_phone:phone,p_code_hash:accessHash(secret+':'+code)});
 // A decoy cookie and identical response do not disclose which purchases exist.
 if(job){
  if(job.id!==id||job.phone!==phone||!normalizeAccessPhone(job.sender))throw Error('Text sign-in is temporarily unavailable.');
  const send=async()=>{if(await db<boolean>('rpc/icash_authorize_phone_challenge','POST',binding)){
   let receipt:string|null=null;
   try{
    const response=await transport('https://api.contiguity.com/send/text',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:job.sender,to:job.phone,message:`iCash X sign-in code: ${code}. Expires in 10 minutes. Do not share it. Reply STOP to opt out.`,attachments:[],fast_track:false})});
    if(!response.ok)throw Error('Provider unavailable');
    const result=await response.json();if(typeof result.data?.message_id!=='string'||!result.data.message_id||result.data.message_id.length>200)throw Error('Missing receipt');
    receipt=result.data.message_id;
   }catch{console.warn('[purchase-phone-code]',{outcome:'unknown'});}
   // Even an uncertain provider outcome keeps the code entry available.
   try{await db('rpc/icash_finish_phone_challenge','POST',{...binding,p_provider:receipt});}catch{console.warn('[purchase-phone-code]',{outcome:'receipt_pending'});}
  }};
  if(schedule)schedule(async()=>{try{await send();}catch{console.warn('[purchase-phone-code]',{outcome:'unavailable'});}});else await send();
 }
 let cookie=id+'.'+secret;
 if(!job&&priorChallenge){try{challengeParts(priorChallenge);cookie=priorChallenge;}catch{/* Keep the indistinguishable decoy cookie. */}}
 return {cookie};
}
export async function verifyPurchasePhoneCode({db,auth,challenge,code,email,phone}:{db:Database;auth:Auth;challenge:string;code:string;email:string;phone:string}){
 if(!/^\d{8}$/.test(code))throw Error('Enter the 8-digit code from your text.');
 const {id,secret}=challengeParts(challenge),binding={p_id:id,p_secret_hash:accessHash(secret)};
 const args={...binding,p_code_hash:accessHash(secret+':'+code)};
 let target=await db<Target|null>('rpc/icash_verify_phone_challenge','POST',args);
 // The verified challenge supplies the purchase identity. An optional email
 // typed before requesting SMS must not replace or override that saved identity.
 if(!target||!uuid.test(target.membershipId)||typeof target.email!=='string'||!target.email.includes('@')||target.phone!==phone||!normalizeAccessPhone(target.phone))throw Error('That code could not be verified. Check the code or request a new text.');
 let userId=target.userId;
 if(!userId){
  // Create an unverified email identity only after phone possession is proven.
  // Existing confirmed identities and accounts are rejected by the final DB guard.
  try{const user=await auth<{id:string}>('admin/users',{email:target.email,email_confirm:false});userId=user.id;}catch{
   target=await db<Target|null>('rpc/icash_verify_phone_challenge','POST',args);userId=target?.userId??null;
  }
 }
 if(!userId||!uuid.test(userId))throw Error('Your payment is saved. Please retry this code to finish opening your account.');
 const session=randomBytes(32).toString('hex');
 if(!await db<boolean>('rpc/icash_complete_phone_access','POST',{...binding,p_user:userId,p_session_hash:accessHash(session)}))throw Error('We could not restore this purchase. Use your payment email or contact support; do not pay again.');
 return session;
}
