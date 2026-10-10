import {sellerSubmission} from './seller-leads.ts';
import {z} from 'zod';

export const botDemoConsentVersion='icash-x-demo-contact-2026-10-10.1';
export const botDemoConsentText='I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.';
export const botDemoSharingText='iCash X uses the details you enter to research the property and demonstrate the bot in the presenting account’s workspace. Demo requests are not distributed to other customer accounts. No offer or sale is guaranteed.';
export const botDemoSubmission=sellerSubmission.omit({source:true,campaign:true,clickId:true,email:true}).extend({consentVersion:z.literal(botDemoConsentVersion)}).strict();
