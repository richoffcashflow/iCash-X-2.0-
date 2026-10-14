import {Users,ArrowUpRight} from 'lucide-react';

export type BuyerMatch={buyer_id:string;name:string;rank:number;ready:boolean};
export type BuyerResponse={id:string;name:string;state:'interested'|'replied';reply:string|null};
export type BuyerNetworkProgress={matches:number;emailed:number;responses:number;buyers?:BuyerResponse[]};
const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

/** These are recorded matches and replies, never a promise that a buyer will close. */
export function BuyerOverview({buyers,network,buyerPackage,pricingReview,held=false,researchContinuing=false,onResponses,onOpenPackage}:{buyers:BuyerMatch[];network?:BuyerNetworkProgress|null;buyerPackage?:{askingPriceCents:number;url:string}|null;pricingReview?:string|null;held?:boolean;researchContinuing?:boolean;onResponses?:()=>void;onOpenPackage?:()=>void}){
 const responses=network?.buyers??[];
 return <section className="buyer-overview" aria-label="Buyer activity">
  <div className="buyer-overview-heading"><span className="buyer-overview-icon"><Users size={20} aria-hidden="true"/></span><div><h4>{network?.responses?`${network.responses} buyer ${network.responses===1?'response':'responses'}`:buyers.length?`${buyers.length} buyer ${buyers.length===1?'match':'matches'}`:'Finding buyers'}</h4><p>{held?'Buyer outreach is paused. Review the deal hold in Help.':pricingReview??(responses.length?'Review the replies below. Interest does not reserve the property.':buyers.length?'Review funds and signing authority before sending an assignment.':researchContinuing?'Your bot is researching the next group of local buyers.':'Buyer matches and replies will appear here as they are recorded.')}</p></div></div>
  {buyerPackage&&<div className="buyer-price-row"><div><small>Buyer asking price</small><strong>{money(buyerPackage.askingPriceCents)}</strong></div>{onOpenPackage?<button type="button" className="workspace-quiet" onClick={onOpenPackage}>View buyer package<ArrowUpRight size={15} aria-hidden="true"/></button>:<a href={buyerPackage.url} target="_blank" rel="noreferrer">View buyer package<ArrowUpRight size={15} aria-hidden="true"/></a>}</div>}
  {network&&<p className="buyer-activity-totals">{network.matches} network matches <span aria-hidden="true">·</span> {network.emailed} packages sent</p>}
  {responses.length>0&&<div className="buyer-response-list">{responses.slice(0,3).map(b=><article key={b.id} className="buyer-person"><span className="buyer-avatar" aria-hidden="true">{b.name.trim().slice(0,1).toUpperCase()}</span><div><strong>{b.name}</strong><small>{b.state==='interested'?'Interested':'Replied'} · Funds & authority need review</small>{b.reply&&<p>{b.reply}</p>}</div></article>)}</div>}
  {!!network?.responses&&onResponses&&<button type="button" className="workspace-quiet" onClick={onResponses}>Review buyer responses</button>}
  {buyers.length>0&&<details className="buyer-matches"><summary>Matched buyers ({buyers.length})</summary><div className="buyer-response-list">{buyers.map(b=><article key={b.buyer_id} className="buyer-person"><span className="buyer-avatar" aria-hidden="true">{b.name.trim().slice(0,1).toUpperCase()}</span><div><strong>{b.name}</strong><small>{b.ready?'Funds & authority verified at last check':'Funds & authority need review'}</small></div></article>)}</div></details>}
 </section>;
}
