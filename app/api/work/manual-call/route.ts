import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {contactEligibility,type VoicePermission} from '@/lib/live-dispatch-policy';
export const dynamic='force-dynamic';
/** Read-only dialer choices. Never queues calls, grants permission or spends credits. */
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();const screeningId=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
  const [property]=await db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${screeningId}&state=eq.complete&select=id&limit=1`);
  if(!property)return NextResponse.json({error:'Property unavailable.'},{status:404,headers});
  const permissions=await db<(VoicePermission&{id:string;eligibility_source?:string;contact_key:string})[]>(`icash_voice_contact_targets?account_id=eq.${accountId}&screening_id=eq.${screeningId}&party=eq.seller&select=id,eligibility_source,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_until,dnc_checked_at,dnc_clear,revoked_at&limit=50`);
  const phones=[...new Set(permissions.map(p=>p.phone).filter(phone=>/^\+1[2-9][0-9]{9}$/.test(phone)))];
  if(!phones.length)return NextResponse.json({contacts:[],reason:'No contact has current DNC and operating checks yet.'},{headers});
  const keys=phones.map(phone=>createHash('sha256').update(phone).digest('hex'));
  const [textBlocks,callBlocks,lookups]=await Promise.all([
   db<{phone:string}[]>(`icash_text_suppressions?phone=in.(${phones.map(encodeURIComponent).join(',')})&select=phone&limit=50`),
   db<{contact_key:string}[]>(`icash_contact_suppressions?contact_key=in.(${keys.join(',')})&select=contact_key&limit=50`),
   db<{people?:{phones?:{number?:string;doNotCall?:boolean}[]}[]}[]>(`icash_owner_contacts?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=people:result->contacts&limit=1`)
  ]);
  const operationalCurrent=new Map<string,boolean>();
  for(const p of permissions.filter(p=>p.eligibility_source==='operational_checks_only'))operationalCurrent.set(p.id,await db<boolean>('rpc/icash_operational_contact_current','POST',{p_account:accountId,p_contact:p.id,p_channel:'voice',p_check_hour:false})===true);
  const contacts=phones.map(phone=>{
   const key=createHash('sha256').update(phone).digest('hex'),records=permissions.filter(p=>p.phone===phone),permission=records.find(p=>p.contact_key===key);
   const sourceBlocked=lookups.some(l=>Array.isArray(l.people)&&l.people.some(p=>Array.isArray(p.phones)&&p.phones.some(n=>typeof n.number==='string'&&[phone.slice(1),phone.slice(2)].includes(n.number.replace(/\D/g,''))&&n.doNotCall===true)));
   const blocked=sourceBlocked||textBlocks.some(b=>b.phone===phone)||callBlocks.some(b=>b.contact_key===key)||records.some(p=>p.revoked_at||!p.dnc_clear);
   const eligible=permission&&(permission.eligibility_source!=='operational_checks_only'||operationalCurrent.get(permission.id))?contactEligibility(permission):{ready:false,reason:'contact_operating_checks_required'};
   return {phone,available:!blocked&&eligible.ready,reason:blocked?'Do not contact. This number is blocked.':eligible.ready?'Opens your phone app. You place the call.':eligible.reason==='outside_contact_hours'?'Outside allowed contact hours.':'DNC or contact operating checks are incomplete.'};
  });
  return NextResponse.json({contacts},{headers});
 }catch{return NextResponse.json({error:'Could not check contact readiness. Try again.'},{status:503,headers});}
}
