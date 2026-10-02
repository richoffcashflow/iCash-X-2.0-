import {db} from '@/lib/stripe-test';
import {createReceptionHandlers} from './general-reception.ts';
export function receptionHandlers(){return createReceptionHandlers({RECEPTION_ENABLED:process.env.RECEPTION_ENABLED,TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,RECEPTION_POSTCALL_SECRET:process.env.RECEPTION_POSTCALL_SECRET??process.env.ELEVENLABS_WEBHOOK_SECRET},{rpc:(name,body,signal)=>db(`rpc/${name}`,'POST',body??{},signal)});}
