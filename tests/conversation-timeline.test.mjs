import assert from 'node:assert/strict';
import {conversationTimeline} from '../lib/conversation-timeline.ts';
const messages=[{id:'a',created_at:'2026-10-09T04:00:00Z'},{id:'b',created_at:'2026-10-09T04:02:00Z'}];
const calls=[{id:'a',source:'reception',party:'seller',completedAt:'2026-10-09T04:01:00Z'}];
const timeline=conversationTimeline(messages,calls);
assert.deepEqual(timeline.map(x=>x.kind),['message','call','message']);
assert.equal(new Set(timeline.map(x=>x.key)).size,3);assert.equal(messages[0].id,'a');assert.equal(calls[0].source,'reception');
console.log('Conversation merges calls and texts chronologically with separate stable identities.');
