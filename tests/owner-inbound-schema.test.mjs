import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {renderOwnerInboundSchema} from '../scripts/owner-inbound-schema.mjs';

const template=readFileSync('config/owner-inbound-acceptance.sql','utf8');
const sid='AC'+randomBytes(16).toString('hex');
const marker='{{OWNER_INBOUND_TWILIO_ACCOUNT_SID}}';
assert(template.includes('check(twilio_account_sid='+marker+')'),'Unrendered marker is not a valid SQL string literal');
const sql=renderOwnerInboundSchema(template,sid);
assert(sql.includes("check(twilio_account_sid='"+sid+"')"),'Rendered schema pins one exact account');
assert(!sql.includes(marker));
assert.equal(sql.replace("'"+sid+"'",marker),template,'Rendering changes only the explicit private account input');
for(const invalid of [undefined,null,0,{},'',sid+'\n',sid+' ',sid.slice(1),sid+'0','SK'+'1'.repeat(32),'AC'+'g'.repeat(32),"x');drop table x;--"]){
  assert.throws(()=>renderOwnerInboundSchema(template,invalid),/ACCOUNT_REQUIRED/);
}
for(const invalid of [null,template.replace(marker,''),template+marker,template+'{{OTHER_INPUT}}']){
  assert.throws(()=>renderOwnerInboundSchema(invalid,sid),/TEMPLATE_INVALID/);
}
console.log('Owner inbound schema: explicit validated private input, exact SQL pin, no unresolved or ambiguous templates');
