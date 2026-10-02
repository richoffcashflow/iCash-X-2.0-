import OwnerAudioPhonePin from './owner-audio-phone-pin';
import OwnerAudioOnce from './owner-audio-once';
import ForwardingStatus from './forwarding-status';
import OwnerElevenLabsReadinessPanel from './owner-elevenlabs-readiness';
import OwnerElevenLabsAuthorization from './owner-elevenlabs-authorization';
export const metadata={title:'Private inbound audio test | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <><div style={{maxWidth:650,margin:'2rem auto',padding:'0 1.5rem'}}><ForwardingStatus/></div><OwnerElevenLabsReadinessPanel/><OwnerElevenLabsAuthorization/><OwnerAudioPhonePin/><OwnerAudioOnce/></>;}
