'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
/** Replace this adapter when embedding the webinar engine in another product. */
export function WebinarCheckout({preview=false,onEngaged,sessionId}:{sessionId?:string;preview?:boolean;onEngaged?:()=>void}){
 if(preview)return <div className="wb-checkout-preview"><strong>Your checkout appears here</strong><p>Visitors review the current price, pay securely, then enter their Day or Night VIP session. Payments are disabled in owner previews.</p></div>;
 return <MembershipCheckout embedded webinarSessionId={sessionId} onEngaged={onEngaged} onSignedIn={()=>window.location.assign(webinarSite.workspacePath)}/>;
}
