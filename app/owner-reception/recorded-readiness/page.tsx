import RecordedIncomingReadiness from './readiness';
export const dynamic='force-dynamic';
export const metadata={title:'Incoming recording provider check | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
// Render only the inert client shell here. Owner authentication (including
// refresh-cookie writes) belongs to the guarded API route, as on owner checks.
export default function Page(){
 return <main style={{maxWidth:760,margin:'3rem auto',padding:'0 1.5rem',lineHeight:1.6}}><h1>Incoming recording provider check</h1><RecordedIncomingReadiness/><p><a href="/owner-reception">Back to reception setup</a></p></main>;
}
