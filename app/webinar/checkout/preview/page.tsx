import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {webinarOwnerIdentity} from '@/lib/webinar-account-adapter';
import {WebinarExpressCheckout} from '@/components/webinar-express-checkout';
import {WebinarUpgradePage} from '@/components/webinar-upgrade-page';

export const metadata:Metadata={title:'iCash X · Customer checkout preview',robots:{index:false,follow:false}};
export default async function CheckoutPreviewPage({searchParams}:{searchParams:Promise<{webinar?:string;variant?:string;vip?:string}>}){
 const params=await searchParams;
 const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.webinar??'')?params.webinar:null;
 const query=(id?`?webinar=${id}&variant=${params.variant==='night'?'night':'day'}`:'')+(params.vip==='1'?(id?'&':'?')+'vip=1':'');
 let owner=null;
 try{owner=await webinarOwnerIdentity();}catch(e){if(!(e instanceof Error)||e.message!=='DASHBOARD_PASSWORD_REQUIRED')throw e;}
 if(!owner)redirect(`/dashboard-unlock?next=${encodeURIComponent('/webinar/checkout/preview'+query)}`);
 const backHref=id?`/webinar?preview=${id}&variant=${params.variant==='night'?'night':'day'}`:'/webinar-studio';
 return params.vip==='1'?<WebinarUpgradePage preview previewBackHref={backHref}/>:<WebinarExpressCheckout preview previewBackHref={backHref}/>;
}
