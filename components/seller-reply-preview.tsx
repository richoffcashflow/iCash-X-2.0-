'use client';
import {MessageCircle,ArrowUpRight} from 'lucide-react';
import {replyTime,type SellerTextSummary} from '@/lib/seller-text-summary';
import './seller-reply-preview.css';
export function SellerReplyPreview({reply,onOpen}:{reply:SellerTextSummary;onOpen:()=>void}){
 return <button type="button" className="seller-reply-preview" data-unread={reply.unread_count>0} onClick={onOpen} aria-label={`Open seller reply${reply.unread_count>0?`, ${reply.unread_count} unread ${reply.unread_count===1?'text':'texts'}`:''}`}>
  <span className="seller-reply-heading"><MessageCircle size={16} aria-hidden="true"/><strong>{reply.unread_count>0?'Unread seller reply':'Seller replied'}</strong>{reply.unread_count>0&&<b className="text-unread-count">{reply.unread_count}</b>}<time dateTime={reply.received_at}>{replyTime(reply.received_at)}</time></span>
  <span className="seller-reply-body">{reply.preview.trim()||'Sent an attachment'}</span><span className="seller-reply-open">Open texts <ArrowUpRight size={14} aria-hidden="true"/></span>
 </button>;
}
