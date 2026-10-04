import {z} from 'zod';
import {isIP} from 'node:net';
import {db} from '@/lib/stripe-test';
import {metaReady,webinarSettings} from '@/lib/webinar-meta';
import {browserPurchase,marketingConsentVersion,type MetaIdentity,type MetaPurchase} from '@/lib/webinar-meta-policy';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarVisitor,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const v=await webinarVisitor();await webinarLimit(req,v.id,'measurement-read',20,60);
 const settings=await webinarSettings(),enabled=process.env.VERCEL_ENV==='production'&&settings.meta.enabled&&metaReady();
 const [identity]=await db<MetaIdentity[]>(`icash_webinar_visitors?id=eq.${v.id}&select=email,marketing_consent_at,measurement`);
 if(!enabled)return Response.json({enabled:false},{headers:webinarHeaders});
 if(req.headers.get('sec-gpc')==='1'){
  await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{marketing_consent_at:null,measurement:{}});
  await db(`icash_webinar_meta_events?visitor_id=eq.${v.id}&state=in.(pending,sending)`,'PATCH',{state:'canceled',payload:null});
  return Response.json({enabled:true,consent:false,pixelId:settings.meta.pixelId,events:[]},{headers:webinarHeaders});
 }
 if(identity.marketing_consent_at)await db('rpc/icash_webinar_sync_purchases','POST',{p_visitor:v.id});
 const events=identity.marketing_consent_at?await db<MetaPurchase[]>(`icash_webinar_meta_events?visitor_id=eq.${v.id}&state=neq.canceled&occurred_at=gte.${encodeURIComponent(new Date(Date.now()-48*3600000).toISOString())}&select=event_id,payment_id,session_id,visitor_id,value_cents,occurred_at&order=occurred_at.desc&limit=20`):[];
 return Response.json({enabled:true,pixelId:settings.meta.pixelId,consent:!!identity.marketing_consent_at,events:events.map(browserPurchase)},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);const v=await webinarVisitor();await webinarLimit(req,v.id,'measurement-consent',20,600);
 const i=z.object({allow:z.boolean(),version:z.literal(marketingConsentVersion),fbp:z.string().max(250).optional(),fbc:z.string().max(500).optional(),fbclid:z.string().max(400).optional()}).strict().parse(await webinarBody(req,2000));
 const allow=i.allow&&req.headers.get('sec-gpc')!=='1',settings=await webinarSettings();
 if(allow&&(!settings.meta.enabled||!metaReady()||process.env.VERCEL_ENV!=='production'))throw new WebinarError(409,'Ad measurement is not enabled.');
 const [old]=await db<MetaIdentity[]>(`icash_webinar_visitors?id=eq.${v.id}&select=email,marketing_consent_at,measurement`);
 const measurement:Record<string,string>=allow?{...old.measurement,version:marketingConsentVersion,client_user_agent:(req.headers.get('user-agent')||'').slice(0,500)}:{};
 if(allow){
  const ip=req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();if(ip&&isIP(ip))measurement.client_ip_address=ip;
  if(i.fbp&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(i.fbp))measurement.fbp=i.fbp;
  if(i.fbc&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(i.fbc))measurement.fbc=i.fbc;
  else if(i.fbclid&&/^[A-Za-z0-9_-]+$/.test(i.fbclid))measurement.fbc=`fb.1.${Date.now()}.${i.fbclid}`;
 }
 await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{marketing_consent_at:allow?(old.marketing_consent_at||new Date().toISOString()):null,measurement});
 if(!allow)await db(`icash_webinar_meta_events?visitor_id=eq.${v.id}&state=in.(pending,sending)`,'PATCH',{state:'canceled',payload:null});
 return Response.json({consent:allow},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
