'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import type {WebinarPurchaseState} from '@/lib/webinar-purchase-flow';
import {webinarSite} from '@/lib/webinar-site';
/** Replace this adapter when embedding the webinar engine in another product. */
export function WebinarCheckout({preview=false,onEngaged,sessionId,phase='watching',onPurchased,onUpgradeActive}:{phase?:'watching'|'ended';onPurchased?:(state:WebinarPurchaseState)=>void;onUpgradeActive?:(active:boolean)=>void;sessionId?:string;preview?:boolean;onEngaged?:()=>void}){
 if(preview)return <div className="wb-checkout-preview"><strong>Your checkout appears here</strong><p>Visitors review the current price, pay securely, then see the VIP upgrade. Upgrading opens setup; skipping opens their Day or Night VIP session after the webinar. Payments are disabled in owner previews.</p></div>;
 return <MembershipCheckout embedded webinarSessionId={sessionId} webinarPhase={phase} onPurchased={onPurchased} onUpgradeActive={onUpgradeActive} onEngaged={onEngaged} onSignedIn={()=>window.location.assign(webinarSite.workspacePath)}/>;
}
