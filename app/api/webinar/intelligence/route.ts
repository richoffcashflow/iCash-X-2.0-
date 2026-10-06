import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {settingsSchema,webinarSchema,type WebinarSettings,type Webinar} from '@/lib/webinar-policy';
import {intelligencePlan} from '@/packages/webinar-engine/src/intelligence';
import {intelligenceCandidates,intelligencePoolKey,readIntelligenceData} from '@/lib/webinar-intelligence';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,WebinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
const query=z.object({context:z.enum(['new:day','new:night','returning:day','returning:night']).default('new:day'),ad:z.string().regex(/^(\*|direct|ad:\d{5,30})$/).default('*')}).strict();
export async function GET(req:Request){try{
 await webinarOwner();await webinarLimit(req,'owner','intelligence-report',30,60);
 const input=query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
 if(!input.success)throw new WebinarError(400,'Choose a valid audience and ad.');
 const {context,ad}=input.data;
 const [webinars,saved,data]=await Promise.all([
  db<{config:Webinar}[]>('icash_webinars?select=config&order=updated_at.desc&limit=100'),
  db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),
  readIntelligenceData(context,ad),
 ]);
 const settings=settingsSchema.parse(saved[0].config),now=new Date();
 // Display the configured local period, independent of the owner's timezone.
 now.setUTCHours(context.endsWith(':night')?settings.routing.nightStartsAt:settings.routing.nightEndsAt,0,0,0);
 const history=context.startsWith('returning:')?[{webinar_id:'prior-session',revision:1,progress_seconds:0,completed_at:null,updated_at:now.toISOString()}]:[];
 const {arms,recordings}=intelligenceCandidates(webinars.map(w=>webinarSchema.parse(w.config)),history,'UTC',now,settings.routing,new Date());
 const plan=intelligencePlan(arms,data.rows,ad,settings.optimizer);
 const comparison=data.comparisons.find(c=>c.pool_key===intelligencePoolKey(arms))??null;
 return Response.json({context,ad,generatedAt:data.generatedAt,enabled:settings.optimizer.enabled,plan,
  arms:arms.map(a=>({...a,title:recordings.find(w=>w.id===a.webinarId)!.title})),
  rows:data.rows.filter(r=>r.ad_key===ad),ads:data.ads,comparison,
 },{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
export async function POST(req:Request){try{
 webinarOrigin(req);await webinarOwner();await webinarLimit(req,'owner','intelligence-settings',20,60);
 const input=z.object({enabled:z.boolean()}).strict().safeParse(await webinarBody(req,1000));
 if(!input.success)throw new WebinarError(400,'Choose whether automatic optimization is on or off.');
 await db('rpc/icash_webinar_intelligence_settings','POST',{p_enabled:input.data.enabled});
 return Response.json({enabled:input.data.enabled},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
