import {db} from '@/lib/stripe-test';
import {availableWebinarRows,webinarConversionRecordings} from '@/lib/webinar-selection';
import {campaignTarget,type CampaignDestination} from '@/lib/webinar-campaign';
import type {WebinarRow,WebinarSettings} from '@/lib/webinar-policy';
import type {WebinarSession} from '@/lib/webinar-server';
export async function resolveCampaignTarget(visitorId:string,sourceId:string,destination:CampaignDestination,timezone:string,settings:WebinarSettings,database= db,now=new Date()){
 const [history,rows]=await Promise.all([
  database<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitorId}&is_preview=eq.false&select=*&order=created_at.desc&limit=1000`),
  database<WebinarRow[]>('icash_webinars?parent_webinar_id=is.null&config->>status=eq.published&select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1000'),
 ]);
 const webinars=history.length>=1000?[]:availableWebinarRows(rows);
 const stats=destination!=='checkout'&&webinars.length>1?await webinarConversionRecordings():[];
 return campaignTarget(destination,sourceId,history,webinars,stats,timezone,settings.routing,now);
}
