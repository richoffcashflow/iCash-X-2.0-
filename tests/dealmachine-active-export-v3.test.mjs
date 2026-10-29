import assert from 'node:assert/strict';
import {checkApprovedActivePhoneExportV3} from '../scripts/check-approved-active-phone-export-v3.mjs';
const fail=()=>{throw Error('retired runner must not access providers or DB');};
assert.deepEqual(await checkApprovedActivePhoneExportV3({db:fail,transport:fail}),{status:'retired_use_v4',providerRequests:0,paidRequests:0});
console.log('PASS consumed v3 runner retired without provider or DB requests.');
