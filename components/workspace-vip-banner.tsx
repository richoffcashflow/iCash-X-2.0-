'use client';
import {ArrowRight,Crown,Gem,X} from 'lucide-react';

export function WorkspaceVipBanner({disabled=false,onUpgrade}:{disabled?:boolean;onUpgrade:()=>void}){
 return <section className="workspace-vip-banner" aria-label="Upgrade to VIP">
  <span className="vip-banner-icon" aria-hidden="true"><Gem size={27} strokeWidth={1.5}/></span>
  <div className="vip-banner-copy"><strong>More power with VIP</strong><p>Ask AI Bot · Buyer Network · 20% off work + leads</p></div>
  <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={onUpgrade}>Explore VIP <ArrowRight size={17} aria-hidden="true"/></button>
 </section>;
}

export type WorkspacePreviewMode='standard'|'vip';
export function AdminWorkspacePreview({mode,busy=false,onChange,onExit}:{mode:WorkspacePreviewMode;busy?:boolean;onChange:(mode:WorkspacePreviewMode)=>void;onExit:()=>void}){
 return <section className="workspace-preview-bar" aria-label="Admin workspace preview">
  <div className="workspace-preview-copy"><strong>{busy?'Updating preview…':'Admin preview'}</strong><span>{mode==='vip'?'VIP features enabled · Normal usage charges apply.':'Standard features · Bot name included.'}</span></div>
  <div className="workspace-preview-options" role="group" aria-label="Workspace plan preview">
   <button type="button" disabled={busy} aria-pressed={mode==='standard'} onClick={()=>onChange('standard')}>Standard</button>
   <button type="button" disabled={busy} aria-pressed={mode==='vip'} onClick={()=>onChange('vip')}><Crown size={14} aria-hidden="true"/> VIP</button>
  </div>
  <button type="button" disabled={busy} className="workspace-preview-exit" onClick={onExit}><X size={15} aria-hidden="true"/> Exit preview</button>
 </section>;
}
