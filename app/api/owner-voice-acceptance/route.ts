import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {ownerVoiceConfirmation} from '@/lib/owner-voice-acceptance';
import {ownerVoiceStatus,startOwnerVoiceAcceptance} from '@/lib/owner-voice-acceptance-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
function failure(error:unknown){return NextResponse.json({error:'Owner acceptance check unavailable. Check status before any further action.'},{status:error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message)?401:503,headers});}
export async function GET(){try{return NextResponse.json(await ownerVoiceStatus(await workAccount()),{headers});}catch(error){return failure(error);}}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin owner session required.'},{status:403,headers});
 try{
  const owner=await workAccount(),raw=await req.text();
  if(raw.length>300)return NextResponse.json({error:'Invalid confirmation.'},{status:400,headers});
  let body;try{body=JSON.parse(raw);}catch{return NextResponse.json({error:'Invalid confirmation.'},{status:400,headers});}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.confirmation!==ownerVoiceConfirmation)return NextResponse.json({error:'Confirm the one owner-phone AI test.'},{status:400,headers});
  return NextResponse.json(await startOwnerVoiceAcceptance(owner),{headers});
 }catch(error){return failure(error);}
}
