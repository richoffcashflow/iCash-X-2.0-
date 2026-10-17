import type {Metadata} from 'next';

function shareImage(siteName:string,url:string,width:number,height:number,alt:string):Metadata{
 return {
  openGraph:{type:'website',siteName,images:[{url,secureUrl:url,type:'image/png',width,height,alt}]},
  twitter:{card:'summary_large_image',images:[{url,alt,width,height}]},
 };
}

// Public, stable assets work without a session or client-side JavaScript.
// Titles and descriptions inherit from each page's existing metadata.
export const icashShareMetadata=shareImage('iCash X','https://www.geticashx.com/webinar-offer-icash-x.png',1672,941,'iCash X — Your AI wholesaling workspace, shown on a laptop.');
export const homeOfferShareMetadata:Metadata={...shareImage('HomeOffer Network','https://homeoffernetwork.com/homeoffer-network-logo.png',1254,1254,'HomeOffer Network'),description:'Connect with independent home buyers through HomeOffer Network.'};
