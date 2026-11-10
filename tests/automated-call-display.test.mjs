import assert from 'node:assert/strict';
import {isConfirmedVoicemail} from '../lib/call-display-evidence.ts';
const transcript=words=>words.map(message=>({role:'user',message}));
const automated=[
 ['Finished recording. You may hang up.'],['... recording, you may hang up.'],['This is recording. You may hang up.'],
 ['I am a virtual assistant that helps people with their calls when they\'re busy. They wanted me to check the reason for the call before connecting you to them.',"Unfortunately, the person you're calling cannot take your call right now. Have a nice day."],
 ['Thanks. Please stay on the line.','music playing'],
 ['Thanks. Please stay on the line.','...',"I'm sorry, this person is not available. If you would like to leave an additional message, please reply after the tone."],
 ['... 555-0101. Sorry, mailbox is full. To send an SMS notification, press five.','To send an SMS notification, press five.','Thank you for calling. Goodbye.'],
 ['Nothing has been recorded. Record your message after the tone. Simply hang up when done. Or for delivery options, press the pound sign.']
];
for(const words of automated){assert.equal(isConfirmedVoicemail(transcript(words)),true,words.join(' / '));for(const human of ['Yes, I own it.','I want to sell.','Not interested. Stop calling.','Hello, can you hear me?'])assert.equal(isConfirmedVoicemail(transcript([...words,human])),false,'A real response stays visible');}
for(const words of [[],['...'],['music playing'],['I listened to your voicemail and want a cash offer.'],['Please stay on the line while I get my spouse.'],['Your voicemail said: Finished recording. You may hang up.']])assert.equal(isConfirmedVoicemail(transcript(words)),false,'Uncertain and human calls stay visible');
console.log('PASS automated call display: observed voicemail/screening fragments hidden, mixed human replies and unknown audio preserved.');
