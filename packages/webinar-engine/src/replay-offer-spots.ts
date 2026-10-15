type ReplayOffer = {id:string;at:number;replaySpots?:number|null};
type PurchaseCue = {at:number;name:string;kind:string;location?:string};
export type ReplayOfferSpots = {total:number;remaining:number};

function purchasesForOffer(offer:ReplayOffer,offers:ReplayOffer[],cues:PurchaseCue[],seconds:number){
 const nextAt=Math.min(...offers.filter(other=>other.at>offer.at).map(other=>other.at));
 const seen=new Set<string>();
 return cues.filter(cue=>cue.kind==='purchase'&&cue.at>=offer.at&&cue.at<nextAt&&cue.at<=seconds).sort((a,b)=>a.at-b.at).filter(cue=>{
  const name=cue.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  if(!name||seen.has(name))return false;seen.add(name);return true;
 });
}

/** A recording illustration, never payment inventory or checkout eligibility. */
export function replayOfferSpots(offer:ReplayOffer, offers:ReplayOffer[], cues:PurchaseCue[], seconds:number):ReplayOfferSpots|null {
 const total=offer.replaySpots;
 if(!Number.isInteger(total)||!total||total<1||!Number.isFinite(seconds)||seconds<offer.at)return null;
 // A later offer starts a new batch. The same buyer appearing twice within
 // this batch is one simulated purchase, even if the CSV has duplicate rows.
 return {total,remaining:Math.max(0,total-purchasesForOffer(offer,offers,cues,seconds).length)};
}

/** Recorded activity follows playback even when a wall-clock offer timer closes. */
export function replayOfferActivity(offers:ReplayOffer[],cues:PurchaseCue[],seconds:number){
 const offer=Number.isFinite(seconds)?offers.filter(offer=>offer.at<=seconds).sort((a,b)=>a.at-b.at).at(-1):undefined;
 if(!offer)return {spots:null,purchase:null};
 const purchase=purchasesForOffer(offer,offers,cues,seconds).at(-1);
 return {spots:replayOfferSpots(offer,offers,cues,seconds),purchase:purchase&&seconds-purchase.at<6?purchase:null};
}
