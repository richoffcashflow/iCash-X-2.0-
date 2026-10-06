import {cookies} from 'next/headers';
import {guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {checkoutCustomerContext} from '@/lib/checkout-customer-context';
import {setupVoices} from '@/lib/setup-voices';
import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {identityNames,chooseAccountVoice} from '@/lib/customer-identity';
import {normalizeUpdatePhone} from '@/lib/customer-updates';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 try{const user=await currentUser(true);if(!user)return NextResponse.json({firstName:''},{headers});const token=(await cookies()).get('icash_funding_guest')?.value;const context=await checkoutCustomerContext(validGuest(token)?guestHash(token!):null,user.email);return NextResponse.json({firstName:context.name??''},{headers});}
 catch{return NextResponse.json({firstName:''},{headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const user=await currentUser(true);
  if(!user)return NextResponse.json({error:'Sign in to save your name.'},{status:401,headers});
  const raw=await req.text();if(raw.length>2048)return NextResponse.json({error:'Name is too long.'},{status:400,headers});
  let names,phone:string|undefined;try{const input=JSON.parse(raw);names=identityNames(input);if(Object.keys(input).some(key=>!['first_name','last_name','company_name','phone'].includes(key)))throw Error('Unexpected field');if(Object.hasOwn(input,'phone')){if(typeof input.phone!=='string'||input.phone.length>40)throw Error('Invalid phone');phone=normalizeUpdatePhone(input.phone.trim());if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))return NextResponse.json({error:'Enter a valid phone number, including its country code.'},{status:400,headers});}}catch{return NextResponse.json({error:'Enter your company name or your first and last name, and check your phone number.'},{status:400,headers});}
  const [account]=await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`);
  if(!account)return NextResponse.json({error:'Finish setting up your funded account first.'},{status:409,headers});
  const [existing]=await db<{voice_id:string;voice_name:string}[]>(`icash_customer_identities?account_id=eq.${account.id}&select=voice_id,voice_name`);
  let voice=existing;
  const [setup]=await db<{profile:{voice?:string}}[]>(`icash_bot_setups?account_id=eq.${account.id}&select=profile`);
  if(setup?.profile.voice){const selected=(await setupVoices()).find(v=>v.key===setup.profile.voice);if(selected)voice={voice_id:selected.voiceId,voice_name:selected.name};}
  if(!voice){const catalog=await elevenRequest<{voices:{voice_id:string;name:string;category:string}[]}>('/v1/voices');const selected=chooseAccountVoice(account.id,catalog.voices);voice={voice_id:selected.voice_id,voice_name:selected.name};}
  const params={p_user:user.id,p_first:names.first_name,p_last:names.last_name,p_company:names.company_name,p_voice:voice.voice_id,p_voice_name:voice.voice_name};
  if(phone!==undefined){const saved=await db<{identity:unknown;phone:string;smsUpdatesPaused:boolean}>('rpc/icash_save_account_details','POST',{...params,p_phone:phone});return NextResponse.json(saved,{headers});}
  const identity=await db('rpc/icash_save_customer_identity','POST',params);
  return NextResponse.json({identity},{headers});
 }catch{return NextResponse.json({error:'Could not save your details. Please try again.'},{status:503,headers});}
}
