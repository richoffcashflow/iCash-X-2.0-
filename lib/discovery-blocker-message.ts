/** Public, presentation-only descriptions. Never expose provider keys or approve work. */
export function discoveryBlockerMessage(reason?:string|null):{title:string;detail:string}|null {
 const messages:Record<string,{title:string;detail:string}>={
  available_credits_required:{title:'Available credits do not cover the next search.',detail:'Your balance minus existing holds is below the next search’s planning charge. Review your available credits and holds before adding funds.'},
  confirmed_funding_required:{title:'Your funding needs confirmation.',detail:'No confirmed paid funding is available for this account’s search. Refresh your payment status or contact support before paying again.'},
  discovery_configuration_required:{title:'Your property search needs setup.',detail:'Your account has no configured property search yet. Contact support to finish setup; paying again will not fix this.'},
  discovery_not_enabled:{title:'Property discovery is paused for setup.',detail:'Your account’s automatic property search has not been enabled. Contact support to review its setup.'},
  spending_activation_required:{title:'Your spending activation needs review.',detail:'Paid credits alone do not activate property searches. Contact support to review your account’s spending activation; do not pay again to clear this hold.'},
  account_spending_limit:{title:'Your account spending limit is reached.',detail:'The next property search would exceed your approved account limit. Contact support to review the limit. No new paid search has started.'},
  daily_budget_limit:{title:'The next search exceeds your daily budget.',detail:'Your daily budget, today’s usage and existing holds do not leave enough room for the next search. No new paid search has started.'},
  market_review_required:{title:'Your search market needs review.',detail:'Your selected market has not passed the required setup checks. Contact support to review it.'},
  data_review_required:{title:'Your property data setup needs renewal.',detail:'The review period for your property data setup has expired or is unavailable. Contact support before starting new searches.'},
  pricing_review_required:{title:'Property search pricing needs review.',detail:'Current pricing could not be verified for the next search. Contact support; new paid searches remain held.'},
  discovery_not_released:{title:'Property discovery is awaiting release.',detail:'Live property discovery has not been released. Funding does not clear this setup requirement.'},
  provider_not_configured:{title:'Property discovery is awaiting setup.',detail:'The property data connection is not configured. Contact support; paying again will not complete this setup.'},
  operating_budget_unavailable:{title:'Property discovery is temporarily held.',detail:'The service’s operating budget is unavailable. Contact support; no new paid search has started.'},
  inventory_exhausted:{title:'No more properties in the current search.',detail:'The current search has no further results available. This does not establish seller interest or guarantee another property.'},
 };
 return reason&&Object.hasOwn(messages,reason)?messages[reason]:null;
}
