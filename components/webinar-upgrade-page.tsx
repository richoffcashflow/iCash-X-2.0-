'use client';
import Image from 'next/image';
import {MembershipCheckout} from '@/components/membership-checkout';
export function WebinarUpgradePage(){return <main className="join-page webinar-upgrade-page"><header><a href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={108} height={60}/></a><a href="/support">Need help?</a></header><div className="webinar-upgrade-card"><MembershipCheckout embedded onSignedIn={()=>window.location.assign('/')}/></div></main>;}
