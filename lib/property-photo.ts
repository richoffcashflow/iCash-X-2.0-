/** Only URLs returned by DealMachine; never build imagery from guessed coordinates. */
export type PropertyPhoto={url:string;source:'DealMachine';view:'street_view'|'satellite';fallbackUrl?:string};
export function dealMachinePhoto(images:unknown):PropertyPhoto|null{
 if(!images||typeof images!=='object'||Array.isArray(images))return null;
 const values=images as Record<string,unknown>;
 for(const view of ['street_view','satellite'] as const){
  const value=values[view];if(typeof value!=='string'||value.length>2048)continue;
  try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='img.dealmachine.com'||url.port||url.username||url.password||url.hash)continue;
   if(!url.pathname.startsWith(view==='street_view'?'/sv/':'/sat/'))continue;
   return {url:url.href,source:'DealMachine',view};
  }catch{/* Missing or malformed provider imagery stays unavailable. */}
 }
 return null;
}

/** Documented provider CDN contract; only call with ID-matched API coordinates.
 * https://api.docs.dealmachine.com/concepts/response-format#images
 */
export function coordinatePropertyPhoto(latitude:unknown,longitude:unknown):PropertyPhoto|null{
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude===0||longitude===0||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 const coordinates=`${latitude},${longitude}`;
 return {url:`https://img.dealmachine.com/sv/${coordinates}.jpg`,fallbackUrl:`https://img.dealmachine.com/sat/${coordinates}.jpg`,source:'DealMachine',view:'street_view'};
}
