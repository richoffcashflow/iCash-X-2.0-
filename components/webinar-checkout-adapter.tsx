'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
/** Replace this adapter when embedding the webinar engine in another product. */
export function WebinarCheckout({preview=false,onEngaged}:{preview?:boolean;onEngaged?:()=>void}){
 if(preview)return <div className="wb-checkout-preview"><strong>Your checkout appears here</strong><p>Visitors review the current price, pay securely, then name their bot. Payments are disabled in owner previews.</p></div>;
 return <MembershipCheckout embedded onEngaged={onEngaged} onSignedIn={()=>window.location.assign(webinarSite.workspacePath)}/>;
}
