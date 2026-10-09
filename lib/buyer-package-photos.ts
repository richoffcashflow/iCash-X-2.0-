import {coordinatePropertyPhoto,dealMachinePhoto} from './property-photo.ts';
export type BuyerPhoto={url:string;caption:string};
/** Public gallery allowlist. Seller files must be carrier-hosted raster images. */
export function buyerPackagePhotos(p:{propertyImages?:unknown;latitude?:unknown;longitude?:unknown;sellerPhotos?:unknown}):BuyerPhoto[]{
 const property=dealMachinePhoto(p.propertyImages)??coordinatePropertyPhoto(p.latitude,p.longitude);
 const photos:BuyerPhoto[]=property?[{url:property.url,caption:property.view==='satellite'?'Property aerial image · DealMachine':'Property street image · DealMachine'}]:[];
 const seen=new Set(photos.map(p=>p.url));
 if(Array.isArray(p.sellerPhotos))for(const raw of p.sellerPhotos){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const {url,mime,filename}=raw as Record<string,unknown>;
  if(typeof url!=='string'||url.length>3000)continue;
  try{
   const u=new URL(url);
   if(u.protocol!=='https:'||u.hostname!=='api.contiguity.com'||!u.pathname.startsWith('/attachments/')||u.port||u.username||u.password||u.hash)continue;
   const raster=typeof mime==='string'?/^image\/(jpeg|png|webp|gif)$/i.test(mime):/\.(jpe?g|png|webp|gif)$/i.test(typeof filename==='string'?filename:u.pathname);
   if(!raster||seen.has(u.href))continue;
   seen.add(u.href);photos.push({url:u.href,caption:'Seller-provided property photo'});
  }catch{/* Invalid or non-image attachments never become package media. */}
 }
 return photos;
}
