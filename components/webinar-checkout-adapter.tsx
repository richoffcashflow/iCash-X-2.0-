'use client';
import dynamic from 'next/dynamic';
/** Company checkout integration; the shared room owns timing and layout. */
const CompanyCheckout=dynamic(()=>import('@/app/join/page'),{loading:()=> <p role="status">Loading your current options…</p>});
export function WebinarCheckout(){return <CompanyCheckout/>;}
