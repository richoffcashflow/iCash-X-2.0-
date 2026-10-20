import type {Metadata} from 'next';
import {LegacyLaunchDashboard} from '@/components/legacy-launch-dashboard';
export const metadata:Metadata={title:'Customer launch | iCash X',robots:{index:false,follow:false}};
export default function LaunchPage(){return <LegacyLaunchDashboard/>;}
