import {NextResponse} from 'next/server';
import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {setupOwner,readBotSetup} from '@/lib/bot-setup-server';
import {db} from '@/lib/stripe-test';
import {limitRequest} from '@/lib/funding';
import {setupProfileSchema} from '@/lib/bot-setup';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{return NextResponse.json({setup:await readBotSetup(await setupOwner())},{headers});}catch{return NextResponse.json({error:'Could not load your setup.'},{status:503,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const raw=await req.text();if(raw.length>2048)throw Error();const data=JSON.parse(raw);
  const owner=await setupOwner(true);await limitRequest(req,'bot-setup',owner.hash!,40,600);
  if(data.action==='init'){
   let setup=await readBotSetup(owner);
   if(!setup)setup=await db('rpc/icash_init_bot_setup','POST',{p_guest:owner.hash,p_account:owner.accountId});
   return NextResponse.json({setup},{headers});
  }
  const input=z.object({action:z.literal('save'),profile:setupProfileSchema,stage:z.number().int().min(0).max(4),revision:z.number().int().min(0)}).strict().parse(data);
  const current=await readBotSetup(owner);if(!current)return NextResponse.json({error:'Refresh to restore your setup.'},{status:409,headers});
  const setup=await db('rpc/icash_save_bot_setup','POST',{p_setup:current.id,p_revision:input.revision,p_profile:input.profile,p_stage:input.stage});
  if(!setup)return NextResponse.json({error:'Your setup changed in another tab. Reload to continue.'},{status:409,headers});
  return NextResponse.json({setup},{headers});
 }catch{return NextResponse.json({error:'Could not save. Your choices are still here—please retry.'},{status:400,headers});}
}
