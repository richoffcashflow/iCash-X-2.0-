'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';

export function FundingDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),heading=useId();
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  node.showModal();document.body.style.overflow='hidden';
  return()=>{node.close();document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <dialog ref={dialog} className="funding-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();}}}>
  <div className="funding-dialog-heading"><h2 id={heading}>{title}</h2><button type="button" autoFocus aria-label="Close" onClick={onClose}><X size={20}/></button></div>
  {children}
 </dialog>;
}
