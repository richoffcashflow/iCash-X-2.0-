import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {currentUser} from './account-auth';
import {db,guestHash} from './stripe-test';
import {validGuest} from './funding';
import type {BotSetup} from './bot-setup';
export async function setupOwner(create=false){
 const jar=await cookies();let token=jar.get('icash_funding_guest')?.value;
 if(!validGuest(token)&&create){token=randomBytes(32).toString('hex');jar.set('icash_funding_guest',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}
 const user=await currentUser(false);const [account]=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
 if(create&&validGuest(token)){const [bound]=await db<{account_id:string|null}[]>(`icash_bot_setups?guest_hash=eq.${guestHash(token)}&select=account_id`);if(bound?.account_id&&bound.account_id!==account?.id){token=randomBytes(32).toString('hex');jar.set('icash_funding_guest',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}}
 return {hash:validGuest(token)?guestHash(token):null,accountId:account?.id??null};
}
export async function readBotSetup(owner:Awaited<ReturnType<typeof setupOwner>>){
 if(owner.accountId){const [row]=await db<BotSetup[]>(`icash_bot_setups?account_id=eq.${owner.accountId}&select=id,profile,stage,revision,variant,flow_variant,flow_experiment,updated_at`);if(row)return row;}
 if(owner.hash){const [row]=await db<BotSetup[]>(`icash_bot_setups?guest_hash=eq.${owner.hash}&account_id=is.null&select=id,profile,stage,revision,variant,flow_variant,flow_experiment,updated_at`);return row??null;}
 return null;
}
export async function setupEvent(name:string){
 try{const owner=await setupOwner();const s=await readBotSetup(owner);if(s)await db('rpc/icash_record_setup_event','POST',{p_setup:s.id,p_event:name});}catch{/* Analytics must not block checkout or billing. */}
}
