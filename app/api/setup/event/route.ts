import {NextResponse} from 'next/server';
import {z} from 'zod';
import {setupEvents} from '@/lib/bot-setup';
import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({}, {status:403});
 try{const raw=await req.text();if(raw.length>160)throw Error();const {event}=z.object({event:z.enum(setupEvents)}).strict().parse(JSON.parse(raw));
 const owner=await setupOwner();if(!owner.hash)throw Error();await limitRequest(req,'setup-events',owner.hash,40,600);const s=await readBotSetup(owner);if(!s)throw Error();
 // Browser signals are engagement, never purchases or actual outreach.
 await db('rpc/icash_record_setup_event','POST',{p_setup:s.id,p_event:event});return NextResponse.json({saved:true});
 }catch{return NextResponse.json({saved:false},{status:400});}
}
