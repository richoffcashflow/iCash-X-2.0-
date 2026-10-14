# Bounded concurrency regression

Run from the repository root with Node 24 and installed dependencies:

```sh
node --experimental-strip-types scripts/test-bounded-concurrency.mjs
```

This fixed-size, isolated simulation tests the actual text dispatch service, receipt recovery service, and service-health code against production SQL functions loaded through the existing `createJourneyDb` fixture. It also loads `config/text-ai.sql` and the current `config/reliability-monitor-and-receipts.sql`. Provider transport is replaced with explicit local stubs. It accepts no database URL or load-size arguments, replaces the credentials its services read with fixture strings, blocks global `fetch`, and makes no network requests, paid calls, real messages, or customer-data changes.

## Covered workload

The script uses **12 concurrent service requests**, **2 synthetic accounts**, and **12 distinct messages**. Every message is enqueued and dispatched eight times. Two provider responses are deliberately ambiguous; two successful database receipt commits deliberately lose their response. Known deliveries and verified cost settlements are replayed eight times, followed by eight additional dispatch attempts per message. Foreign-account request keys and dispatch claims are rejected.

Assertions require:

- Exactly one queued message and one provider-stub invocation per message.
- Lost database responses retry the idempotent receipt save, without another send.
- Ambiguous sends remain `needs_review`, without a fabricated provider receipt or settlement.
- Ten known deliveries produce ten cost manifests and ten fractional-usage entries; duplicate callbacks and settlement replays never add charges.
- Each account's wallet matches only its own verified message charges, and every saved receipt belongs to the expected account.
- A burst of 96 healthy service-health requests shares three underlying probes. Another burst of 96 requests during an outage also shares three probes and returns degraded status.

The JSON output reports the number of requests, maximum in-flight calls, total duration, median, and 95th-percentile latency for every phase. These timing values are observations, not hard-coded performance gates. Correctness assertions are the gate.

## Recorded local run

October 14, 2026: passed with 12 in-flight calls. The simulation observed 12 provider-stub calls, ten verified settlements, two uncertain outcomes held, zero duplicate sends, zero duplicate charges, and zero account mismatches. The dispatch phase took approximately 473 ms, with a 177 ms 95th-percentile latency; the provider stub waits 10–25 ms, and lost database responses exercise the real 200 ms receipt retry delay. These numbers describe this local run only and will vary with machine load.

## Limits and the next capacity check

PGlite runs PostgreSQL in one process and **serializes database work through one connection**. Concurrent JavaScript requests can overlap provider waits and database calls, but this is not proof of multi-connection row-lock behavior, deadlock freedom, hosted Postgres throughput, HTTP deployment throughput, real provider latency, or 100,000-user capacity. The shared journey fixture is a deliberately bounded schema reconstruction, not every current production migration; separate regression suites cover current permission, billing, and admission policies.

Before materially increasing acquisition traffic, repeat the relevant work against a disposable, independently configured PostgreSQL database and application deployment with multiple real connections, synthetic accounts, and provider stubs. Measure queue age, error rate, p95 latency, and database saturation while increasing a bounded workload. Validate tenant isolation, duplicate webhooks, worker restarts, and uncertain provider outcomes at each level. Do not target production or use live providers for this test.
