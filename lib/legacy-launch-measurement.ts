import {cookies} from 'next/headers';
import {db} from '@/lib/stripe-test';
import {legacyLaunchCookie,launchTokenPattern} from '@/lib/legacy-launch-server';

/** Private customer journeys keep first-party counts without entering the ad pixel. */
export async function legacyAdMeasurementExcluded(req:Request,visitorId?:string) {
 const token=(await cookies()).get(legacyLaunchCookie)?.value;
 if(token&&launchTokenPattern.test(token))return true;
 const requestUrl=new URL(req.url),source=requestUrl.searchParams.get('page')||req.headers.get('referer');
 if(source&&source.length<=2000){
  let page:URL|null=null;try{page=new URL(source,requestUrl);}catch{/* Ignore malformed page context. */}
  if(page?.origin===requestUrl.origin){
   if(/^\/legacy-offer\/?$/.test(page.pathname))return true;
   const code=page.pathname.match(/^\/live\/(\d{6,12})\/?$/)?.[1];
   if(code){
    const [row]=await db<{config:{legacyCampaignId?:string}}[]>(`icash_webinars?public_code=eq.${code}&select=config&limit=1`);
    if(row?.config.legacyCampaignId)return true;
   }
   const session=page.searchParams.get('webinar_session');
   if(session&&/^[a-f0-9-]{36}$/i.test(session)){
    const [row]=await db<{config:{legacyCampaignId?:string}}[]>(`icash_webinar_sessions?id=eq.${session}&select=config&limit=1`);
    if(row?.config.legacyCampaignId)return true;
   }
  }
 }
 if(visitorId){
  const [last]=await db<{config:{legacyCampaignId?:string}}[]>(`icash_webinar_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}&is_preview=eq.false&select=config&order=created_at.desc&limit=1`);
  if(last?.config.legacyCampaignId)return true;
 }
 return false;
}
