import type {ReplayOfferSpots} from '@/packages/webinar-engine/src/replay-offer-spots';

export function WebinarOfferSpots({spots,compact=false}:{spots:ReplayOfferSpots|null;compact?:boolean}){
 if(!spots)return null;
 return <div className={`wb-offer-spots${compact?' wb-offer-spots-compact':''}`}>
  <div className="wb-spots-heading"><span>Replay · simulated spots</span><strong aria-live="polite" aria-atomic="true">{spots.remaining} of {spots.total} left</strong></div>
  <div className="wb-spots-bar" role="meter" aria-label="Simulated spots remaining in replay" aria-valuemin={0} aria-valuemax={spots.total} aria-valuenow={spots.remaining}>
   <span style={{width:`${spots.remaining/spots.total*100}%`}}/>
  </div>
 </div>;
}
