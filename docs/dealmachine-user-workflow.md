# DealMachine workflow supplied by owner — September 28, 2026

Status: user-supplied mapping and product requirements, not verified API response documentation. Do not manufacture endpoints, field availability, licensing rights, or live events from this document.

## Property analysis

Resolve an address, retain dm_property_id and source provenance, and enrich only as needed. Requested baseline repair field: estimated_repair_cost; optional range: estimated_repair_cost_range.low/high. Preserve building condition, quality, square footage, legal description, APN and equity estimates. Missing values remain unknown. Zero range bounds around a positive estimate must be treated as inconsistent/missing range data rather than free repairs. Verify units and null/zero semantics using actual responses before mapping to integer cents.

Owner example: 2,034 sqft, average condition, $71,190 baseline estimate implies $35/sqft. This is an illustrative supplied example, not a fetched property. Automated repairs remain estimates; seller statements/photos and inspection evidence may revise scope with provenance. Exterior imagery does not establish interior condition. Verify the supplied img.dealmachine.com coordinate image templates and usage rights before integrating.

## Comps and offers

Start with matching property type, one mile, trailing 12 months, bedrooms/bathrooms within one, and living area within 20%. Rank by distance, recency, similarity and reliable condition evidence, retaining the three strongest suitable comps with sources and confidence. Do not force three when evidence is insufficient. Estimated Sales Price must never be labelled a verified recorded sale. Renovation comparability matters for ARV; a generic estimated value is not automatically ARV. API comps endpoint/fields remain unverified.

Implemented calculator default: reviewed ARV × 70% − reviewed repairs − $10,000 assignment fee. Fee is an explicit overrideable policy input; the default is not a promised payout. Offer breakdown includes rule, fee, buyer ceiling and seller ceiling. Offer dispatch remains unimplemented.

## Buyer discovery adaptation

After a signed contract and marketing authorization, target up to 50 unique buyer candidates within 10 miles, corporate-owned comparable single-family properties purchased within approximately six months, bedrooms/bathrooms within one and area within 20%. Supplied property type IDs 286/83/390 and people/owners search parameters require verification against the active API schema. Corporate ownership and a recent purchase establish a candidate, not verified cash, buying intent or proof of funds. Land needs separate criteria.

Use bounded batches, count/estimate first, and stop on approved spend limit, candidate exhaustion, no-progress pagination or target reached. Do not spend indefinitely to reach 50. Normalize phones, suppress explicit DNC, and require affirmative channel eligibility; missing DNC data does not grant permission. Deduplicate tenant-scoped buyer identities; shared phones require identity review, not automatic person merges. Retain the matched property as the reason for discovery.

Use iCash X buyer IDs and deal/buyer relationships instead of the older GHL contact/tag dependency. A buyer may match multiple deals without duplicate identity records. Display the subject address as a deal label; use immutable deal IDs internally so similar addresses cannot collide. Keep buyer matches and conversation details progressively disclosed. Existing buyer outreach planner batches five eligible contacts within budget; live discovery is still pending.

## Live verification — September 28, 2026, 05:30 UTC

Using the existing Vercel Preview credential, GET /v1/usage authenticated successfully. Live /v1/fields confirmed estimated_repair_cost and the combined estimated_repair_cost_range selector. The selector metadata says it adds separate low/high columns; the public filter reference names estimated_repair_cost_low and estimated_repair_cost_high. The supplied nested range shape is not verified.

A single GET /v1/properties/prop_179843131 with contact_audience=none and explicit repair/condition/square-footage fields returned estimated_repair_cost=71190, building_condition=Average, living_area_sqft=2034. No requested low/high range was present in the response. Provider-reported credits.used=1; no owner contacts were returned. The normalizer preserves this as 7,119,000 cents with missing range and reviewed=false; it does not authorize an offer. Tests cover missing, malformed, inconsistent and unsafe monetary inputs.

Authenticated DealMachine MCP initialization and tools/list confirmed dealmachine_comps, accepting 1–25 property_ids; radius location; timeframe 3months/6months/12months/all; match_property_type; bedroom/bathroom and sqft tolerances; include_active_listings/include_pending; sort_by=match and limit. Description states one property data credit per subject found. No comps execution occurred in this verification, so actual comp output, sale-price provenance and confidence mapping remain unverified.

Metadata also confirmed the selectable last-sale price field is last_sale_price. Do not silently assume the pasted last_sale_amount name is accepted as a selector.

Verification ran on the separate dealmachine-verification preview branch. No acquisition jobs, seller/buyer outreach or offers were started. Temporary automatic build checks were removed after verification. Production remains gated until budget reservations, rate limits and runtime workflow integration are complete.

Documentation: https://api.docs.dealmachine.com/llms-full.txt and authenticated field/tool metadata.
