import {finalSalePolicy} from './final-sale-policy.ts';
export const privateVipVersion='private-vip-50-monthly-v1';
export const privateVipCents=5000;
export const privateVipTerms='$50 today for VIP, then $50 per month until cancelled. VIP starts after confirmed payment. Cancel VIP from the account menu; VIP continues through the paid period and free Standard access remains. '+finalSalePolicy;
export type PrivateVipView={state:string;paidUntil:string|null;cancelAtPeriodEnd:boolean;hasSubscription:boolean};
