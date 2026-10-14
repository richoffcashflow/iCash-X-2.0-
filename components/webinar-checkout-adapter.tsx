'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import type {WebinarPurchaseState} from '@/lib/webinar-purchase-flow';
import {webinarSite} from '@/lib/webinar-site';
/** Replace this adapter when embedding the webinar engine in another product. */
export function WebinarCheckout({preview=false,onEngaged,sessionId,phase='watching',onPurchased,onUpgradeActive}:{phase?:'watching'|'ended';onPurchased?:(state:WebinarPurchaseState)=>void;onUpgradeActive?:(active:boolean)=>void;sessionId?:string;preview?:boolean;onEngaged?:()=>void}){

 return <MembershipCheckout preview={preview} presentation="webinar" embedded webinarSessionId={sessionId} webinarPhase={phase} onPurchased={onPurchased} onUpgradeActive={onUpgradeActive} onEngaged={onEngaged} onSignedIn={()=>window.location.assign(webinarSite.workspacePath)}/>;
}
