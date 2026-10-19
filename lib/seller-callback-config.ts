import {canonical,object,uuid} from './required-call-recording.ts';
import {receptionTarget,type ReceptionConfig} from './general-reception.ts';

const scopeKeys=['id','version','account_id','owner_user_id','cost_policy_id','cost_policy_snapshot','callback_template_id','callback_template','created_at','approval_reference'];
function without(value:Record<string,unknown>,keys:string[]){return Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));}
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** Provider approval belongs to the unchanged template. A server-provisioned
 * callback profile changes only the receipt-matched customer and billing scope. */
export function sellerCallbackProviderConfig(c:ReceptionConfig):ReceptionConfig|null{
 if(c.callback_template_id===undefined||c.callback_template_id===null)return c;
 const source=object(c.callback_template),policy=object(c.cost_policy_snapshot),sourcePolicy=object(source.cost_policy_snapshot);
 if(!uuid(c.id)||!uuid(c.account_id)||!uuid(c.owner_user_id)||!uuid(c.callback_template_id)
  ||source.id!==c.callback_template_id||source.id===c.id||source.callback_template_id!==null
  ||source.account_id!==receptionTarget.accountId||source.owner_user_id!==receptionTarget.ownerUserId
  ||source.enabled!==true||source.call_profile!=='normal'||source.entry_policy!=='direct_recorded_v1'
  ||source.reviewed_until!==c.reviewed_until||Date.parse(String(source.reviewed_until))!==Date.parse('9999-12-31T23:59:59Z')
  ||!uuid(c.cost_policy_id)||policy.id!==c.cost_policy_id||policy.account_id!==c.account_id
  ||sourcePolicy.id!==source.cost_policy_id||sourcePolicy.account_id!==source.account_id
  ||!same(without(c,scopeKeys),without(source,scopeKeys))
  ||!same(without(policy,['id','version','account_id','created_at','approval_reference']),without(sourcePolicy,['id','version','account_id','created_at','approval_reference'])))return null;
 return {...c,account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId};
}
