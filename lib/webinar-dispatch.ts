import {after} from 'next/server';
import {processWebinarFollowups} from '@/lib/webinar-email';
/** Respond to the verified event first; the durable outbox survives dispatch failure. */
export function scheduleWebinarFollowups(visitorId?:string){
 if(process.env.VERCEL_ENV!=='production')return;
 after(async()=>{try{await processWebinarFollowups({visitorId});}catch{/* The minute worker resumes durable pending work. */}});
}
