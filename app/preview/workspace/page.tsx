import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {WorkspacePreview} from './workspace-preview';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'iCash X workspace preview',robots:{index:false,follow:false}};
export default function Page(){
 if(process.env.VERCEL_ENV!=='preview'&&process.env.NODE_ENV!=='development')notFound();
 return <WorkspacePreview/>;
}
