import type {TimedOffer} from './index.ts';

/** Resolve the saved first deadline. Missing countdown receipts keep offers closed. */
export function withOfferDeadlines<T extends TimedOffer>(offers:T[], deadlines:Record<string,string>):T[]{
 return offers.map(offer=>{
  if(!offer.durationSeconds)return offer;
  const saved=Date.parse(deadlines[offer.id]??'');
  if(!Number.isFinite(saved))return {...offer,expiresAt:'1970-01-01T00:00:00.000Z'};
  const fixed=Date.parse(offer.expiresAt??'');
  return {...offer,expiresAt:new Date(Number.isFinite(fixed)?Math.min(saved,fixed):saved).toISOString()};
 });
}
