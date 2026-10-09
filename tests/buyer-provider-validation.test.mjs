import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerProviderValidation} from '../scripts/buyer-provider-validation.mjs';
test('provider diagnostics retain validation paths and omit secrets and request input',()=>{
 const secret='private-api-credential';
 const result=buyerProviderValidation({detail:[{loc:['body','conversation_config','reasoning_effort'],type:'value_error',msg:'Invalid '+secret,input:{token:secret},ctx:{headers:{Authorization:secret}}}]},secret);
 assert.deepEqual(result,[{location:['body','conversation_config','reasoning_effort'],type:'value_error',message:'Invalid [redacted]'}]);
 assert.equal(JSON.stringify(result).includes(secret),false);
 assert.deepEqual(buyerProviderValidation({detail:{status:'invalid_config',message:'Unsupported reasoning_effort',input:secret}},secret),{status:'invalid_config',message:'Unsupported reasoning_effort'});
 assert.deepEqual(buyerProviderValidation(null,secret),{status:null,message:null});
});
