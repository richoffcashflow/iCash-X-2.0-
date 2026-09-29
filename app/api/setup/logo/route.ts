import {NextResponse} from 'next/server';
import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {brandSvg,type BrandDesign} from '@/lib/brand-design';
import {readBrandImage,type BrandImage} from '@/lib/brand-image';
import {setupThemes} from '@/lib/bot-setup';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
type Job={brand_name:string;state:string;designs:(BrandDesign|BrandImage)[]|null;updated_at:string;render_version:number};
async function saved(id:string,name:string){const [j]=await db<Job[]>(`icash_brand_jobs?setup_id=eq.${id}&select=brand_name,state,designs,updated_at,render_version`);if(j?.state==='creating'&&Date.now()-Date.parse(j.updated_at)>240000){await db(`icash_brand_jobs?setup_id=eq.${id}&state=eq.creating`,'PATCH',{state:'unavailable'});j.state='unavailable';}return j?.brand_name===name?j:null;}
function payload(j:Job|null){return {state:j?.state??'empty',designs:j?.state==='ready'?j.designs?.map((d,i)=>'imageKey' in d?{title:d.title,imageUrl:`/api/setup/logo?choice=${i}&v=2`}:d):null};}
export async function GET(req:Request){try{
 const s=await readBotSetup(await setupOwner());if(!s?.profile.displayName)throw Error();const j=await saved(s.id,s.profile.displayName);const choice=new URL(req.url).searchParams.get('choice');
 if(choice!==null){const n=Number(choice);if(!Number.isInteger(n)||n<0||n>2||j?.state!=='ready'||!j.designs?.[n])return new Response(null,{status:404,headers});const design=j.designs[n];
 if('imageKey' in design){if(!design.imageKey.startsWith(`${s.id}/`))throw Error();return new Response(await readBrandImage(design.imageKey),{headers:{...headers,'Content-Type':'image/jpeg'}});}
 const requested=new URL(req.url).searchParams.get('theme');const theme=requested&&Object.hasOwn(setupThemes,requested)?requested as keyof typeof setupThemes:s.profile.theme??'ink';return new Response(brandSvg(design,setupThemes[theme].color),{headers:{...headers,'Content-Type':'image/svg+xml','Content-Security-Policy':"default-src 'none'; sandbox"}});}
 return NextResponse.json(payload(j),{headers});
 }catch{return NextResponse.json({state:'unavailable'},{status:503,headers});}}
// Kept for stale tabs: logo generation is retired and never starts a paid job.
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({}, {status:403,headers});
 return NextResponse.json({state:'retired',designs:null},{status:410,headers});
}
