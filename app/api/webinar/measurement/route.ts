import {z} from 'zod';
import {isIP} from 'node:net';
import {db} from '@/lib/stripe-test';
import {webinarSettings} from '@/lib/webinar-meta';
import {browserPaymentInfo,browserPurchase,marketingConsentVersion,type MetaIdentity,type MetaPurchase} from '@/lib/webinar-meta-policy';
import {automaticMeasurementEligible,measurementPolicyVersion,measurementSince} from '@/lib/webinar-measurement-policy';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarVisitor,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
const identifiers={fbp:z.string().max(250).optional(),fbc:z.string().max(500).optional(),fbclid:z.string().max(400).optional()};
const input=z.union([
 z.object({action:z.literal('automatic'),version:z.literal(measurementPolicyVersion),optedOut:z.boolean().optional(),...identifiers}).strict(),
 z.object({allow:z.boolean(),version:z.enum([marketingConsentVersion,measurementPolicyVersion]),...identifiers}).strict()
]);
async function measurementResponse(req:Request,action:'read'|'automatic'|'allow'|'deny',metadata:Record<string,string>={}){
 if(req.headers.get('sec-gpc')==='1')action='deny';
 const v=await webinarVisitor();await webinarLimit(req,v.id,'measurement-read',30,60);
 const settings=await webinarSettings(),enabled=process.env.VERCEL_ENV==='production'&&settings.meta.enabled&&!!settings.meta.pixelId;
 if(!enabled&&action==='allow')throw new WebinarError(409,'Ad measurement is not enabled.');
 if(!enabled&&action!=='deny')return Response.json({enabled:false,trackingAllowed:false},{headers:webinarHeaders});
 const identity=await db<MetaIdentity>('rpc/icash_webinar_measurement_access','POST',{
  p_visitor:v.id,p_action:action,p_automatic_eligible:automaticMeasurementEligible(req.headers),
  p_blocked:req.headers.get('sec-gpc')==='1',p_metadata:metadata
 });
 const since=measurementSince(identity),trackingAllowed=enabled&&!!since;
 if(trackingAllowed)await db('rpc/icash_webinar_sync_purchases','POST',{p_visitor:v.id});
 const cutoff=new Date(Math.max(Date.now()-48*3600000,Date.parse(since??'')||0)).toISOString();
 const events=trackingAllowed?await db<MetaPurchase[]>(`icash_webinar_meta_events?visitor_id=eq.${v.id}&state=neq.canceled&purchase_kind=in.(membership,vip_upgrade)&occurred_at=gte.${encodeURIComponent(cutoff)}&select=event_id,payment_id,session_id,visitor_id,value_cents,occurred_at,purchase_kind&order=occurred_at.desc&limit=20`):[];
 return Response.json({enabled,pixelId:settings.meta.pixelId,trackingAllowed,consent:!!identity.marketing_consent_at,events:events.flatMap(event=>[browserPaymentInfo(event),browserPurchase(event)])},{headers:webinarHeaders});
}
export async function GET(req:Request){try{return await measurementResponse(req,'read');}catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);const i=input.parse(await webinarBody(req,2000));
 const action='action' in i?(i.optedOut?'deny':'automatic'):i.allow?'allow':'deny';
 const metadata:Record<string,string>={};
 if(action!=='deny'&&req.headers.get('sec-gpc')!=='1'){
  metadata.client_user_agent=(req.headers.get('user-agent')||'').slice(0,500);
  const ip=process.env.VERCEL==='1'?req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim():null;
  if(ip&&isIP(ip))metadata.client_ip_address=ip;
  if(i.fbp&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(i.fbp))metadata.fbp=i.fbp;
  if(i.fbc&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(i.fbc))metadata.fbc=i.fbc;
  else if(i.fbclid&&/^[A-Za-z0-9_-]+$/.test(i.fbclid))metadata.fbc=`fb.1.${Date.now()}.${i.fbclid}`;
 }
 return await measurementResponse(req,action,metadata);
 }catch(e){return webinarError(e);}}
