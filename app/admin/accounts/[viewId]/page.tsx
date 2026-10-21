import type {Metadata} from 'next';
import {CustomerAccountView} from '../customer-view';
export const metadata:Metadata={title:'Customer workspace | iCash X Admin',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function CustomerViewPage({params}:{params:Promise<{viewId:string}>}){const {viewId}=await params;return <CustomerAccountView key={viewId} viewId={viewId}/>;}
