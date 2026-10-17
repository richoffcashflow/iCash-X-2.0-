import {z} from 'zod';

export const sellerAdSources=['meta','google','youtube','tiktok','other','direct'] as const;
export const sellerAdSlug=z.string().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/);
export const sellerAdAsset=z.union([z.literal(''),z.string().max(2000).url().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS link.')]);
export const sellerAdCreate=z.object({
 action:z.literal('create'),
 label:z.string().trim().min(2).max(100).regex(/^[^\u0000-\u001f<>]+$/u),
 format:z.enum(['image','video']),source:z.enum(sellerAdSources),
 campaign:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
 assetUrl:sellerAdAsset.default(''),
}).strict();
export const sellerAdInput=z.discriminatedUnion('action',[
 sellerAdCreate,
 z.object({action:z.literal('asset'),slug:sellerAdSlug,assetUrl:sellerAdAsset}).strict(),
]);
export type SellerAdRow={slug:string;label:string;format:'image'|'video';source:string;campaign:string;assetUrl:string;createdAt:string;visitors:number;responses:number;qualified:number};
export function sellerAdUrl(ad:Pick<SellerAdRow,'slug'|'source'|'campaign'>){
 const url=new URL('https://homeoffernetwork.com/');
 const medium=ad.source==='direct'?'referral':['meta','tiktok'].includes(ad.source)?'paid_social':['google','youtube'].includes(ad.source)?'cpc':'paid';
 url.search=new URLSearchParams({ad:ad.slug,utm_source:ad.source,utm_medium:medium,utm_campaign:ad.campaign,utm_content:ad.slug}).toString();
 return url.toString();
}
export function sellerAdRate(responses:number,visitors:number){return visitors?`${(responses/visitors*100).toFixed(1)}%`:'—';}
export function sellerAdsCsv(rows:SellerAdRow[]){
 // Quote every cell and prevent spreadsheet formulas in user-entered labels/URLs.
 const cell=(v:unknown)=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 return [['Ad','Format','Source','Campaign','Tracking link','Media link','Visitors','Responses','Response rate','Qualified'],...rows.map(r=>[r.label,r.format,r.source,r.campaign,sellerAdUrl(r),r.assetUrl,r.visitors,r.responses,sellerAdRate(r.responses,r.visitors),r.qualified])].map(r=>r.map(cell).join(',')).join('\r\n');
}
