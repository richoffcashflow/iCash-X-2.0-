/** Numeric codes come from the database, stay stable through edits, and are never reused. */
export function webinarLink(webinar:{publicCode?:string|null}){
 return webinar.publicCode&&/^\d{6,12}$/.test(webinar.publicCode)?`/live/${webinar.publicCode}`:'/webinar';
}

/** Owner previews use the requested saved recording, with a fallback when its slot is empty. */
export function webinarPreviewLink(webinar:{id:string;videoUrl:string;nightVersion?:{videoUrl:string}|null},preferred:'day'|'night'='day'){
 const version=preferred==='night'&&webinar.nightVersion?.videoUrl?'night':webinar.videoUrl?'day':webinar.nightVersion?.videoUrl?'night':preferred;
 return `/webinar?preview=${webinar.id}&variant=${version}`;
}
