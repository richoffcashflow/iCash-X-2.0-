import {cookies} from 'next/headers';
import {db} from '@/lib/stripe-test';
import {readWebinarToken} from '@/lib/webinar-token';
import {webinarKey,webinarToken} from '@/lib/webinar-server';
import {webinarLink} from '@/lib/webinar-links';
import {vipActive} from '@/lib/vip-policy';
import {webinarSite} from '@/lib/webinar-site';
type VipReminder={visitor_id:string;webinar_id:string;public_code:number;mode:'live';state:string;paid_through:string;vip_until:string|null;post_purchase_webinar_id:string};
/** This cookie authorizes one VIP video only. Billing, account and upgrade APIs never use it. */
export async function openVipReminder(jobId:string){
 const access=await db<VipReminder|null>('rpc/icash_webinar_vip_link','POST',{p_job:jobId});
 if(!access)return null;
 if(vipActive(access))return webinarSite.workspacePath;
 (await cookies()).set('icash_webinar_vip',webinarToken(jobId,'vip-session',3600),{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:3600});
 return `${webinarLink({publicCode:String(access.public_code)})}?r=${encodeURIComponent(webinarToken(access.visitor_id,'resume',3600))}&watch=1`;
}
export async function webinarReminderMembership(webinarId:string){
 const id=readWebinarToken((await cookies()).get('icash_webinar_vip')?.value,'vip-session',webinarKey());
 if(!id)return null;
 const access=await db<VipReminder|null>('rpc/icash_webinar_vip_link','POST',{p_job:id});
 return access?.webinar_id===webinarId?access:null;
}
