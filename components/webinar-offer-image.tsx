'use client';
import {defaultWebinarOfferImage,webinarOfferImage,type WebinarOffer} from '@/lib/webinar-policy';

export function WebinarOfferImage({offer,className}:{offer:Pick<WebinarOffer,'imageUrl'>;className?:string}){
 return <img key={offer.imageUrl||'default'} className={className} src={webinarOfferImage(offer)} alt="iCash X — your AI wholesaling workspace" width={1672} height={940} onError={event=>{
  const image=event.currentTarget;
  if(image.getAttribute('src')!==defaultWebinarOfferImage)image.src=defaultWebinarOfferImage;
 }}/>
}
