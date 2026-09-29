import assert from 'node:assert/strict';
import {defaultBotProfile,normalizeBotProfile,botInitials,setupEvents} from '../lib/bot-setup.ts';
assert.equal(botInitials('Oak Street Properties'),'OS');
assert.equal(botInitials('Jordan'),'J');
assert.equal(normalizeBotProfile({...defaultBotProfile,displayName:' Jordan '}).displayName,'Jordan');
for(const p of [{...defaultBotProfile},{...defaultBotProfile,displayName:'<script>'},{...defaultBotProfile,displayName:'Jordan',theme:'url(evil)'},{...defaultBotProfile,displayName:'Jordan',voice:'arbitrary-voice-id'}])assert.throws(()=>normalizeBotProfile(p));
assert(!setupEvents.includes('purchase'));
assert(!setupEvents.includes('setup_completed'));
console.log('Setup validation: names, preset themes/voices and server-only completion/payment events passed');
