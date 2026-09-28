import type {Metadata} from 'next';
import VoiceTest from './voice-test';
export const metadata:Metadata={title:'iCash X — Private voice test',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <VoiceTest/>;}
