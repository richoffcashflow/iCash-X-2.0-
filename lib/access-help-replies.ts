import {replyToSupport,type SupportTurn} from './support-conversation.ts';
import {investigateAccess} from './support-access-investigation.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Claim={token:string;messages:SupportTurn[];handedOff:boolean};
export async function replyToAccessHelp(db:Database,id:string,requestKey:string){
 const claim=await db<Claim|null>('rpc/icash_access_help_claim_reply','POST',{p_id:id,p_key:requestKey});
 if(!claim)return;
 const accessInvestigation=await investigateAccess(db,id,requestKey,claim.token);
 const answer=await replyToSupport({kind:'access',messages:claim.messages,accessInvestigation,handedOff:claim.handedOff,allowAI:false});
 await db('rpc/icash_access_help_finish_reply','POST',{p_id:id,p_key:requestKey,p_token:claim.token,p_reply:answer.reply,p_status:answer.status,p_handoff:false});
}
/** Recover saved questions after a crash, including requests created before automatic replies. */
export async function recoverAccessHelpReplies(db:Database){
 const pending=await db<{id:string;key:string}[]>('rpc/icash_access_help_pending_replies','POST',{});
 for(const item of pending)await replyToAccessHelp(db,item.id,item.key);
 return pending.length;
}
