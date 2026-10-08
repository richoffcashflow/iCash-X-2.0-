/** Direct recorded entry is an explicit operator policy, never a fabricated spoken response. */
export const directCallEntryPolicy='direct_recorded_v1';
export function recordingAuthorized(row:{consent_at?:unknown;recording_authorized_at?:unknown;entry_policy?:unknown}){
 const value=row.consent_at??(row.entry_policy===directCallEntryPolicy?row.recording_authorized_at:null);
 return typeof value==='string'&&Number.isFinite(Date.parse(value));
}
export const directRecordedInstructions=`\nStart with the supplied property question and wait for the answer. When server context says ownershipAlreadyConfirmed is true, continue from that confirmation without asking for the address or ownership again; this is conversation continuity, not legal identity verification. Skip introductions, recording announcements, permission questions, transcript/privacy speeches and generic receptionist greetings. The server starts and verifies audio recording before connecting this conversation. No spoken recording consent was collected at this entry point; never claim that the caller said yes. Answer truthfully if asked whether the call is recorded or whether you are AI. If asked to stop recording or stop the call, use the existing stop tool immediately and end; do not promise a stop before confirmation. Keep the existing property, offer, contract, opt-out and handoff rules.`;
export function directCallTwiml(base:string,id:string,nonce:string){
 if(!/^https:\/\/www\.geticashx\.com\/api\/(?:reception\/recorded\/setup|internal\/voice\/recording\/connect)$/.test(base)||! /^[a-f0-9-]{36}$/.test(id)||! /^[a-f0-9]{64}$/.test(nonce))throw Error('CALL_BINDING_REQUIRED');
 // A short silent Play answers inbound calls before their signed setup redirect.
 // Pause as the first verb delays answering and does not establish an active call.
 return `<Response><Play>https://www.geticashx.com/audio/call-connect-silence.wav</Play><Redirect method="POST">${base}?id=${id}&amp;nonce=${nonce}</Redirect></Response>`;
}
