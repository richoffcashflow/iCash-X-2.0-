export type WebinarPurchaseState = 'standard' | 'vip' | null;

/** Purchase state comes from the billing API, never a return URL or local storage. */
export function webinarPurchaseDestination(purchased:WebinarPurchaseState,checkoutEngaged:boolean,upgradeActive:boolean){
 if(purchased==='vip')return '/join?setup=1';
 if(upgradeActive)return null;
 if(purchased==='standard')return '/webinar/upgrade';
 return checkoutEngaged?null:'checkout';
}

export function safeVipSession(path?:string|null){
 return path&&/^\/live\/\d{6,12}$/.test(path)?path:null;
}
