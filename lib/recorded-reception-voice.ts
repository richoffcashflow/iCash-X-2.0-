import {inspectRecordedReceptionAgent} from './recorded-reception.ts';
import {object} from './required-call-recording.ts';
import type {RecordedReceptionConfig} from './recorded-reception.ts';

type VoiceDependencies={
 selectVoice:(accountId:string,signal:AbortSignal)=>Promise<string|null>;
 agent:(config:RecordedReceptionConfig,signal:AbortSignal)=>Promise<Record<string,unknown>>;
};

/** Only the receiving line's authenticated account selects a voice. Caller fields
 * and property context cannot supply either the account or the provider voice ID.
 * A bounded read-only lookup preserves standard reception during provider outages. */
export async function selectedRecordedReceptionVoice(accountId:string,config:RecordedReceptionConfig,deps:VoiceDependencies,signal?:AbortSignal){
 if(accountId!==config.account_id||signal?.aborted)return null;
 const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(4000)]);
 try{
  const voiceId=await deps.selectVoice(accountId,deadline);
  if(!voiceId||!/^[A-Za-z0-9_-]{5,100}$/.test(voiceId)||deadline.aborted)return null;
  const agent=await deps.agent(config,deadline);
  const overrides=object(object(object(agent.platform_settings).overrides).conversation_config_override);
  // Admission already reviewed the complete configuration and tools. Reuse its
  // fingerprint comparison so exact empty/disabled provider defaults cannot
  // discard an otherwise valid custom voice. Actual configuration changes fail.
  const approved=inspectRecordedReceptionAgent(config,agent,null,false).checks.approvedHashMatches;
  if(agent.agent_id!==config.agent_id||agent.branch_id!==config.branch_id||agent.version_id!==config.reviewed_version_id||!approved||object(overrides.tts).voice_id!==true||deadline.aborted)return null;
  return voiceId;
 }catch{return null;}
}
