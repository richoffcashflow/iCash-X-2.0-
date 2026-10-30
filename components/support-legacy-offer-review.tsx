'use client';
import {useState} from 'react';
import {supportVerifiedLegacyOfferReply} from '@/lib/support-legacy-migration';
import {SupportMessageContent} from '@/components/support-message-content';

export function SupportLegacyOfferReview({disabled,onSend}:{disabled:boolean;onSend:()=>void}){
 const [verified,setVerified]=useState(false);
 return <details className="desk-details"><summary>Original iCash X 1.0 purchase review</summary>
  <p>Check the original receipt against purchase records and confirm it belongs to this customer. Their claim, visitor email, or a 2.0 payment alone is not proof. Do not post receipt details in chat.</p>
  <p><a href="https://resend.com/emails/receiving" target="_blank" rel="noopener noreferrer">Open receipt inbox</a>. Look for “iCash X 1.0 purchase proof” and match it to this customer.</p>
  <label><input type="checkbox" checked={verified} disabled={disabled} onChange={event=>setVerified(event.target.checked)}/> I reviewed the proof and verified this customer purchased iCash X 1.0.</label>
  <p><SupportMessageContent role="operator" content={supportVerifiedLegacyOfferReply}/></p>
  <button type="button" disabled={disabled||!verified} onClick={onSend}>Send verified two-month offer</button>
 </details>;
}
