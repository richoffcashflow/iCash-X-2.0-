/** Shared final-action gate. Entire response must consist of one to six clear affirmative clauses.
 * No substring extraction, fuzzy matching, semantic model, or punctuation-driven negation removal.
 * Keep the PostgreSQL helper in recording-consent-evidence-v4.sql byte-equivalent in behavior.
 */
export const naturalAffirmativePattern='^((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))( (and )?((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))){0,5}$';
const affirmative=new RegExp(naturalAffirmativePattern);
export function naturalAffirmative(text:string|null):boolean{
 if(typeof text!=='string'||text.length===0||text.length>120||text.includes('..')||!/^[A-Za-z \t\r\n\f\v\u00a0,.!?'’‘]+$/.test(text))return false;
 // ASR punctuation is inferred: only a sole direct affirmative may carry a question mark.
 if(text.includes('?'))return /^(yes|yeah|yep|sure|okay|ok|absolutely|certainly)[,.!? ]*$/.test(text.toLowerCase().replace(/[ \t\r\n\f\v\u00a0]+/g,' ').trim());
 const normalized=text.toLowerCase().replace(/[’‘]/g,"'").replaceAll("that's",'that is').replaceAll("it's",'it is').replaceAll("i'm",'i am').replace(/[,\.!]/g,' ').replace(/[ \t\r\n\f\v\u00a0]+/g,' ').trim();
 return affirmative.test(normalized);
}
/** Shape diagnostics contain no transcript, transformed transcript, identifying tokens or hash. */
export function speechShape(text:string|null){
 return {comma:typeof text==='string'&&text.includes(','),curlyApostrophe:typeof text==='string'&&/[’‘]/.test(text),question:typeof text==='string'&&text.includes('?'),repeatedAffirmative:typeof text==='string'&&/\b(yes|yeah|yep|sure|okay|ok)[ ,.!]+\1\b/i.test(text)};
}

type RecordingConfidence={status:'missing'|'malformed'|'valid';value:number|null;reported:string|null};
/** Decimal provider format only, at most 30 fractional digits. Compare exactly before Number(). */
export function recordingConfidence(raw:string|null):RecordingConfidence{
 if(raw===null)return {status:'missing',value:null,reported:null};
 if(!/^(?:0|1|0?\.[0-9]{1,30}|1\.[0-9]{1,30})$/.test(raw))return {status:'malformed',value:null,reported:null};
 const [whole='',fraction='']=raw.split('.');
 if(whole==='1'&&/[1-9]/.test(fraction))return {status:'malformed',value:null,reported:null};
 return {status:'valid',value:Number(raw),reported:raw};
}

/** Call only after the final action webhook's signature, nonce and canonical call binding pass.
 * Twilio does not guarantee Confidence. Missing is recorded as missing, never as a score.
 * A malformed/out-of-range score, partial text, silence or non-affirmative response still rejects.
 */
export function finalAffirmativeSpeech(form:URLSearchParams){
 const utterance=form.get('SpeechResult'),raw=form.get('Confidence');
 if(form.has('UnstableSpeechResult')||form.getAll('SpeechResult').length!==1||form.getAll('Confidence').length>1||typeof utterance!=='string'||utterance.length>120||!naturalAffirmative(utterance))return null;
 const score=recordingConfidence(raw);if(score.status!=='missing'&&score.status!=='valid')return null;
 return {utterance,confidence:score.value,confidenceReported:score.reported,confidencePolicy:'advisory' as const,resultKind:'gather_action_final' as const,confidenceBasis:score.status==='missing'?'not_provided' as const:'provider_reported' as const};
}

/** Contact requests are conservative and independent of the shorter affirmative grammar.
 * The verified final webhook already has a 16 KiB body bound. Never truncate a stop request.
 */
export function recordingContactOptOut(form:URLSearchParams){
 const text=form.get('SpeechResult');if(typeof text!=='string'||form.has('UnstableSpeechResult'))return null;
 const normalized=text.replace(/[’‘]/g,"'").replace(/[,\.!]/g,' ').replace(/\s+/g,' ').trim();
 const stop=/\b((do not|don't|never) (ever )?(call|text|contact)|(stop|quit) (calling|texting|contacting)|(stop|no more) (these |the )?(calls|texts|messages)|(do not|don't) want (you|your (company|business)) to (ever )?(call|text|contact)|(do not|don't) want (any (more )?|anymore |more )?(calls|texts|contact)|remove (me|my number)|take (me|my number) off)\b/i;
 // Judge each imperative locally: a negated stop/remove request is not an opt-out.
 // A separate genuine request later in the same final result must still be honored.
 const inverse=/\b((do not|don't|never|not)( ever)?|(do not|don't) want (you|your (company|business)) to( ever)?) $/i;
 for(const match of normalized.matchAll(new RegExp(stop.source,'gi'))){
  if(/^(stop|quit|remove|take)\b/i.test(match[0])&&inverse.test(normalized.slice(0,match.index)))continue;
  return text;
 }
 return null;
}

export const recordingConsentEvidenceVersion='recorded-final-natural-affirmative-advisory-v4';
