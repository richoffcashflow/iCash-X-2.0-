'use client';
import {WorkspaceErrorPage} from '@/components/workspace-error-page';
export default function ErrorPage({retry}:{error:Error&{digest?:string};retry:()=>void}){
 return <WorkspaceErrorPage retry={retry}/>;
}
