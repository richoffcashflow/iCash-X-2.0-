import type {SellerDb} from './seller-pipeline.ts';

export function sellerMeasurement(req:Request,cookies:{get:(key:string)=>{value:string}|undefined},input:{source:string;clickId:string},now=Date.now()){
 const identity:Record<string,string>={event_source_url:'https://homeoffernetwork.com/'};
 const fbp=cookies.get('_fbp')?.value,fbc=cookies.get('_fbc')?.value;
 if(fbp&&/^fb\.\d+\.\d{10,16}\.\d{1,30}$/.test(fbp))identity.fbp=fbp;
 if(fbc&&/^fb\.\d+\.\d{10,16}\.[a-zA-Z0-9_-]{1,300}$/.test(fbc))identity.fbc=fbc;
 else if(input.source==='meta'&&/^[a-zA-Z0-9_-]{1,300}$/.test(input.clickId))identity.fbc=`fb.1.${now}.${input.clickId}`;
 const agent=req.headers.get('user-agent');if(agent)identity.client_user_agent=agent.slice(0,512);
 return identity;
}

/** Measurement cannot turn a saved request into an error or dispatch paid work. */
export async function recordSellerMeasurement(db:SellerDb,leadId:string,guest:string,measurement:Record<string,string>,optedOut:boolean){
 try{return await db<{registrationEventId:string;addressEventId:string|null}|null>('rpc/icash_record_seller_intake_measurement','POST',{p_lead:leadId,p_guest:guest,p_measurement:measurement,p_opted_out:optedOut});}
 catch{console.warn('seller_measurement_receipt_unavailable');return null;}
}
