type Db=(path:string,method?:string,body?:unknown)=>Promise<unknown>;
/** Pure local ticket repair. SQL owns the disabled-by-default policy, exact
 * original proof and one-time journal. Provider work remains in normal dispatch. */
export async function continueExpiredOwnerPreflightTicket(db:Db){
 const result=await db('rpc/icash_continue_expired_owner_preflight_ticket','POST',{});
 if(!result||typeof result!=='object'||!('status' in result)||
  !['disabled','idle','busy','held','continued'].includes(String(result.status)))throw Error('OWNER_TICKET_CONTINUATION_UNAVAILABLE');
 if(result.status==='continued'){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!('ticketId' in result)||!('preflightId' in result)||typeof result.ticketId!=='string'||typeof result.preflightId!=='string'||
   !uuid.test(result.ticketId)||!uuid.test(result.preflightId))throw Error('OWNER_TICKET_CONTINUATION_UNAVAILABLE');
 }
 return result as {status:string;ticketId?:string;preflightId?:string};
}
