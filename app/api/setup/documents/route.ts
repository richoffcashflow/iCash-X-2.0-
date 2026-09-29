import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {renderDealDocument,type DocumentKind} from '@/lib/deal-documents';
import {readBrandImage,type BrandImage} from '@/lib/brand-image';
import {db} from '@/lib/stripe-test';
import {brandSvg,type BrandDesign} from '@/lib/brand-design';
import {setupThemes} from '@/lib/bot-setup';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function GET(req:Request){try{
 const setup=await readBotSetup(await setupOwner());if(!setup?.profile.displayName)return new Response('Save your name first.',{status:401});
 const kind=new URL(req.url).searchParams.get('kind');if(kind!=='purchase'&&kind!=='assignment')return new Response('Not found',{status:404});
 let logo='';if(setup.profile.aiLogo!=null){const [j]=await db<{brand_name:string;designs:(BrandDesign|BrandImage)[]}[]>(`icash_brand_jobs?setup_id=eq.${setup.id}&state=eq.ready&select=brand_name,designs`);if(j?.brand_name===setup.profile.displayName&&j.designs?.[setup.profile.aiLogo]){const d=j.designs[setup.profile.aiLogo];if('imageKey' in d&&d.imageKey.startsWith(`${setup.id}/`)){const bytes=await readBrandImage(d.imageKey);logo=`<img width="64" height="64" alt="" src="data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}"/>`;}else if('paths' in d)logo=brandSvg(d,setupThemes[setup.profile.theme??'ink'].color).replace('<svg ','<svg width="52" height="52" ');}}
 const html=renderDealDocument(kind as DocumentKind,{}).replace('<body>',`<body><header style="display:flex;gap:12px;align-items:center;margin-bottom:24px">${logo}<div><strong>${escape(setup.profile.displayName)}</strong><small>Your contract template • Complete deal details before use</small></div></header>`);
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('The template is unavailable. Please try again.',{status:503});}}
