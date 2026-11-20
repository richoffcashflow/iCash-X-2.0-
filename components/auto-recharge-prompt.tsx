'use client';

import {useEffect,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
import styles from '@/app/workspace-easy.module.css';

export function AutoRechargePrompt({onSetup}:{onSetup:()=>void}){
 const [enabled,setEnabled]=useState<boolean|null>(null);
 useEffect(()=>{
  let active=true,checking=false;
  function check(){
   if(checking)return;
   checking=true;
   void workspaceRequest<{enabled:boolean}>('/api/funding/auto-recharge',{cache:'no-store'})
    .then(status=>{if(active)setEnabled(status.enabled);})
    .catch(()=>{if(active)setEnabled(null);})
    .finally(()=>{checking=false;});
  }
  check();
  window.addEventListener('focus',check);
  return ()=>{active=false;window.removeEventListener('focus',check);};
 },[]);
 if(enabled!==false)return null;
 return <section className={styles.rechargePrompt} aria-label="Auto recharge">
  <div><strong>Auto recharge is off</strong>
   <p>Choose an amount and enable auto recharge at checkout. When your credits drop below $5, we’ll add that amount up to once every 24 hours.</p>
  </div>
  <button type="button" className="fund-button" onClick={onSetup}>Set up auto recharge</button>
 </section>;
}
