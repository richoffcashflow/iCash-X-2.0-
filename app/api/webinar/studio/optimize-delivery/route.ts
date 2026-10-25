import {z} from 'zod';
import {optimizeWebinarDelivery} from '@/lib/webinar-delivery';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner} from '@/lib/webinar-server';
export const maxDuration=60;
export async function POST(req:Request){try{
 webinarOrigin(req);const owner=await webinarOwner();await webinarLimit(req,owner.id,'optimize-delivery',5,600);
 const input=z.object({webinarId:z.guid(),revision:z.number().int().positive()}).strict().parse(await webinarBody(req,512));
 return Response.json(await optimizeWebinarDelivery(input.webinarId,input.revision,owner.id),{headers:webinarHeaders});
 }catch(error){return webinarError(error);}}
