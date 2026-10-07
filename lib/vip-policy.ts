export const vipTermsVersion='vip-2026-10-07.1';
export const standardMonthlyCents=5000;
export const vipMonthlyCents=10000;
export const vipUpgradeCents=5000;
export function vipActive(m:{state:string;paid_through:string|null;vip_until?:string|null}|null,now=Date.now()){
 return !!m&&m.state==='active'&&Date.parse(m.paid_through??'')>now&&Date.parse(m.vip_until??'')>now;
}
export function vipPrice(standardCents:number,_kind:'lead'|'usage'){
 if(!Number.isSafeInteger(standardCents)||standardCents<0)throw Error('Invalid price');
 return Math.ceil(standardCents*80/100);
}
export const vipBenefits=['20% off AI work','20% off leads','Priority for eligible new leads','Custom bot name','Your own AI voice'];
