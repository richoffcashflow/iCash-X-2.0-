type ReplayOffer = {id:string;at:number;replaySpots?:number|null};
type PurchaseCue = {at:number;name:string;kind:string};
export type ReplayOfferSpots = {total:number;remaining:number};

/** A recording illustration, never payment inventory or checkout eligibility. */
export function replayOfferSpots(offer:ReplayOffer, offers:ReplayOffer[], cues:PurchaseCue[], seconds:number):ReplayOfferSpots|null {
 const total=offer.replaySpots;
 if(!Number.isInteger(total)||!total||total<1||!Number.isFinite(seconds)||seconds<offer.at)return null;
 // A later offer starts a new batch. The same buyer appearing twice within
 // this batch is one simulated purchase, even if the CSV has duplicate rows.
 const nextAt=Math.min(...offers.filter(other=>other.at>offer.at).map(other=>other.at));
 const buyers=new Set(cues.filter(cue=>cue.kind==='purchase'&&cue.at>=offer.at&&cue.at<nextAt&&cue.at<=seconds)
  .map(cue=>cue.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean));
 return {total,remaining:Math.max(0,total-buyers.size)};
}
