import {webinarSettings} from '@/lib/webinar-meta';
import {pageMeasurementAllowed} from '@/lib/webinar-measurement-policy';
import {WebinarError,webinarError,webinarHeaders,webinarLimit,webinarVisitor} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
/** Page-level configuration does not create a visitor, start a session or record consent. */
export async function GET(req:Request){try{
 await webinarLimit(req,'page','pixel-config',120,60);
 const settings=await webinarSettings(),enabled=process.env.VERCEL_ENV==='production'&&settings.meta.enabled&&!!settings.meta.pixelId;
 if(!enabled)return Response.json({enabled:false,trackingAllowed:false},{headers:webinarHeaders});
 let identity=null;
 try{const visitor=await webinarVisitor();identity={marketing_consent_at:visitor.marketing_consent_at??null,measurement:visitor.measurement??{}};}
 catch(error){if(!(error instanceof WebinarError)||error.status!==401)throw error;}
 return Response.json({enabled,pixelId:settings.meta.pixelId,trackingAllowed:pageMeasurementAllowed(identity,req.headers)},{headers:webinarHeaders});
 }catch(error){return webinarError(error);}}
