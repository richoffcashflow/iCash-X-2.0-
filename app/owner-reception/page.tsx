import OutboundReadiness from './outbound-readiness';
import ReceptionForwarding from './reception-forwarding';
import ReceptionSetup from './reception-setup';
export const metadata={title:'Private reception setup | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <main style={{maxWidth:720,margin:'3rem auto',padding:'0 1.5rem'}}><h1>Reception setup</h1><p>Private controls for the existing iCash X number. Each change requires a fresh review and confirmation.</p><p><a href="/reception-recordings">View private incoming call recordings</a></p><ReceptionSetup/><ReceptionForwarding/><OutboundReadiness/></main>;}
