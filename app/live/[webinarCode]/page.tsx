import {notFound} from 'next/navigation';
import {WebinarEntry} from '@/components/webinar-entry';
import {WebinarMediaConnection} from '@/components/webinar-media-connection';
import {WebinarPanelBoundary} from '@/components/webinar-panel-boundary';
import '../../webinar/webinar.css';
export {metadata} from '../../webinar/page';
export default async function LiveWebinarPage({params}:{params:Promise<{webinarCode:string}>}){
 const {webinarCode}=await params;
 if(!/^\d{6,12}$/.test(webinarCode))notFound();
 return <><WebinarMediaConnection/><WebinarPanelBoundary label="Your webinar"><WebinarEntry webinarCode={webinarCode}/></WebinarPanelBoundary></>;
}
