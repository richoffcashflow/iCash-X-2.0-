'use client';
import {IcashMark} from '@/components/icash-mark';
import {MembershipCheckout} from '@/components/membership-checkout';
export function WebinarUpgradePage(){return <main className="join-page webinar-upgrade-page"><header><a href="/" aria-label="iCash X home"><IcashMark/></a><a href="/support">Need help?</a></header><div className="webinar-upgrade-card"><MembershipCheckout redirectToVip embedded onSignedIn={()=>window.location.assign('/')}/></div></main>;}
