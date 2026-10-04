import {timingSafeEqual} from 'node:crypto';
import {processWebinarEmails} from '@/lib/webinar-email';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:Request){const expected=`Bearer ${process.env.CRON_SECRET||''}`,got=req.headers.get('authorization')||'';if(!process.env.CRON_SECRET||expected.length!==got.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(got)))return new Response(null,{status:401});try{return Response.json(await processWebinarEmails(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Follow-up processing unavailable.'},{status:503});}}
