/** Synchronous carrier classification precedes recording and AI registration.
 * This policy is saved once in the original call context; never backfill it. */
export const carrierAnswerPolicy='carrier_amd_enable_v1';
export function carrierAnswerDisposition(value:unknown):'machine'|'human'|'unknown'|'unconfirmed'{
 if(typeof value!=='string')return 'unconfirmed';
 // The Call resource may use "machine"; Enable callbacks use "machine_start".
 if(['machine','machine_start','machine_end_beep','machine_end_silence','machine_end_other','fax'].includes(value))return 'machine';
 if(value==='human'||value==='unknown')return value;
 return 'unconfirmed';
}
