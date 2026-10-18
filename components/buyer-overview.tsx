import {ArrowUpRight,ChevronRight} from 'lucide-react';

export type BuyerMatch={buyer_id:string;name:string;rank:number;ready:boolean};
export type BuyerResponse={id:string;name:string;state:'interested'|'replied';reply:string|null};
export type BuyerNetworkProgress={matches:number;emailed:number;responses:number;buyers?:BuyerResponse[]};
export type BuyerSelection={kind:'response';buyer:BuyerResponse}|{kind:'match';buyer:BuyerMatch};
const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

/** These are recorded matches and replies, never a promise that a buyer will close. */
export function BuyerOverview({buyers,network,buyerPackage,pricingReview,outreachMessage,held=false,researchContinuing=false,onBuyer,onAllBuyers,onOpenPackage,showAll=false}:{buyers:BuyerMatch[];network?:BuyerNetworkProgress|null;buyerPackage?:{askingPriceCents:number;url:string}|null;pricingReview?:string|null;outreachMessage?:string|null;held?:boolean;researchContinuing?:boolean;onBuyer:(selection:BuyerSelection)=>void;onAllBuyers?:()=>void;onOpenPackage?:()=>void;showAll?:boolean}){
 const responses=network?.buyers??[];
 const people:BuyerSelection[]=[...responses.map(buyer=>({kind:'response' as const,buyer})),...buyers.map(buyer=>({kind:'match' as const,buyer}))];
 const visible=showAll?people:people.slice(0,3);
 return <section className="buyer-overview" aria-label="Buyer activity">
  <div className="buyer-overview-heading"><div><h3>{network?.responses?`${network.responses} buyer ${network.responses===1?'responded':'responses'}`:buyers.length?`${buyers.length} matching ${buyers.length===1?'buyer':'buyers'}`:researchContinuing?'Finding buyers':'Buyer activity'}</h3><p>{held?'Buyer outreach is paused. Review the deal hold in Help.':pricingReview??outreachMessage??(network?.emailed?`${network.emailed} packages sent`:researchContinuing?'Researching local buyers. Matches will appear here.':'Matches and replies will appear here as they are recorded.')}</p></div></div>
  {buyerPackage&&<div className="buyer-price-row"><div><small>Buyer asking price</small><strong>{money(buyerPackage.askingPriceCents)}</strong></div>{onOpenPackage?<button type="button" className="workspace-quiet" onClick={onOpenPackage}>View buyer package<ArrowUpRight size={15} aria-hidden="true"/></button>:<a href={buyerPackage.url} target="_blank" rel="noreferrer">View buyer package<ArrowUpRight size={15} aria-hidden="true"/></a>}</div>}
  <div className="buyer-response-list">{visible.map(selection=>{const b=selection.buyer;return <button type="button" key={selection.kind+('id' in b?b.id:b.buyer_id)} className="buyer-person buyer-row" aria-label={`View buyer ${b.name}`} aria-haspopup="dialog" onClick={()=>onBuyer(selection)}><span className="buyer-avatar" aria-hidden="true">{b.name.trim().slice(0,1).toUpperCase()}</span><span className="buyer-person-info"><strong>{b.name}</strong><small>{selection.kind==='response'?(selection.buyer.state==='interested'?'Interested':'Replied'):(selection.buyer.ready?'Match · Funds reviewed at last check':'Match · Funds need review')}</small>{selection.kind==='response'&&selection.buyer.reply&&<span className="buyer-reply-preview">{selection.buyer.reply}</span>}</span><ChevronRight size={17} aria-hidden="true"/></button>;})}</div>
  {onAllBuyers&&<button type="button" className="workspace-quiet buyer-all" aria-haspopup="dialog" onClick={onAllBuyers}>{people.length>3?`See all ${people.length} buyers`:'Buyer details'}</button>}
 </section>;
}
