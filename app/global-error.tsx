'use client';
import {WorkspaceErrorPage} from '@/components/workspace-error-page';
export default function GlobalError({retry}:{error:Error&{digest?:string};retry:()=>void}){
 return <html lang="en"><body style={{margin:0,background:'#fff'}}><WorkspaceErrorPage retry={retry}/></body></html>;
}
