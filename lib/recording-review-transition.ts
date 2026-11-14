import {canonical,object,readRecordingReview,recordingPolicy,type RecordingReview} from './required-call-recording.ts';

type Env=Record<string,string|undefined>;
/** An explicit two-version cutover, never provider-failure fallback. Both
 * complete approvals must retain the same identity, tools and authorities. */
export function readRecordingReviews(env:Env,now=Date.now()):RecordingReview[]|null{
 const primary=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!primary)return null;
 if(env.RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON===undefined)return [primary];
 const previous=readRecordingReview(env.RECORDED_OUTBOUND_PREVIOUS_REVIEW_JSON,now);
 if(!previous||previous.branchId===primary.branchId||previous.versionId===primary.versionId||previous.configHash===primary.configHash||Date.parse(previous.reviewedAt)>Date.parse(primary.reviewedAt))return null;
 const authority=(review:RecordingReview)=>{
  const {branchId,versionId,configHash,reviewedAt,...fixed}=review;
  return JSON.stringify(canonical({...fixed,toolIds:[...fixed.toolIds].sort()}));
 };
 return authority(primary)===authority(previous)?[primary,previous]:null;
}
export function recordingReviewInPair(env:Env,selected:RecordingReview,now=Date.now()):RecordingReview|null{
 const reviews=readRecordingReviews(env,now),key=JSON.stringify(canonical(selected));
 return reviews?.find(review=>JSON.stringify(canonical(review))===key)??null;
}
export function recordingReviewForConfig(env:Env,raw:unknown,now=Date.now()):RecordingReview|null{
 const c=object(raw),tools=c.required_tool_ids;
 const matches=readRecordingReviews(env,now)?.filter(review=>c.agent_id===review.agentId&&c.agent_config_hash===review.configHash&&c.max_duration_seconds===review.maxTotalSeconds&&Array.isArray(tools)&&tools.length===review.toolIds.length&&new Set(tools).size===tools.length&&review.toolIds.every(id=>tools.includes(id)))??[];
 return matches.length===1?matches[0]:null;
}
export function recordingReviewForRow(env:Env,raw:unknown,now=Date.now()):RecordingReview|null{
 const row=object(raw);
 const matches=readRecordingReviews(env,now)?.filter(review=>row.agent_id===review.agentId&&row.branch_id===review.branchId&&row.version_id===review.versionId&&row.provider_account_sid===review.providerAccountSid&&row.disclosure_version===recordingPolicy.disclosureVersion)??[];
 return matches.length===1?matches[0]:null;
}
