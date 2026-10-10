type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Delivery={id:string;account_id:string;thread_id:string};
type Dependencies={db:Database;dispatch:(account:string,message:string)=>Promise<{status:string}>};

/** One package for an explicitly provisioned owner request. No enrollment,
 * arbitrary recipients, emails, calls or provider retries happen here. */
export async function processOwnerBuyerDelivery(d:Dependencies,env:Record<string,string|undefined>){
 if(env.VERCEL_ENV!=='production'||(env.ICASH_LIVE_WORK_READY!=='true'&&env.ICASH_SMS_WORK_READY!=='true'))return {status:'owner_delivery_disabled'};
 const requests=await d.db<Delivery[]>(`icash_owner_buyer_tests?revoked_at=is.null&send_email=eq.false&expires_at=gt.${new Date().toISOString()}&select=id,account_id,thread_id&order=created_at.desc&limit=5`);
 for(const request of requests){
  // A failed or uncertain attempt remains held. The existing database claim
  // serializes workers and validates the exact owner, signed price and message.
  const previous=await d.db<{id:string;state:string}[]>(`icash_text_messages?account_id=eq.${request.account_id}&thread_id=eq.${request.thread_id}&direction=eq.outgoing&select=id,state&order=created_at&limit=1`);
  if(previous[0]&&previous[0].state!=='ready')continue;
  const content=await d.db<{sms:string}|null>('rpc/icash_owner_buyer_test_content','POST',{p_id:request.id});
  if(!content)continue;
  const message=await d.db<string|null>('rpc/icash_queue_buyer_package_text','POST',{p_account:request.account_id,p_thread:request.thread_id,p_body:content.sms});
  if(!message)continue;
  return d.dispatch(request.account_id,message);
 }
 return {status:'owner_delivery_idle'};
}
