'use client';
import {ArrowRight,Gem} from 'lucide-react';
import styles from './workspace-vip-banner.module.css';

type VipBannerAction={onUpgrade:()=>void;disabled?:boolean;href?:never}|{href:string;onUpgrade?:never;disabled?:never};
export function WorkspaceVipBanner({disabled=false,onUpgrade,href}:VipBannerAction){
 const action=<>Upgrade to VIP <ArrowRight size={19} aria-hidden="true"/></>;
 return <section className={styles.banner} aria-label="Upgrade to VIP">
  <span className={styles.icon} aria-hidden="true"><Gem size={30} strokeWidth={1.7}/></span>
  <div className={styles.copy}><span className={styles.eyebrow}>iCash X VIP</span><h2>Unlock VIP. Get more from every credit.</h2><p><strong>30% off AI work + leads</strong><span>Ask AI Bot · Buyer Network · Custom AI voice</span></p></div>
  {href?<a className={styles.cta} href={href}>{action}</a>:<button className={styles.cta} type="button" disabled={disabled} aria-haspopup="dialog" onClick={onUpgrade}>{action}</button>}
 </section>;
}

export type AccountPlan='standard'|'vip';
export function AdminPlanToggle({plan,busy=false,onChange}:{plan:AccountPlan;busy?:boolean;onChange:(plan:AccountPlan)=>void}){
 return <section className="admin-plan-bar" aria-label="Admin account plan" aria-busy={busy}>
  <div className="admin-plan-copy"><strong aria-live="polite">{busy?'Switching account…':`Your account · ${plan==='vip'?'VIP':'Standard'}`}</strong><span>Admin only · No subscription charge. Usage uses credits.</span><p>{plan==='vip'?'VIP tools, discounts and priority are active.':'Standard tools are active. Bot name included.'}</p></div>
  <div className="admin-plan-control"><span aria-hidden="true">Standard</span><button type="button" role="switch" aria-label="VIP account access" aria-checked={plan==='vip'} disabled={busy} onClick={()=>onChange(plan==='vip'?'standard':'vip')}><span className="admin-plan-thumb"/></button><span aria-hidden="true">VIP</span></div>
 </section>;
}
