type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dispatch=(account:string,message:string)=>Promise<{status:string}>;
type Reply={accountId:string;messageId?:string;textAiJobId?:string};

/** Authenticated provider event only. The database binds the recipient, property,
 * exact reply and revision; ordinary dispatch still owns permission and spending. */
export async function replyToSellerText(db:Database,dispatch:Dispatch,eventId:string,processAi:Dispatch){
 const reply=await db<Reply|null>('rpc/icash_prepare_seller_text_event','POST',{p_event:eventId});
 if(!reply)return {status:'no_seller_reply'};
 if(reply.messageId)return dispatch(reply.accountId,reply.messageId);
 if(reply.textAiJobId)return processAi(reply.accountId,reply.textAiJobId);
 return {status:'no_seller_reply'};
}
