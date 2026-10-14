import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {webinarOwnerIdentity} from '@/lib/webinar-account-adapter';
import {WebinarExpressCheckout} from '@/components/webinar-express-checkout';

export const metadata:Metadata={title:'iCash X · Customer checkout preview',robots:{index:false,follow:false}};
export default async function CheckoutPreviewPage({searchParams}:{searchParams:Promise<{webinar?:string;variant?:string}>}){
 const params=await searchParams;
 const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.webinar??'')?params.webinar:null;
 const query=id?`?webinar=${id}&variant=${params.variant==='night'?'night':'day'}`:'';
 let owner=null;
 try{owner=await webinarOwnerIdentity();}catch(e){if(!(e instanceof Error)||e.message!=='DASHBOARD_PASSWORD_REQUIRED')throw e;}
 if(!owner)redirect(`/dashboard-unlock?next=${encodeURIComponent('/webinar/checkout/preview'+query)}`);
 return <WebinarExpressCheckout preview previewBackHref={id?`/webinar?preview=${id}&variant=${params.variant==='night'?'night':'day'}`:'/webinar-studio'}/>;
}
