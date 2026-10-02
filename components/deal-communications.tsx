'use client';
import {useState} from 'react';
import {DealMessages} from './deal-messages';
import {DealEmail} from './deal-email';
export function DealCommunications({dealId,active}:{dealId:string;active:boolean}){
 const [emailOpen,setEmailOpen]=useState(false),[emailVisited,setEmailVisited]=useState(false);
 return <section className="deal-communications" aria-label="Messages"><DealMessages dealId={dealId} active={active}/><details className="conversation-email" onToggle={e=>{if(e.target===e.currentTarget){setEmailOpen(e.currentTarget.open);if(e.currentTarget.open)setEmailVisited(true);}}}><summary>Email history</summary>{emailVisited&&<DealEmail dealId={dealId} active={active&&emailOpen}/>}</details></section>;
}
