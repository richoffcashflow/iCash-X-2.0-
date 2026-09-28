/** Server-side policy primitives. Persist identity and validate inputs before provider dispatch. */
export type DealScope = { tenantId:string; dealId:string };
export const ASSISTANT_NAME = "Alex";
export type AssistantIdentity = { tenantId:string; principal:string; verified:boolean };
export function assistantIntroduction(identity:AssistantIdentity, tenantId:string) {
  if (!tenantId || identity.tenantId!==tenantId || !identity.verified || !identity.principal.trim()) return null;
  return `I'm ${ASSISTANT_NAME}, an AI assistant working on behalf of ${identity.principal}.`;
}
export type MemoryFact = DealScope & { id:string; value:string; sourceId:string; verified:boolean; expiresAt:number };
/** Never blend property facts, even when the seller owns multiple properties. */
export function verifiedDealMemory(scope:DealScope, facts:MemoryFact[], now:number) {
  if (!scope.tenantId || !scope.dealId || !Number.isFinite(now)) return [];
  return facts.filter(f=>f.tenantId===scope.tenantId && f.dealId===scope.dealId && f.verified && f.sourceId && f.value.trim() && Number.isFinite(f.expiresAt) && f.expiresAt>now);
}
export type ActionContext = {
  scope:DealScope; recordScope:DealScope; identity:AssistantIdentity;
  paused:boolean; humanOwnsConversation:boolean; memoryVersion:number; acknowledgedMemoryVersion:number;
  permissionConfirmed:boolean; contactWindowOpen:boolean; suppressed:boolean; exclusiveContactLease:boolean;
  operationAlreadyCompleted:boolean; creditsReserved:boolean;
  authorityExpiresAt:number; now:number; maxOfferCents:number; offerCents:number;
  ownershipVerified:boolean; owners:{id:string; approved:boolean}[];
  signingAuthorized:boolean;
};
export function assistantActionDecision(action:'contact'|'offer'|'send_contract'|'sign_contract', c:ActionContext) {
  if (!c.scope.tenantId || !c.scope.dealId || c.scope.tenantId!==c.recordScope.tenantId || c.scope.dealId!==c.recordScope.dealId) return 'scope_mismatch';
  if (!assistantIntroduction(c.identity,c.scope.tenantId)) return 'identity_unverified';
  if (c.operationAlreadyCompleted) return 'already_completed';
  if (c.paused || c.humanOwnsConversation) return 'paused';
  if (!Number.isSafeInteger(c.memoryVersion) || c.memoryVersion<0 || c.memoryVersion!==c.acknowledgedMemoryVersion) return 'refresh_conversation';
  if (!c.permissionConfirmed || c.suppressed) return 'contact_blocked';
  if (!c.contactWindowOpen) return 'outside_contact_hours';
  if (!c.exclusiveContactLease) return 'contact_in_use';
  if (!c.creditsReserved) return 'needs_credits';
  if (action==='contact') return 'ready';
  if (!Number.isFinite(c.now) || !Number.isFinite(c.authorityExpiresAt) || c.authorityExpiresAt<=c.now) return 'needs_authorization';
  if (!Number.isSafeInteger(c.offerCents) || c.offerCents<=0 || !Number.isSafeInteger(c.maxOfferCents) || c.maxOfferCents<=0 || c.offerCents>c.maxOfferCents) return 'offer_needs_review';
  if (action==='offer') return 'ready';
  if (!c.ownershipVerified || !c.owners.length || c.owners.some(o=>!o.id || !o.approved) || new Set(c.owners.map(o=>o.id)).size!==c.owners.length) return 'owners_need_review';
  if (action==='sign_contract' && !c.signingAuthorized) return 'signature_needs_authorization';
  return 'ready';
}
