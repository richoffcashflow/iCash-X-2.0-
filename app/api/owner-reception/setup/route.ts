import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {receptionTarget,boundedBody} from '@/lib/general-reception';
import {applyReceptionSetup,reviewReceptionSetup,ownerQuickTestCallerRestriction,type SetupAction} from '@/lib/reception-setup';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(message:string,status:number)=>NextResponse.json({status:'blocked',message,blockers:[],checks:{},actions:[]},{status,headers});
const env=()=>({ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,ELEVENLABS_INBOUND_WEBHOOK_SECRET:process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET,RECEPTION_POSTCALL_SECRET:process.env.RECEPTION_POSTCALL_SECRET,ELEVENLABS_WEBHOOK_SECRET:process.env.ELEVENLABS_WEBHOOK_SECRET,TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,RECEPTION_ENABLED:process.env.RECEPTION_ENABLED});
const deps={rpc:(name:string,body?:Record<string,unknown>)=>db('rpc/'+name,'POST',body??{})};
async function guard(request:Request,write=false){
 const account=await workAccount();if(account.accountId!==receptionTarget.accountId||account.userId!==receptionTarget.ownerUserId)return reply('This control is limited to the configured account owner.',403);
 const url=new URL(request.url);if(url.search||url.username||url.password||request.headers.get('host')!==url.host)return reply('Only the fixed setup endpoint is accepted.',400);
 if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||(write||request.headers.has('origin'))&&request.headers.get('origin')!==url.origin)return reply('A same-origin request is required.',403);
 return null;
}
function failure(e:unknown){const signIn=e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message);return reply(signIn?'Sign in as the configured account owner.':'Setup is unavailable. No provider change was verified.',signIn?401:503);}
export async function GET(request:Request){try{const blocked=await guard(request);if(blocked)return blocked;const environment=env();const [review,restriction]=await Promise.all([reviewReceptionSetup(environment,deps),ownerQuickTestCallerRestriction(environment,deps)]);return NextResponse.json({...review,...(restriction?{ownerQuickTestCallerRestriction:restriction}:{})},{headers});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const blocked=await guard(request,true);if(blocked)return blocked;
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply('A JSON review confirmation is required.',415);
 let value:unknown;try{value=JSON.parse(await boundedBody(request,4096));}catch{return reply('Invalid review confirmation.',400);}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='action,confirm,reviewToken')return reply('Only a fixed action and its review are accepted.',400);
 const b=value as {action:unknown;confirm:unknown;reviewToken:unknown};
 if(b.confirm!==true||typeof b.action!=='string'||!['prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3','configure_branch','route','restore'].includes(b.action)||typeof b.reviewToken!=='string'||b.reviewToken.length>2048)return reply('Explicit confirmation and a current signed review are required.',400);
 return NextResponse.json(await applyReceptionSetup(env(),deps,b.action as SetupAction,b.reviewToken),{headers});
 }catch(e){return failure(e);}}
