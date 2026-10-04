import type {Metadata} from 'next';
import {WebinarStudio} from '@/components/webinar-studio';
import '../webinar/webinar.css';
export const metadata:Metadata={title:'iCash X · Webinar studio',robots:{index:false,follow:false}};
export default function StudioPage(){return <WebinarStudio/>;}
