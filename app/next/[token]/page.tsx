import {DealJourneyPortal} from '@/components/deal-journey-portal';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Your next step | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page({params}:{params:Promise<{token:string}>}){
 const {token}=await params;return <DealJourneyPortal token={/^[a-f0-9]{32}$/.test(token)?token:''}/>;
}
