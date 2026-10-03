import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from '@/lib/required-call-recording-provider';
import {maintainRecordings} from '@/lib/required-call-recording-maintenance';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** No recording-launch, bot-pause, or wallet gate belongs on retention cleanup. */
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET,header=request.headers.get('authorization');
 if(!secret||secret.length<32||!header)return new Response(null,{status:401,headers:privateHeaders});
 const a=Buffer.from(header),b=Buffer.from('Bearer '+secret);
 if(a.length!==b.length||!timingSafeEqual(a,b))return new Response(null,{status:401,headers:privateHeaders});
 try{return Response.json(await maintainRecordings(db,createRecordingProviders(process.env),process.env),{headers:privateHeaders});}
 catch{return Response.json({status:'recording_maintenance_needs_review'},{status:503,headers:privateHeaders});}
}

export const GET=POST; // Authenticated Vercel cron; retained independently of capture release.
