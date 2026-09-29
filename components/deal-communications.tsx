'use client';
import {useState} from 'react';
import {DealMessages} from './deal-messages';
import {DealEmail} from './deal-email';
export function DealCommunications({dealId,active}:{dealId:string;active:boolean}){
 const [channel,setChannel]=useState<'text'|'email'>('text'),[emailVisited,setEmailVisited]=useState(false);
 return <section className="deal-communications" aria-label="Messages"><div className="message-channels" aria-label="Message type"><button aria-pressed={channel==='text'} onClick={()=>setChannel('text')}>Text</button><button aria-pressed={channel==='email'} onClick={()=>{setChannel('email');setEmailVisited(true);}}>Email</button></div><div hidden={channel!=='text'}><DealMessages dealId={dealId} active={active&&channel==='text'}/></div>{emailVisited&&<DealEmail dealId={dealId} active={active&&channel==='email'}/>}</section>;
}
