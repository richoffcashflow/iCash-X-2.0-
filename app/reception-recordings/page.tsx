import {ReceptionRecordings} from '@/components/reception-recordings';
export const metadata={title:'Private incoming recordings | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <main style={{maxWidth:840,margin:'3rem auto',padding:'0 1.5rem'}}><a href="/owner-reception">Reception setup</a><h1>Incoming call recordings</h1><ReceptionRecordings/></main>;}
