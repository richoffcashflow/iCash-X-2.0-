import {db} from '@/lib/stripe-test';
import {webinarFromRow,type WebinarRow} from '@/lib/webinar-policy';
import type {ConversionRecording} from '@/packages/webinar-engine/src/index';

export function availableWebinarRows(rows:WebinarRow[]){
 return rows.flatMap(row=>{try{return [webinarFromRow(row)];}catch{return [];}});
}
/** Optional reporting must not block a video or a payment when reporting is down. */
export async function webinarConversionRecordings():Promise<ConversionRecording[]>{
 try{
  const report=await db<{recordings:ConversionRecording[]}>('rpc/icash_webinar_daily_report','POST',{p_period:'30d',p_timezone:'UTC'},AbortSignal.timeout(1800));
  return Array.isArray(report?.recordings)?report.recordings:[];
 }catch{return [];}
}
