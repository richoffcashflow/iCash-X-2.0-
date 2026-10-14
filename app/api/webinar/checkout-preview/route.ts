import {membershipOffer} from '@/lib/membership';
import {webinarOwner,webinarError,webinarHeaders} from '@/lib/webinar-server';

/** Read-only customer presentation: never loads the owner's purchases or Stripe. */
export async function GET(){try{
 await webinarOwner();
 const offer=await membershipOffer();
 return Response.json({offer,ready:offer.enabled,mode:'live',embeddedReady:true,needsClaim:false,customerName:'',email:null,membership:null,postPurchaseUrl:null},{headers:webinarHeaders});
}catch(error){return webinarError(error);}}
