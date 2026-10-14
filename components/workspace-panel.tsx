'use client';
import {Activity,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';

/** Optional tools open in place. Closing a panel preserves its unsaved forms. */
export function WorkspacePanel({title,label,section,aliases=[],children,keepActive=false,id,onOpenChange}:{title:string;label?:ReactNode;section?:string;aliases?:string[];children:ReactNode;keepActive?:boolean;id?:string;onOpenChange?:(open:boolean)=>void}){
 const heading=useId(),root=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null);
 const [open,setOpen]=useState(false),[visited,setVisited]=useState(keepActive);
 function show(){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setVisited(true);setOpen(true);}
 useEffect(()=>{const node=root.current;if(!node)return;const reveal=()=>show();node.addEventListener('workspace:open',reveal);return()=>node.removeEventListener('workspace:open',reveal);},[]);
 useEffect(()=>{onOpenChange?.(open);},[open,onOpenChange]);
 useEffect(()=>{const node=dialog.current;if(!node)return;if(open){if(!node.open)node.showModal();}else if(node.open)node.close();return()=>{if(node.open)node.close();};},[open]);
 function close(){setOpen(false);if(opener.current?.isConnected)opener.current.focus({preventScroll:true});}
 return <div ref={root} id={id} className="workspace-panel" data-workspace-panel data-deal-section={section}>
  {aliases.map(alias=><span hidden key={alias} data-deal-section={alias}/>)}
  {label&&<button type="button" className="workspace-quiet workspace-panel-trigger" aria-haspopup="dialog" onClick={show}>{label}</button>}
  <dialog ref={dialog} className="property-contact-dialog workspace-detail-dialog" aria-labelledby={heading} onClose={close} onCancel={()=>setOpen(false)}>
   <div className="contact-dialog-heading"><h3 id={heading} tabIndex={-1}>{title}</h3><button type="button" className="contact-dialog-close" aria-label={`Close ${title}`} onClick={()=>setOpen(false)}><X size={20} aria-hidden="true"/></button></div>
   {(visited||keepActive)&&<Activity mode={open||keepActive?'visible':'hidden'}><div className="workspace-panel-body">{children}</div></Activity>}
  </dialog>
 </div>;
}
