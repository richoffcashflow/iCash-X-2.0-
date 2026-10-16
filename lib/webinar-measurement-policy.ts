export const measurementPolicyVersion='webinar-meta-2026-10-16';
export type MeasurementIdentity={marketing_consent_at:string|null;measurement:Record<string,string>};
/** Automatic measurement is a separate policy basis, never fabricated consent. */
export function measurementSince(identity:MeasurementIdentity):string|null{
 const m=identity.measurement??{};
 if(m.opt_out_at)return null;
 const dates=[identity.marketing_consent_at,
  m.basis==='automatic_us'&&m.country==='US'&&m.policy_version===measurementPolicyVersion?m.automatic_since:null
 ].filter((value):value is string=>!!value&&Number.isFinite(Date.parse(value)));
 return dates.length?dates.reduce((earliest,value)=>Date.parse(value)<Date.parse(earliest)?value:earliest):null;
}
export function automaticMeasurementEligible(headers:Headers){
 // Vercel overwrites its geolocation headers. Request parameters cannot opt in.
 return process.env.VERCEL==='1'&&headers.get('x-vercel-ip-country')==='US';
}
