import type {ReactNode} from 'react';
import {Phone,MessageCircle} from 'lucide-react';
import {analysisMoney,propertyAnalysisView} from '@/lib/property-analysis-view';
import {propertyAddressLines,type WorkspaceProperty} from './workspace-view';
import type {BotState} from '@/lib/workspace-guidance';
import type {dealCardSummary} from '@/lib/deal-card-summary';

export function PropertyCardHeader({property:p,owner,bot,dealSummary,phase,practice=false,active,sellerSummary,thumbnail,onToggle,onContact}:{property:WorkspaceProperty;owner?:string|null;bot:BotState;dealSummary:ReturnType<typeof dealCardSummary>;phase:string;practice?:boolean;active:boolean;sellerSummary?:string|null;thumbnail:ReactNode;onToggle:()=>void;onContact:(view:'texts'|'calls')=>void}){
 const address=propertyAddressLines(p.result.property.address),analysis=propertyAnalysisView(p.result);
 return <>
   <button type="button" className="property-summary" aria-expanded={active} aria-controls={`property-content-${p.id}`} onClick={()=>onToggle()}>
    {thumbnail}
    <span className="property-summary-main">
     <span className="property-address" id={`property-address-${p.id}`}><strong>{address.street}</strong>{address.location&&<span>{address.location}</span>}</span>
     {owner&&<span className="property-owner-name">{owner}</span>}
     <span className="property-summary-status">{practice&&<span className="property-manual-label">Practice only · no real property</span>}{dealSummary?.contractSigned&&<span className="property-status">{phase}</span>}</span>
     <span className={`property-bot-status tone-${bot.tone}`}><span className="ai-status-dot" aria-hidden="true"/>{bot.label}</span>
    </span>
    <span className="property-cash-preview" aria-label={dealSummary?.priceCents!=null?'Purchase price':'Estimated cash offer'}><small>{dealSummary?.priceCents!=null?'Purchase price':'Estimated cash offer'}</small><strong>{analysisMoney(dealSummary?.priceCents??analysis.cashOfferCeilingCents)}</strong></span>
    <span className="property-card-estimates"><span><small>Value after repairs</small><strong>{analysisMoney(analysis.arvCents)}</strong></span><span><small>Estimated repairs</small><strong>{analysisMoney(analysis.repairs.baselineCents)}</strong></span></span>
    <span className="property-open-control"><span>{active?'Close lead':'Open lead'}</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span>
   </button>
   {sellerSummary&&!active&&<p className="property-latest-update"><span>Latest update</span>{sellerSummary.length>150?sellerSummary.slice(0,147)+'…':sellerSummary}</p>}
   <div className="property-quick-actions"><button type="button" data-credit-action onClick={()=>onContact('calls')} aria-label={`Call ${address.street}`}><Phone size={16}/>Calls</button><button type="button" data-credit-action onClick={()=>onContact('texts')} aria-label={`Text conversation for ${address.street}`}><MessageCircle size={16}/>Texts</button></div>
 </>;
}
