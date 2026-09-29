import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {renderDealDocument,type DocumentKind} from '@/lib/deal-documents';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function GET(req:Request){try{
 const setup=await readBotSetup(await setupOwner());if(!setup?.profile.displayName)return new Response('Save your name first.',{status:401});
 const kind=new URL(req.url).searchParams.get('kind');if(kind!=='purchase'&&kind!=='assignment')return new Response('Not found',{status:404});
 const html=renderDealDocument(kind as DocumentKind,{}).replace('<body>',`<body><header style="display:flex;gap:12px;align-items:center;margin-bottom:24px"><div><strong>${escape(setup.profile.displayName)}</strong><small>Your contract template • Complete deal details before use</small></div></header>`);
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('The template is unavailable. Please try again.',{status:503});}}
