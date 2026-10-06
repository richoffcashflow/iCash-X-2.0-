/** Numeric codes come from the database, stay stable through edits, and are never reused. */
export function webinarLink(webinar:{publicCode?:string|null}){
 return webinar.publicCode&&/^\d{6,12}$/.test(webinar.publicCode)?`/live/${webinar.publicCode}`:'/webinar';
}
