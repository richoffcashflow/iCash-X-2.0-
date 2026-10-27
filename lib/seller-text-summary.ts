export type SellerTextSummary={screening_id:string;thread_id:string;message_id:string;preview:string;received_at:string;unread_count:number};
export type TextReplyCounts={properties:number;unreadProperties:number;unreadMessages:number};
export function replyTime(at:string){
 const date=new Date(at);
 return Number.isFinite(date.getTime())?date.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'Time unavailable';
}
