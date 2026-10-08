import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {webinarOwner,webinarOrigin,webinarBody,webinarHeaders,webinarError} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(){try{await webinarOwner();return Response.json({replies:await db('icash_lifecycle_text_inbox?state=eq.open&select=event_id,role,sender,recipient,body,created_at&order=created_at.desc&limit=50')},{headers:webinarHeaders});}catch(e){return webinarError(e);}}
export async function POST(req:Request){try{webinarOrigin(req);await webinarOwner();const input=z.object({id:z.string().min(1).max(200)}).strict().parse(await webinarBody(req,500));await db(`icash_lifecycle_text_inbox?event_id=eq.${encodeURIComponent(input.id)}`,'PATCH',{state:'closed'});return Response.json({saved:true},{headers:webinarHeaders});}catch(e){return webinarError(e);}}
