import type {Metadata} from 'next';
import {currentPrivateInvite} from '@/lib/private-access';
import {PrivateAccess} from '@/components/private-access';
import './private-access.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Your private invitation | iCash X 2.0',description:'Create your iCash X 2.0 account.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function PrivateAccessPage(){
 try{return <PrivateAccess available={!!await currentPrivateInvite()}/>;}
 catch{return <PrivateAccess available={false} unavailable/>;}
}
