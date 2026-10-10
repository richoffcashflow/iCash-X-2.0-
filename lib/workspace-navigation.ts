import type {DealSection} from './workspace-guidance.ts';
/** Opens existing controls only. Never sends, signs, saves or changes work controls. */
export function revealWorkspaceSection(target:HTMLElement|null){
 if(!target)return false;
 for(let node:HTMLElement|null=target;node;node=node.parentElement)if(node.tagName==='DETAILS')(node as HTMLDetailsElement).open=true;
 target.tabIndex=-1;target.scrollIntoView({block:'start',behavior:'auto'});target.focus({preventScroll:true});
 return true;
}
export function openDealSection(origin:HTMLElement,section:DealSection){
 const target=section==='attention'?document.getElementById('workspace-attention'):origin.closest('.live-property')?.querySelector<HTMLElement>(`[data-deal-section="${section}"]`)??null;
 return revealWorkspaceSection(target);
}
