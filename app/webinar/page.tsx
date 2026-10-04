import type {Metadata} from 'next';
import {WebinarRoom} from '@/components/webinar-room';
import './webinar.css';
export const metadata:Metadata={title:'iCash X · Watch the session',description:'Watch CashFlowKey walk through the iCash X workspace, ask questions, and choose your next step.',robots:{index:false,follow:false}};
export default function WebinarPage(){return <WebinarRoom/>;}
