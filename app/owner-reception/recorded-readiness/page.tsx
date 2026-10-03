import {workAccount} from '@/lib/work-account';
import {receptionTarget} from '@/lib/general-reception';
import RecordedIncomingReadiness from './readiness';
export const dynamic='force-dynamic';
export const metadata={title:'Incoming recording provider check | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page(){
 let owner=false;try{const account=await workAccount();owner=account.accountId===receptionTarget.accountId&&account.userId===receptionTarget.ownerUserId;}catch{}
 return <main style={{maxWidth:760,margin:'3rem auto',padding:'0 1.5rem',lineHeight:1.6}}><h1>Incoming recording provider check</h1>{owner?<RecordedIncomingReadiness/>:<p>Sign in as the configured account owner to read provider readiness.</p>}<p><a href="/owner-reception">Back to reception setup</a></p></main>;
}
