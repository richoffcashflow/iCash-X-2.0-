// Read-only deployment check. Never sends a synthetic conversion or prints a token.
import {sellerPixelId} from '../lib/seller-pixel.ts';
const env=process.env,token=env.META_SELLER_ACCESS_TOKEN||env.META_CAPI_ACCESS_TOKEN;
if(env.VERCEL_ENV!=='production'||env.META_SELLER_EVENTS_ENABLED!=='true'){
 console.log('HON Meta connection: not enabled in this build environment.');
}else if(env.META_SELLER_DATASET_ID!==sellerPixelId||!token||!/^v\d{1,3}\.0$/.test(env.META_GRAPH_VERSION||'')){
 console.log('HON Meta connection: setup required.');
}else{
 try{
  const response=await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${sellerPixelId}?fields=id`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(8000)});
  const result=await response.json();
  console.log(response.ok&&result.id===sellerPixelId?'HON Meta connection: pixel access verified.':`HON Meta connection: access not verified (HTTP ${response.status}, code ${Number(result.error?.code)||0}).`);
 }catch{console.log('HON Meta connection: read-only check unavailable.');}
}
