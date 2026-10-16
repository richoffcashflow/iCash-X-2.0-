'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import type {WebinarPurchaseListener} from '@/lib/webinar-purchase-flow';
import {webinarSite} from '@/lib/webinar-site';
import {navigateWebinar} from '@/lib/webinar-exit-reminder';
/** Replace this adapter when embedding the webinar engine in another product. */
export function WebinarCheckout({preview=false,stayOnWebinar=false,vipWebinar=false,onEngaged,sessionId,phase='watching',onPurchased,onUpgradeActive}:{stayOnWebinar?:boolean;vipWebinar?:boolean;phase?:'watching'|'ended';onPurchased?:WebinarPurchaseListener;onUpgradeActive?:(active:boolean)=>void;sessionId?:string;preview?:boolean;onEngaged?:()=>void}){

 return <MembershipCheckout stayOnWebinar={stayOnWebinar} preview={preview} vipWebinar={vipWebinar} presentation="webinar" embedded webinarSessionId={sessionId} webinarPhase={phase} onPurchased={onPurchased} onUpgradeActive={onUpgradeActive} onEngaged={onEngaged} onSignedIn={()=>navigateWebinar(webinarSite.workspacePath)}/>;
}
