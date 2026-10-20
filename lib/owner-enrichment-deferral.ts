/** Only a definite local rejection BEFORE the free preview transport is retryable.
 * HTTP errors, unknown database results, paid-stage denials and receipt failures
 * must never be converted into this error, including by matching error text.
 */
export class OwnerPreviewRateLimitError extends Error {
 readonly accountId:string;
 readonly screeningId:string;
 readonly operationKey:string;
 constructor(accountId:string,screeningId:string){
  super('OWNER_PREVIEW_RATE_LIMITED');
  this.name='OwnerPreviewRateLimitError';
  this.accountId=accountId;
  this.screeningId=screeningId;
  this.operationKey=`owners:${accountId}:${screeningId}`;
 }
}
