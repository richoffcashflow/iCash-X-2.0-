import {webinarMeasurementPath} from './webinar-pixel.ts';
/** Send privacy and click context with checkout, before any payment can happen. */
export function checkoutMeasurementHeaders():Record<string,string>{
 try{
  if((navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl||localStorage.getItem('wb-meta-choice')==='deny')return {'x-icash-measurement':'deny'};
  const params=new URLSearchParams(location.search);
  if(!webinarMeasurementPath(location.pathname)||params.has('preview')||location.pathname==='/'&&!document.querySelector('[data-public-checkout="true"]'))return {};
  const headers:Record<string,string>={'x-icash-measurement':'automatic'},click=params.get('fbclid');
  if(click&&/^[A-Za-z0-9_-]{1,400}$/.test(click))headers['x-icash-fbclid']=click;
  return headers;
 }catch{return {};}
}
