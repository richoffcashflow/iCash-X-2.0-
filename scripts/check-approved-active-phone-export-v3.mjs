import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const activePhoneExportV3='dealmachine_active_phone_export_verification_20261028_v3';
const fields=Object.freeze(['person_full_name','has_active_phone_number']);
export function activePhoneExportV3Request(personId){
 if(typeof personId!=='string'||!/^per_[1-9][0-9]{0,30}$/.test(personId))throw Error('EXPORT_OWNER_INVALID');
 return {people_ids:[personId],fields:[...fields],property_match:'owner',anchor:'person',limit:1,require_phone:true,scrub_dnc:true,active_phones_only:true};
}
export const activePhoneExportV3Hash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');

// Historical request/hash exports remain for receipt inspection only.
export async function checkApprovedActivePhoneExportV3(){
 // Consumed allowance: never reset or reuse the legacy build hook.
 return {status:'retired_use_v4',providerRequests:0,paidRequests:0};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 console.log('Approved DealMachine active export v3: '+JSON.stringify(await checkApprovedActivePhoneExportV3()));
}
