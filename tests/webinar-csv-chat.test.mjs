import assert from 'node:assert/strict';
import {importWebinarChat} from '../lib/webinar-import.ts';
const rows=importWebinarChat('time,name,message,kind,location\n00:12,Alex,"Do I need a license?",replay,\n20:10,Jamie,,purchase,"Dallas, TX"\n00:02,Tessa,ready,,');
assert.equal(rows[0].at,12);assert.equal(rows[0].kind,'replay');assert.equal(rows[1].at,1210);assert.equal(rows[1].kind,'purchase');assert.equal(rows[1].text,'Joined iCash X · $50/month');assert.equal(rows[1].location,'Dallas, TX');assert.equal(rows[2].kind,'replay');
assert.equal(importWebinarChat('username,message,minutes,seconds\nAlex,ready,0,4')[0].kind,'replay');
console.log('PASS CSV imports replay chat, labeled purchases, optional location and blank purchase text with correct timing.');
