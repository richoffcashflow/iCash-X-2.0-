import {NextResponse} from 'next/server';
import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {designBrand,brandSvg,type BrandDesign} from '@/lib/brand-design';
import {setupThemes} from '@/lib/bot-setup';
export const maxDuration=45;
const headers={'Cache-Control':'private, no-store'};
type Job={brand_name:string;state:string;designs:BrandDesign[]|null;updated_at:string};
async function saved(id:string,name:string){const [j]=await db<Job[]>(`icash_brand_jobs?setup_id=eq.${id}&select=brand_name,state,designs,updated_at`);if(j?.state==='creating'&&Date.now()-Date.parse(j.updated_at)>120000){await db(`icash_brand_jobs?setup_id=eq.${id}&state=eq.creating`,'PATCH',{state:'unavailable'});j.state='unavailable';}return j?.brand_name===name?j:null;}
export async function GET(req:Request){try{
 const s=await readBotSetup(await setupOwner());if(!s?.profile.displayName)throw Error();const j=await saved(s.id,s.profile.displayName);const choice=new URL(req.url).searchParams.get('choice');
 if(choice!==null){const n=Number(choice);if(!Number.isInteger(n)||n<0||n>2||j?.state!=='ready'||!j.designs?.[n])return new Response(null,{status:404,headers});
 const requested=new URL(req.url).searchParams.get('theme');const theme=requested&&Object.hasOwn(setupThemes,requested)?requested as keyof typeof setupThemes:s.profile.theme??'ink';const color=setupThemes[theme].color;return new Response(brandSvg(j.designs[n],color),{headers:{...headers,'Content-Type':'image/svg+xml','Content-Security-Policy':"default-src 'none'; style-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}});}
 return NextResponse.json({state:j?.state??'empty',designs:j?.state==='ready'?j.designs:null},{headers});
 }catch{return NextResponse.json({state:'unavailable'},{status:503,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({}, {status:403});
 let id:string|null=null;let claimed=false;
 try{const owner=await setupOwner();const s=await readBotSetup(owner);if(!s?.profile.displayName||!owner.hash)throw Error();id=s.id;
 const j=await saved(s.id,s.profile.displayName);if(j)return NextResponse.json({state:j.state,designs:j.state==='ready'?j.designs:null},{headers});
 await limitRequest(req,'free-brand-design',owner.hash,5,86400);
 if(!process.env.OPENAI_API_KEY)return NextResponse.json({state:'unavailable'},{headers});
 if(!await db<boolean>('rpc/icash_claim_brand_design','POST',{p_setup:s.id,p_name:s.profile.displayName}))return NextResponse.json({state:'unavailable'},{headers});
 claimed=true;
 const result=await designBrand(s.profile.displayName);
 await db(`icash_brand_jobs?setup_id=eq.${s.id}&state=eq.creating`,'PATCH',{...result,state:'ready',updated_at:new Date().toISOString()});
 return NextResponse.json({state:'ready',designs:result.designs},{headers});
 }catch{if(id&&claimed)await db(`icash_brand_jobs?setup_id=eq.${id}&state=eq.creating`,'PATCH',{state:'unavailable',updated_at:new Date().toISOString()}).catch(()=>{});return NextResponse.json({state:'unavailable'},{status:503,headers});}
}
