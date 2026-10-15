/** Display-only metadata from the account snapshot, never a pricing input.
 * Require an exact server-confirmed signal; unknown and stale data are not
 * evidence of a provisional debit. The wallet is also hidden while stale.
 */
export function provisionalVoiceUsageDisclosure(pending:unknown,stale=false):string|null{
 return pending===true&&!stale
  ?'Some call usage is awaiting final receipts. Provisional deductions are estimates, not final charges. The final amount uses the call’s original rates; only the difference is deducted or returned.'
  :null;
}
