'use client';
import {ArrowRight,Gem} from 'lucide-react';

export function WorkspaceVipBanner({disabled=false,onUpgrade}:{disabled?:boolean;onUpgrade:()=>void}){
 return <section className="workspace-vip-banner" aria-label="Upgrade to VIP">
  <span className="vip-banner-icon" aria-hidden="true"><Gem size={27} strokeWidth={1.5}/></span>
  <div className="vip-banner-copy"><strong>Keep more credits with VIP</strong><p>Ask AI Bot · Buyer Network · 30% off work + leads</p></div>
  <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={onUpgrade}>Explore VIP <ArrowRight size={17} aria-hidden="true"/></button>
 </section>;
}

export type AccountPlan='standard'|'vip';
export function AdminPlanToggle({plan,busy=false,onChange}:{plan:AccountPlan;busy?:boolean;onChange:(plan:AccountPlan)=>void}){
 return <section className="admin-plan-bar" aria-label="Admin account plan" aria-busy={busy}>
  <div className="admin-plan-copy"><strong aria-live="polite">{busy?'Switching account…':`Your account · ${plan==='vip'?'VIP':'Standard'}`}</strong><span>Admin only · No subscription charge. Usage uses credits.</span><p>{plan==='vip'?'VIP tools, discounts and priority are active.':'Standard tools are active. Bot name included.'}</p></div>
  <div className="admin-plan-control"><span aria-hidden="true">Standard</span><button type="button" role="switch" aria-label="VIP account access" aria-checked={plan==='vip'} disabled={busy} onClick={()=>onChange(plan==='vip'?'standard':'vip')}><span className="admin-plan-thumb"/></button><span aria-hidden="true">VIP</span></div>
 </section>;
}
