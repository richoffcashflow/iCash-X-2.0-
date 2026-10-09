export type ConversationCall = {
  id: string; source: 'outbound'|'reception'; party: string; completedAt: string;
  summary?: string; durationSeconds?: number; nextAction?: string;
  interested?: boolean; optedOut?: boolean; humanRequested?: boolean;
};
export function conversationTimeline<T extends {id:string;created_at:string}>(messages:T[],calls:ConversationCall[]) {
  const entries = [
    ...messages.map(message=>({kind:'message' as const,key:`message:${message.id}`,at:message.created_at,message})),
    ...calls.map(call=>({kind:'call' as const,key:`call:${call.source}:${call.id}`,at:call.completedAt,call})),
  ];
  return entries.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key));
}
