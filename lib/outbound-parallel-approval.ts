/** Owner approved more parallel calls on 2026-10-23. This changes only the
 * shared outgoing agent's capacity, not its reviewed conversation or pricing. */
export const outboundParallelApproval=Object.freeze({
 agentId:'agent_6701m406qmqjf1kr6ykw71vksjns',
 branchId:'agtbrch_3901m4exyqk7e03rzyn1eyhtv218',
 versionId:'agtvrsn_0901m4exyqk6exta8zt620daaq9d',
 previousLimit:2,limit:8,workspaceLimit:10,
});

/** Owner approved 1,000 daily outgoing conversations and twenty total slots
 * on 2026-10-26. Keep two incoming slots and the original reviewed behavior. */
export const outboundProApproval=Object.freeze({
 agentId:outboundParallelApproval.agentId,
 branchId:outboundParallelApproval.branchId,
 versionId:outboundParallelApproval.versionId,
 previousLimit:8,limit:18,workspaceLimit:20,
 previousDailyLimit:100,dailyLimit:1000,
});

/** Owner requested 80% of the forty-call Business capacity on 2026-11-05.
 * Thirty outgoing calls plus two incoming; daily allowance stays unchanged. */
export const outboundEightyPercentApproval=Object.freeze({
 agentId:outboundParallelApproval.agentId,
 branchId:outboundParallelApproval.branchId,
 versionId:outboundParallelApproval.versionId,
 previousLimit:18,limit:30,workspaceLimit:32,
 previousDailyLimit:1000,dailyLimit:1000,
});
