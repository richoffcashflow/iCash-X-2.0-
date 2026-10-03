import assert from 'node:assert/strict';
import {workspaceStatus,workspaceNextAction,workspaceActionDisabled} from '../lib/workspace-status.ts';
const a={identity:{principal:'QA'},balanceCents:1000,workReady:true};
assert.equal(workspaceStatus(a).label,'READY');
assert.equal(workspaceStatus({...a,activeWork:true}).label,'WORKING');
assert.equal(workspaceStatus({...a,activeWork:true,paused:true}).label,'PAUSED');
assert.equal(workspaceStatus({...a,balanceCents:0}).label,'NO AVAILABLE CREDITS');
assert.equal(workspaceStatus({...a,workReady:false}).label,'SETUP PENDING');
assert.equal(workspaceStatus({...a,identity:null}).label,'NEEDS YOU');
console.log('Workspace status follows actual state and prioritizes holds.');

const campaign={configured:true,released:true,liveWorkReady:true,policy:{version:'v1'},acknowledgment:{version:'v1'}};
assert.equal(workspaceNextAction({...a,paused:true},campaign).kind,'resume');
assert.equal(workspaceNextAction({...a,identity:null},campaign).kind,'identity');
assert.equal(workspaceNextAction({...a,billingReview:true},campaign).kind,'support');
assert.equal(workspaceNextAction({...a,activeWork:true,paused:false},campaign).kind,'pause');
assert.equal(workspaceNextAction({...a,paused:true},null).kind,'campaign');
assert.equal(workspaceNextAction({...a,paused:true},{...campaign,acknowledgment:{version:'old'}}).label,'Choose outreach channels');
assert.match(workspaceNextAction({...a,paused:true},{...campaign,released:false}).reason,/save to complete account setup/);
assert.equal(workspaceNextAction({...a,paused:true,workReady:false},campaign).kind,'campaign');
assert.equal(workspaceNextAction({...a,paused:true,balanceCents:0},campaign).kind,'funding');
assert.equal(workspaceNextAction({...a,paused:false},campaign).kind,'work');
console.log('Workspace next action uses verified evidence, exact existing destinations, honest platform holds and readiness-gated start.');

assert.equal(workspaceActionDisabled('pause',false,true),false,'a refresh error must never hide the stop action');
assert.equal(workspaceActionDisabled('resume',false,true),true,'cannot start from stale account state');
assert.equal(workspaceActionDisabled('pause',true,true),true,'duplicate controls remain guarded');
console.log('Stop remains available through account refresh failures; stale starts stay blocked.');

const inbound={...campaign,mode:'sms_inbound',smsChannelEnabled:true};
assert.match(workspaceNextAction({...a,paused:true,smsWorkReady:true},inbound).reason,/inbound-call invitations/);
assert.match(workspaceNextAction({...a,paused:false,smsWorkReady:true},inbound).reason,/Outbound AI calls stay off/);
assert.doesNotMatch(workspaceNextAction({...a,paused:false,smsWorkReady:true},inbound).reason,/invitations remain held/);
