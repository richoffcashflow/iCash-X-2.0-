import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {BusinessPhoneError,inspectBusinessPhone,connectBusinessPhone} from '@/lib/business-voice-numbers';
import {webinarOwner,webinarOrigin,webinarBody,webinarHeaders,webinarError,WebinarError} from '@/lib/webinar-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=45;
const visible=({callerIdSid,providerAccountSid,...result}:Awaited<ReturnType<typeof inspectBusinessPhone>>)=>result;
function error(e:unknown){return webinarError(e instanceof BusinessPhoneError?new WebinarError(503,e.message):e);}
export async function GET(){try{await webinarOwner();return Response.json(visible(await inspectBusinessPhone(process.env)),{headers:webinarHeaders});}catch(e){return error(e);}}
export async function POST(req:Request){try{webinarOrigin(req);await webinarOwner();z.object({action:z.literal('connect')}).strict().parse(await webinarBody(req,1000));return Response.json(visible(await connectBusinessPhone(db,process.env)),{headers:webinarHeaders});}catch(e){return error(e);}}
