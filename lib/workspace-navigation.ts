import type {DealSection} from './workspace-guidance.ts';
/** Opens existing controls only. Never sends, signs, saves or changes work controls. */
export function revealWorkspaceSection(target:HTMLElement|null){
 if(!target)return false;
 for(let node:HTMLElement|null=target;node;node=node.parentElement)if(node.tagName==='DETAILS')(node as HTMLDetailsElement).open=true;
 const panel=target.closest?.('[data-workspace-panel]');
 if(panel){
  if(!panel.querySelector?.('dialog')?.open){panel.dispatchEvent(new Event('workspace:open'));return true;}
  if(target===panel||target.hidden){panel.querySelector<HTMLElement>('h3')?.focus();return true;}
 }
 target.tabIndex=-1;target.scrollIntoView({block:'start',behavior:'auto'});target.focus({preventScroll:true});
 return true;
}
export function openDealSection(origin:HTMLElement,section:DealSection){
 const target=section==='attention'?document.getElementById('workspace-attention'):origin.closest('.live-property')?.querySelector<HTMLElement>(`[data-deal-section="${section}"]`)??null;
 return revealWorkspaceSection(target);
}
