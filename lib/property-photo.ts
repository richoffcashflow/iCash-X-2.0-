/** Only URLs returned by DealMachine; never build imagery from guessed coordinates. */
export type PropertyPhoto={url:string;source:'DealMachine';view:'street_view'|'satellite'};
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
