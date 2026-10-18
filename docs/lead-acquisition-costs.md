# Lead acquisition costs

The owner reported a real $11.20 Meta acquisition cost against a $0.12 lead charge on October 17, 2026. The old pricing snapshot explicitly excluded advertising and used only $0.04 of research/operating allocations at 3×. No advertising receipts had been recorded.

Admin → Lead costs opens the owner-only controls for individual costs, backup estimates, and automatic Meta spend tracking. Manual reports have immutable, idempotent records. Imported spend retains each revision. Neither is presented as an individual vendor invoice. Opening the page never saves or charges anything.

Cost precedence is an individual owner report, a recorded campaign allocation, Meta daily allocation or a fresh automatic average, the frozen assignment estimate, then a campaign/source backup estimate. Paid sources without any cost wait for an entry; direct requests and private demos retain no-paid-acquisition handling. Standard is 2× total lead cost at every cost level. VIP retains 20% off, rounded up to cents after the Standard price. $11.20 acquisition + $0.04 processing produces $22.48 Standard / $17.99 VIP per recipient. The central reservation gate validates the same lead/account/rate binding and multiplier. All new usage uses 2× Standard / 1.6× VIP. Existing operation snapshots retain their prior prices.

The first successful assignment freezes costs and multiplier for subsequent recipients. Old snapshots retain their original multiplier. Saving a later actual cost changes the owner report, never settled charges or existing assignment terms. The cost panel counts ad spend once per lead and sums recipient charges; its balance excludes separately billed calls/other work. Historic zero-acquisition snapshots are displayed as missing ad cost.

Existing campaign imports remain available in a collapsed form. An explicit individual cost takes precedence over campaign allocation. The new controls never create contact permission, change Run/Pause, grant membership, start calls, or alter recipient scheduling. They reuse the actual current assignment function's wallet and admission gates.

## Automatic Meta tracking

The owner checks the existing Meta connection, selects a USD ad account and actual campaign, and maps it to the HomeOffer tracking value (for example `image_ads`). A Meta campaign cannot be mapped twice. An existing mapping cannot silently switch accounts/campaigns; use a new tracking campaign for a different allocation. Pause/resume is available.

The server uses `META_ADS_READ_ACCESS_TOKEN`, falling back to the existing seller/CAPI token, with explicit `META_GRAPH_VERSION`. The token needs `ads_read` access to the advertising account; conversion-event access alone does not establish spend access. Tokens remain server environment secrets, excluded from browser responses, request URLs, spend records and logs. Without access or campaign selection, the UI identifies incomplete setup and backup estimates remain available.

The CRON_SECRET-protected, production-only `/api/internal/lead-costs` runs every 15 minutes and claims up to five due mappings concurrently (maximum 20 configured mappings). Each mapping is due hourly, with a two-minute lease. Each complete import reads the previous seven completed calendar days in the account timezone. All Meta calls are GET requests; the importer never creates ads or changes budgets. Account/campaign binding, USD currency, dates, duplicates, bounded decimal amounts and response completeness are validated. Pagination uses cursors on the original endpoint, never a provider-returned URL. Failed reads cannot become zero spend.

Daily reported spend is divided among unique real leads received in that campaign on that account-local date, excluding demos and duplicates. New leads use seven-day total spend divided by unique leads, including spend on zero-lead days. Reports display that unallocated spend. Corrections replace each day's contribution in reporting while retaining old revisions. With zero leads, an average is unavailable. Imports older than 48 hours cannot price new work; the labeled backup estimate is used. Today's final spend is unavailable until the next day, so instant distribution uses an estimate and completed customer charges stay fixed.

Apply `20261018021153_lead_acquisition_costs.sql`, then `20261018022033_seller_meta_cost_sync.sql`, then `20261018023348_two_times_usage_pricing.sql`. Tables/functions are service-only, with owner-authorized report/settings RPCs. Real lead records and backup estimates are separate operational entries, never embedded migration data.

Verification covers actual assignment and reservation SQL, Standard/VIP at every cost level, frozen historical/subsequent-recipient pricing, new 2× usage snapshots and preserved historical multipliers, missing costs/insufficient funds, owner access, idempotency, automatic allocation/revisions, zero-lead spend, stale imports, timezone/DST, read-only Meta transport, and desktop Chromium/mobile WebKit forms. No paid provider tests or real customer debits are used.

Protocol references: https://developers.facebook.com/docs/marketing-api/insights/ and https://www.postman.com/meta/facebook-marketing-api/request/u38qbri/get-insight-details-from-an-adaccount-l4 ; account metadata fields are also defined in Meta's official facebook-python-business-sdk.

## Universal usage pricing

The owner replaced the proposed expensive-lead threshold with 2× for all new usage. The final migration updates central admissions and VIP reductions, Ask AI questions, recorded inbound and outbound calling, and new manual phone-call versions. Settlement uses saved operation multipliers; old manual phone versions retain their original rule. VIP savings use each historical price snapshot. Incoming calling receives immutable policy/configuration versions preserving provider identity, consent controls and the standing review expiry. Rotation waits for active calls to end.

New SMS transport snapshots use $0.02 against the reviewed $0.01 transport cost; actual AI tokens remain billed separately. Existing contact approvals permit this lower price without rewriting consent or review evidence. Existing message price snapshots stay fixed. Maximum rate amounts remain admission ceilings, not completed-usage charges. No migration debits a wallet or sends provider work.
