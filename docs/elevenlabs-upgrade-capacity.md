# ElevenLabs upgrade recognition

After the owner reported upgrading ElevenLabs on November 5, production maintenance began returning `VOICE_CAPACITY_UNVERIFIED` at 17:29 UTC. The last accepted observation, at 17:28 UTC, still described an exhausted Pro allowance. This stopped fresh capacity and credit observations from replacing the old snapshot.

The app recognized the marketing strings `scale` and `business`, but ElevenLabs' official API definition uses `scale_2024_08_10` and `growing_business`. Accept these exact canonical IDs alongside the existing names. Use an own-property lookup, so inherited object names or arbitrary tier prefixes cannot become a capacity entitlement. Unknown plans remain unverified.

The owner-approved ceiling remains twenty calls, with the existing incoming reservation and narrower per-agent limits. The normal subscription and exact regional agent GETs still verify current credits, agent identity and disabled burst mode before the original atomic database save. Only then may the existing configuration recovery run. This does not buy credits, enable overages, alter provider settings, replay calls or release uncertain costs.

Separate sanitized errors distinguish an unrecognized subscription tier from invalid agent capacity. Logs receive no raw subscription body, agent configuration, credentials or customer data. Production readback must confirm the actual new plan/allowance and ordinary call receipts; the correlation with the upgrade alone does not prove its current provider values.

Primary references checked November 5, 2026:

- [ElevenLabs-generated API tier identifiers](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/pending_subscription_switch_response_model_next_tier.py)
- [ElevenAgents concurrency limits](https://elevenlabs.io/pricing/agents): Scale 30, Business 40; iCash X retains its lower ceiling of 20.
- [Subscription metadata and credit allowance](https://elevenlabs.io/docs/api-reference/user/subscription/get)

Offline tests replay both canonical upgraded tiers, original regional reads, available credit observations, exact saved caps, recovery-after-save ordering, inherited/unknown plan names and invalid/burst-enabled agent settings. Existing database tests continue to prove that fresh available credit evidence restores ordinary admission while exhausted/malformed observations, customer controls, wallet rules and unresolved operations retain their original behavior. No paid test calls are permitted by this repair.
