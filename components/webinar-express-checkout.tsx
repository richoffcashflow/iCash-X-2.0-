'use client';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
export function WebinarExpressCheckout(){
 return <main className="wb-express"><div className="wb-express-card"><span className="wb-eyebrow">YOUR NEXT STEP</span><h1>Set up your AI bot.</h1><MembershipCheckout embedded onSignedIn={()=>window.location.assign(webinarSite.workspacePath)}/><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></div></main>;
}
