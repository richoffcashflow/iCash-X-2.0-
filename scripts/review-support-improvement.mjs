// Offline review of a bounded, privately captured snapshot. No database writes,
// model requests, customer replies, automatic policy changes or provider traffic.
import {readFileSync,statSync} from 'node:fs';
import {supportQualityReport} from '../lib/support-quality.ts';
const [file,at,...extra]=process.argv.slice(2);
if(!file||extra.length)throw Error('Usage: node --experimental-strip-types scripts/review-support-improvement.mjs private-snapshot.json [ISO-time]');
if(statSync(file).size>8*1024*1024)throw Error('Snapshot exceeds the 8 MiB review bound');
const input=JSON.parse(readFileSync(file,'utf8')),now=at?new Date(at):new Date();
if(!Number.isFinite(now.getTime())||!Array.isArray(input.conversations)||typeof input.limited!=='boolean'||input.conversations.length>200)throw Error('Invalid bounded review snapshot');
for(const c of input.conversations){
 if(!c||!['account','access'].includes(c.kind)||typeof c.id!=='string'||typeof c.subject!=='string'||typeof c.status!=='string'||!Number.isFinite(Date.parse(c.updated_at))||!Array.isArray(c.messages)||c.messages.length>80)throw Error('Invalid conversation or message bound');
 for(const m of c.messages)if(!m||!['user','assistant','operator'].includes(m.role)||typeof m.content!=='string'||m.content.length>16000||!Number.isFinite(Date.parse(m.created_at)))throw Error('Invalid review message');
}
const result=supportQualityReport(input.conversations,now,input.limited).improvement;
process.stdout.write(JSON.stringify(result,null,2)+'\n');
