import type {Metadata} from 'next';
import {BuyerNetworkPortal} from '@/components/buyer-network-portal';
export const metadata:Metadata={title:'Off-market properties | HomeOffer Network',description:'Join free. Set your buying preferences and receive matching off-market property packages.',robots:{index:false,follow:false}};
export default function Buyers(){return <BuyerNetworkPortal/>;}
