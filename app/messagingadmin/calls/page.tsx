import type {Metadata} from 'next';
import {BusinessPhoneSettings} from '@/components/business-phone-settings';
export const metadata:Metadata={title:'iCash X · Calls',robots:{index:false,follow:false}};
export default function CallsPage(){return <BusinessPhoneSettings/>;}
