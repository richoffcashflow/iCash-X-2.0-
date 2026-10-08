import {db} from './stripe-test';
import {ensureRecordedConversationBinding} from './required-call-recording-binding';
import {createRecordedReceptionProviders} from './recorded-reception-provider';
import {receptionLiveConversationMatches,type RecordedReceptionRow} from './recorded-reception';
import {transitionRecordedReception} from './recorded-reception-service';
import {sha} from './required-call-recording';
export async function bindSellerAgreementCall(token:string,conversationId:string){
 if(!/^[a-f0-9]{64}$/.test(token)||!/^conv_[A-Za-z0-9]+$/.test(conversationId))throw Error('invalid_call');
 if(await ensureRecordedConversationBinding(token,conversationId,db,process.env))return;
 const row=await db<RecordedReceptionRow|null>('rpc/icash_seller_agreement_recording','POST',{p_hash:sha(token)});
 if(!row)throw Error('invalid_call');
 if(row.conversation_id){if(row.conversation_id!==conversationId)throw Error('invalid_call');return;}
 const provider=createRecordedReceptionProviders(process.env),conversation=await provider.conversation(conversationId);
 if(!receptionLiveConversationMatches(row,conversation))throw Error('unconfirmed_call');
 const rpc=<T>(name:string,body?:Record<string,unknown>)=>db<T>('rpc/'+name,'POST',body);
 const bound=await transitionRecordedReception(rpc,row,'bind_conversation',{conversationId,agentId:row.agent_id,branchId:row.branch_id,versionId:row.version_id});
 if(!bound){const fresh=await db<RecordedReceptionRow|null>('rpc/icash_seller_agreement_recording','POST',{p_hash:sha(token)});if(fresh?.conversation_id!==conversationId)throw Error('unconfirmed_call');}
}
