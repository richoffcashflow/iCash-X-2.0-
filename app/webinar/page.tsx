import type {Metadata} from 'next';
import {WebinarEntry} from '@/components/webinar-entry';
import {WebinarMediaConnection} from '@/components/webinar-media-connection';
import {WebinarPanelBoundary} from '@/components/webinar-panel-boundary';
import './webinar.css';
export const metadata:Metadata={title:'iCash X · Watch the session',description:'Watch CashFlowKey walk through the iCash X workspace, ask questions, and choose your next step.',robots:{index:false,follow:false}};
export default function WebinarPage(){return <><WebinarMediaConnection/><WebinarPanelBoundary label="Your webinar"><WebinarEntry/></WebinarPanelBoundary></>;}
