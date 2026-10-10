'use client';
import {ArrowUpRight,Crown,X} from 'lucide-react';

export function WorkspaceVipBanner({disabled=false,onUpgrade}:{disabled?:boolean;onUpgrade:()=>void}){
 return <section className="workspace-vip-banner" aria-label="Upgrade to VIP">
  <span className="vip-banner-icon" aria-hidden="true"><Crown size={23}/></span>
  <div className="vip-banner-copy"><strong>Give your bot the VIP advantage</strong><p>Save 20% on AI work and leads. Use your own voice.</p></div>
  <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={onUpgrade}>Upgrade to VIP <ArrowUpRight size={17} aria-hidden="true"/></button>
 </section>;
}

export type WorkspacePreviewMode='standard'|'vip';
export function AdminWorkspacePreview({mode,onChange,onExit}:{mode:WorkspacePreviewMode;onChange:(mode:WorkspacePreviewMode)=>void;onExit:()=>void}){
 return <section className="workspace-preview-bar" aria-label="Admin workspace preview">
  <div className="workspace-preview-copy"><strong>Admin preview</strong><span>Appearance only · Your plan is unchanged.</span></div>
  <div className="workspace-preview-options" role="group" aria-label="Workspace appearance">
   <button type="button" aria-pressed={mode==='standard'} onClick={()=>onChange('standard')}>Standard</button>
   <button type="button" aria-pressed={mode==='vip'} onClick={()=>onChange('vip')}><Crown size={14} aria-hidden="true"/> VIP</button>
  </div>
  <button type="button" className="workspace-preview-exit" onClick={onExit}><X size={15} aria-hidden="true"/> Exit preview</button>
 </section>;
}
