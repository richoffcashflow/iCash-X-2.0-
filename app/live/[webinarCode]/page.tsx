import {notFound} from 'next/navigation';
import {WebinarRoom} from '@/components/webinar-room';
import {WebinarPanelBoundary} from '@/components/webinar-panel-boundary';
import '../../webinar/webinar.css';
export {metadata} from '../../webinar/page';
export default async function LiveWebinarPage({params}:{params:Promise<{webinarCode:string}>}){
 const {webinarCode}=await params;
 if(!/^\d{6,12}$/.test(webinarCode))notFound();
 return <WebinarPanelBoundary label="Your webinar"><WebinarRoom webinarCode={webinarCode}/></WebinarPanelBoundary>;
}
