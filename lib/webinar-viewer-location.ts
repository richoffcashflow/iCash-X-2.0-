import type {ViewerLocation} from '../packages/webinar-engine/src/index.ts';

/** Approximate provider geolocation, used only for this request. Never ask for GPS
 * or persist coordinates in a visitor record, recording snapshot or analytics.
 */
export function webinarViewerLocation(headers:Pick<Headers,'get'>,onVercel=!!process.env.VERCEL):ViewerLocation|null{
 if(!onVercel)return null;
 const latitude=headers.get('x-vercel-ip-latitude'),longitude=headers.get('x-vercel-ip-longitude');
 const coordinate=(value:string|null)=>value!==null&&value.length<=24&&/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN;
 const lat=coordinate(latitude),lng=coordinate(longitude);
 return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180?{latitude:lat,longitude:lng}:null;
}
