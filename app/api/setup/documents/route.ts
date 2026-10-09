import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {renderDealDocument,type DocumentKind} from '@/lib/deal-documents';
export async function GET(req:Request){try{
 const setup=await readBotSetup(await setupOwner());if(!setup?.profile.displayName)return new Response('Save your bot’s name first.',{status:401});
 const kind=new URL(req.url).searchParams.get('kind');if(kind!=='purchase'&&kind!=='assignment')return new Response('Not found',{status:404});
 const html=renderDealDocument(kind as DocumentKind,{});
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('The template is unavailable. Please try again.',{status:503});}}
