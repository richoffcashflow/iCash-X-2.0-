import type {Metadata} from 'next';
import {MessagingAdmin} from '@/components/messaging-admin';
import '../webinar/webinar.css';
import './messaging.css';
export const metadata:Metadata={title:'iCash X · Messaging',robots:{index:false,follow:false}};
export default function MessagingPage(){return <MessagingAdmin/>;}
