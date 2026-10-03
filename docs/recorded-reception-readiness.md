# Read-only incoming provider readiness

This observation page uses the existing ElevenLabs server connection for exactly the two prepared incoming branches on `agent_7801m3qsygdwfv5tggatf7w68y3d` and `tool_8601m416c9jzfkp8qydb54q5vhkh`. It does not depend on an approved database configuration, install a dummy record, save an approval, place a call or change routing/capture/funding.

Open `/owner-reception/recorded-readiness` as the configured owner, or use its link on `/owner-reception`. Its GET endpoint rejects query parameters, mismatched hosts/origins and other accounts. The same server connection performs five bounded GET requests: each prepared branch's canonical agent response, the bounded branch metadata list, workspace settings and the one incoming stop tool. It never follows redirects or accepts arbitrary resource IDs/URLs. Responses are private and uncached; raw prompts, provider payloads, credentials, headers, phone numbers and unknown provider fields are not exposed.

The page returns the observed branch version, source-derived configuration fingerprint, draft flag, traffic percentage and explicit booleans from the deployed `inspectRecordedReceptionAgent`/tool checks. Its in-memory comparison descriptor contains only fixed targets; it is not a database approval. A hash is computed only from an identity-bound canonical snapshot, including the original complete configuration. The inspector is rerun against that derived hash. Safe-looking UI labels or parent-supplied expected versions never become evidence of provider success.

A branch draft, unexpected version, partial provider read, absent required metadata, traffic change or failed safety check remains visible as needing review. A structurally inspected fingerprint is an observation, not launch authorization. In particular, the normal600 draft/live UI contradiction is resolved only by this canonical response. Unknown metadata stays unknown.

Prepared versions:
- Owner60: `agtbrch_1801m4161ppwfb0t33mcqmfztx8w`, expected `agtvrsn_6401m416mha4fg8bbmzkdaw34avs`.
- Normal600: `agtbrch_9101m416pfheeb284rmpy0c91xak`, expected `agtvrsn_4701m416rcp0fzprqzkvkvg1v2ww`.

The existing legacy setup GET only resolves the historical named reception branch and its old profile. The recordings endpoint only reads actual stored call sessions. Neither should be coerced with a fake approved hash/config to inspect these new branches.

After canonical readback passes, use the observed hashes/versions as inputs to the separately reviewed disabled incoming configuration. Both approved customer holds remain79 cents/461 cents. New rates/policies/configs remain disabled; the existing $0 available customer credits and $1.30 historical reservations remain unchanged. No receipt, cost-review row or financial gate is bypassed by this page.

Primary API references: https://elevenlabs.io/docs/api-reference/agents/branches/get and the same canonical branch GET/list/settings/tool paths already used by `recorded-reception-provider.ts`.

## Inline tool verification

Canonical branch responses may contain full tool definitions in `prompt.tools` alongside `tool_ids`. The recorded inspector removes at most one inline stop definition from the cloned base-comparison view, only after full canonical structural equality to `tool_config` from the independently fetched, verified exact stop tool. Name, endpoint or ID similarity alone never authorizes normalization. The original complete snapshot is still fingerprinted, including all inline fields; native `end_call` entries retain the existing base validation. Duplicate stops, extra tools, malformed lists, more than eight inline entries, missing tool evidence and any structural mismatch fail closed. Runtime admission uses the same independently fetched tool evidence as readiness.

The page exposes at most eight fixed enum/boolean classifications, list shape/counts and a boundedness flag. It never returns arbitrary provider names, keys, descriptions, arguments, authentication values or URLs. A successful comparison is still observational evidence, not activation or approval.
