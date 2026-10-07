import {db} from '@/lib/stripe-test';
import {webinarPitchAt,webinarOffers,type Webinar,type WebinarRow,type WebinarSettings} from '@/lib/webinar-policy';
import {selectRecording} from '@/lib/webinar-recordings';
import {availableWebinarRows,webinarConversionRecordings} from '@/lib/webinar-selection';
import {returnVisit,paidAdArrival,confirmedWatch,bestConvertingWebinar,stableWebinarOrder} from '@/packages/webinar-engine/src/index';
import type {WebinarSession} from '@/lib/webinar-server';

export type OfferImpression={session_id:string;created_at:string;kind:string;event_key:string};
export function webinarReturnJourney(history:WebinarSession[],offers:OfferImpression[],timezone:string,hours:number,now=new Date()){
 return returnVisit(history.map(h=>({...h,config:{...h.config,pitchAt:webinarPitchAt(h.config)},offer_seen_at:offers.find(o=>o.session_id===h.id&&o.kind==='pitch_shown'&&o.event_key==='once')?.created_at??null})),timezone,hours,now);
}
/** The caller has already protected payment, preview, resume and checkout-window paths. */
export async function adReturnWebinar(current:Webinar,history:WebinarSession[],visitorId:string,attribution:Record<string,string>|undefined,timezone:string,settings:WebinarSettings,offers:OfferImpression[],now=new Date()):Promise<{webinar:Webinar;history:WebinarSession[]}|null>{
 if(current.parentWebinarId||!paidAdArrival(attribution)||!history.some(h=>h.webinar_id===current.id&&confirmedWatch(h,now)))return null;
 try{
  const [rows,allHistory]=await Promise.all([
   db<WebinarRow[]>('icash_webinars?parent_webinar_id=is.null&config->>status=eq.published&select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1000','GET',undefined,AbortSignal.timeout(1800)),
   db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitorId}&is_preview=eq.false&select=*&order=created_at.desc&limit=1000`,'GET',undefined,AbortSignal.timeout(1800)),
  ]);
  if(allHistory.length>=1000)return null; // Incomplete history cannot establish an unwatched destination.
  const pool=availableWebinarRows(rows).filter(w=>w.id!==current.id&&!w.parentWebinarId&&w.status==='published'&&w.videoUrl).map(w=>selectRecording(w,timezone,now,settings.routing));
  // A previously chosen alternative keeps its saved playback or checkout window.
  const linked=allHistory.filter(h=>h.config.adEntryWebinarId===current.id);
  const prior=webinarReturnJourney(linked,offers,timezone,settings.routing.checkoutWindowHours,now);
  if(prior.kind==='resume'||prior.kind==='checkout'){
   const saved=linked.find(h=>h.id===prior.sessionId),webinar=pool.find(w=>w.id===saved?.webinar_id);
   if(webinar)return {webinar,history:allHistory.filter(h=>h.webinar_id===webinar.id)};
  }
  const seen=new Set(allHistory.filter(h=>confirmedWatch(h,now)).map(h=>h.webinar_id));
  const eligible=pool.filter(w=>!seen.has(w.id)&&webinarOffers(w).some(o=>!o.expiresAt||Date.parse(o.expiresAt)>now.getTime()));
  if(!eligible.length)return null;
  const active=webinarReturnJourney(allHistory.filter(h=>eligible.some(w=>w.id===h.webinar_id)),offers,timezone,settings.routing.checkoutWindowHours,now);
  if(active.kind==='resume'||active.kind==='checkout'){
   const saved=allHistory.find(h=>h.id===active.sessionId),webinar=eligible.find(w=>w.id===saved?.webinar_id);
   if(webinar)return {webinar,history:allHistory.filter(h=>h.webinar_id===webinar.id)};
  }
  const stats=eligible.length>1?await webinarConversionRecordings():[];
  const webinar=bestConvertingWebinar(eligible,stats)??eligible.sort(stableWebinarOrder)[0];
  return {webinar:{...webinar,adEntryWebinarId:current.id},history:allHistory.filter(h=>h.webinar_id===webinar.id)};
 }catch{return null;}
}
