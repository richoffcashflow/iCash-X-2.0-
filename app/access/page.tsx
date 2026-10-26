import type {Metadata} from 'next';
import {PurchaseAccountAccess} from '@/components/purchase-account-access';
import './access.css';
export const metadata:Metadata={title:'Open your account | iCash X',description:'Create or open your iCash X account using your checkout email.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function AccessPage(){return <PurchaseAccountAccess/>;}
