import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {botUpdateConsentVersion,customerUpdateConfiguration,normalizeUpdatePhone,updateCopy,type UpdateSource,type BotUpdatePreferences} from '@/lib/customer-updates';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const preferenceInput=z.object({action:z.literal('preferences'),emailEnabled:z.boolean(),smsEnabled:z.boolean(),phone:z.string().max(30),timezone:z.string().min(1).max(80),consentVersion:z.literal(botUpdateConsentVersion).optional()}).strict();
export async function GET(){
 try{
  const {accountId,userId}=await workAccount();
  const [sources,preferences,settings]=await Promise.all([
   db<UpdateSource[]>('rpc/icash_customer_update_sources','POST',{p_account:accountId}),
   db<BotUpdatePreferences>('rpc/icash_customer_update_preferences_get','POST',{p_account:accountId,p_user:userId}),
   db<{enabled:boolean}[]>('icash_customer_update_settings?id=eq.1&select=enabled')
  ]);
  const ids=[...new Set(sources.map(item=>item.screening_id))].filter(id=>z.string().uuid().safeParse(id).success);
  const properties=ids.length?await db<{id:string;home:{address?:string}}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=in.(${ids.join(',')})&select=id,home:result->property`):[];
  const config=customerUpdateConfiguration(process.env);
  const items=sources.filter(item=>Object.hasOwn(updateCopy,item.kind)&&(item.kind==='credits_low'||properties.some(p=>p.id===item.screening_id))).map(item=>({id:item.source_key,kind:item.kind,screeningId:item.screening_id,createdAt:item.event_at,...updateCopy[item.kind],address:properties.find(p=>p.id===item.screening_id)?.home?.address??null}));
  return NextResponse.json({items,preferences:{...preferences,emailAvailable:config.email&&settings[0]?.enabled===true,smsAvailable:config.sms&&settings[0]?.enabled===true}}, {headers});
 }catch{return NextResponse.json({error:'Updates could not load. Your properties and conversations are still available.'},{status:503,headers});}
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return NextResponse.json({error:'Open your workspace and try again.'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await request.text();if(raw.length>1024)return NextResponse.json({error:'Invalid update.'},{status:400,headers});
  const body=JSON.parse(raw);
  if(body.action==='seen'){
   const parsed=z.object({action:z.literal('seen'),before:z.string().datetime({offset:true})}).strict().safeParse(body);
   if(!parsed.success)return NextResponse.json({error:'Invalid update time.'},{status:400,headers});
   await db('rpc/icash_customer_updates_seen','POST',{p_account:accountId,p_user:userId,p_before:parsed.data.before});
   return NextResponse.json({saved:true},{headers});
  }
  const parsed=preferenceInput.safeParse(body);if(!parsed.success)return NextResponse.json({error:'Check your update preferences.'},{status:400,headers});
  const value=parsed.data,config=customerUpdateConfiguration(process.env);
  if((value.emailEnabled||value.smsEnabled)&&value.consentVersion!==botUpdateConsentVersion)return NextResponse.json({error:'Confirm how you want to receive updates.'},{status:400,headers});
  if((value.emailEnabled&&!config.email)||(value.smsEnabled&&!config.sms))return NextResponse.json({error:'This delivery channel is temporarily unavailable.'},{status:503,headers});
  const phone=normalizeUpdatePhone(value.phone);
  if(value.smsEnabled&&!/^\+[1-9]\d{7,14}$/.test(phone))return NextResponse.json({error:'Enter your mobile number, including country code.'},{status:400,headers});
  const preferences=await db('rpc/icash_customer_update_preferences_save','POST',{p_account:accountId,p_user:userId,p_email:value.emailEnabled,p_sms:value.smsEnabled,p_phone:phone||null,p_timezone:value.timezone,p_consent:value.consentVersion??null});
  return NextResponse.json({saved:true,preferences},{headers});
 }catch{return NextResponse.json({error:'Could not save your update preferences. Refresh and try again.'},{status:503,headers});}
}
