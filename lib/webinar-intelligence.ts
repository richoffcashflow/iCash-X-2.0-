import {createHash} from 'node:crypto';
import {unstable_cache} from 'next/cache';
import {db} from '@/lib/stripe-test';
import {eligibleVariants,isNight} from '@/packages/webinar-engine/src/index';
import {armKey,type IntelligenceArm,type IntelligenceMetric,type IntelligenceStop} from '@/packages/webinar-engine/src/intelligence';
import {selectRecording} from '@/lib/webinar-recordings';
import {webinarOffers,webinarSchema,type Webinar,type WebinarSettings,type WatchHistory} from '@/lib/webinar-policy';
export type IntelligenceContext='new:day'|'new:night'|'returning:day'|'returning:night';
export type IntelligenceComparison={pool_key:string;baseline_key:string;holdout_visitors:number;holdout_buyers:number;holdout_value_cents:number;adaptive_visitors:number;adaptive_buyers:number;adaptive_value_cents:number};
export type IntelligenceData={generatedAt:string;rows:IntelligenceMetric[];comparisons:IntelligenceComparison[];ads:{ad_key:string;visitors:number}[]};
export type IntelligenceAssignment={ad_key:string;context_key:IntelligenceContext;pool_key:string;baseline_key:string;mode:string;probability:number;policy_version:number};
export const intelligenceContext=(history:WatchHistory[],timezone:string,now:Date,routing:WebinarSettings['routing']):IntelligenceContext=>`${history.length?'returning':'new'}:${isNight(timezone,now,routing)?'night':'day'}`;
export function intelligenceCandidates(webinars:Webinar[],history:WatchHistory[],timezone:string,now:Date,routing:WebinarSettings['routing'],offerNow=now){
 const available=webinars.filter(w=>w.intelligenceEnabled!==false).map(w=>selectRecording(webinarSchema.parse(w),timezone,now,routing)).filter(w=>webinarOffers(w).some(o=>!o.expiresAt||Date.parse(o.expiresAt)>offerNow.getTime()));
 const recordings=eligibleVariants(available,history,timezone,now,routing);
 const arms:IntelligenceArm[]=recordings.map(w=>({key:armKey(w),webinarId:w.id,revision:w.revision,version:w.recordingVersion,priority:w.priority}));
 return {recordings,arms};
}
export const intelligencePoolKey=(arms:IntelligenceArm[])=>createHash('sha256').update('stops-v1|'+arms.map(a=>`${a.key}:${a.priority}`).sort().join('|')).digest('hex');
// Aggregate-only cache; never cache identities, assignments, consent, or payment mutations.
const readMetrics=unstable_cache(async(context:IntelligenceContext,adKey:string)=>{
 const result=await db<IntelligenceData>('rpc/icash_webinar_intelligence_report','POST',{p_context:context,p_ad_key:adKey},AbortSignal.timeout(1800));
 if(!result||!Array.isArray(result.rows)||!Array.isArray(result.comparisons))throw Error('Intelligence results unavailable');
 return result;
},['webinar-intelligence-v1'],{revalidate:60});
export async function readIntelligenceData(context:IntelligenceContext,adKey:string){
 const [metrics,stops]=await Promise.allSettled([
  readMetrics(context,adKey),
  db<IntelligenceStop[]>(`icash_webinar_intelligence_stops?context_key=eq.${context}&ad_key=in.(${adKey==='*'?'*':`*,${adKey}`})&select=ad_key,arm_key,winner_key`,undefined,undefined,AbortSignal.timeout(1800)),
 ]);
 // Never revive a stopped recording when its stop records cannot be checked.
 if(stops.status==='rejected'||!Array.isArray(stops.value))throw Error('Webinar routing is temporarily unavailable. Please try again.');
 const data=metrics.status==='fulfilled'?metrics.value:{generatedAt:new Date().toISOString(),rows:[],comparisons:[],ads:[]};
 return {...data,stops:stops.value,metricsAvailable:metrics.status==='fulfilled'};
}
export async function saveIntelligenceStops(context:IntelligenceContext,stops:IntelligenceStop[]){
 if(stops.length)await db('rpc/icash_webinar_stop_recordings','POST',{p_context:context,p_stops:stops},AbortSignal.timeout(1800));
}
