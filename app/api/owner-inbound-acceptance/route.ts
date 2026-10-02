import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {ownerInboundConfirmation} from '@/lib/owner-inbound-acceptance';
import {ownerInboundStatus,armOwnerInbound,cancelOwnerInbound,reconcileOwnerInboundRun} from '@/lib/owner-inbound-acceptance-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const bodySchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('arm'),confirmation:z.literal(ownerInboundConfirmation),configId:z.string().uuid(),quoteCapCents:z.number().int().positive().max(10000),rateEvidenceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('cancel'),runId:z.string().uuid()}).strict(),
 z.object({action:z.literal('reconcile'),runId:z.string().uuid()}).strict(),
]);
function failure(error:unknown){return NextResponse.json({error:'Owner inbound test is held. Check status before any further action; do not re-arm an uncertain request.'},{status:error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message)?401:503,headers});}
export async function GET(){try{return NextResponse.json(await ownerInboundStatus(await workAccount()),{headers});}catch(error){return failure(error);}}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin||!['same-origin','none',null].includes(req.headers.get('sec-fetch-site')))return NextResponse.json({error:'Same-origin owner session required.'},{status:403,headers});
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return NextResponse.json({error:'JSON required.'},{status:415,headers});
 try{
  const owner=await workAccount();
  if(Number(req.headers.get('content-length')??0)>1024)return NextResponse.json({error:'Invalid request.'},{status:400,headers});
  const raw=await req.text();if(Buffer.byteLength(raw)>1024)return NextResponse.json({error:'Invalid request.'},{status:400,headers});
  let json:unknown;try{json=JSON.parse(raw);}catch{return NextResponse.json({error:'Invalid request.'},{status:400,headers});}
  const parsed=bodySchema.safeParse(json);if(!parsed.success)return NextResponse.json({error:'Use the displayed confirmation and current quote.'},{status:400,headers});
  const b=parsed.data;
  const result=b.action==='arm'?await armOwnerInbound(owner,b):b.action==='cancel'?await cancelOwnerInbound(owner,b.runId):await reconcileOwnerInboundRun(owner,b.runId);
  return NextResponse.json(result,{headers});
 }catch(error){return failure(error);}
}
