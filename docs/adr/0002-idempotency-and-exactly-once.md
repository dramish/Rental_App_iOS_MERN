# ADR 0002: Idempotency at three levels

- Status: accepted

## Decision
1. **HTTP:** `Idempotency-Key` header on order placement and order events. A Mongo record per (user, key) stores the request hash and the response. Same key and body replays the response; a different body is 422; a concurrent duplicate is 409. 5xx responses are not stored. In-flight records are taken over after 60s (crash recovery). Records expire after 24h (TTL index).
2. **State machine:** every transition carries a key, and `(orderId, idempotencyKey)` is unique in the audit log, so even without the HTTP layer a replay applies once.
3. **Webhooks:** the provider's event id is deduplicated; the transition itself is keyed `webhook-<eventId>`, so a crash between "applied" and "marked done" is safe to re-run.

## Why Mongo and not Redis for the HTTP keys
The record must survive restarts and sits next to the data it protects. Redis `SET NX` would be faster but loses keys on eviction or failover, which is exactly when retries happen.

## Consequences
Jobs are at-least-once (BullMQ), so each job handler is idempotent: hold expiry and payment actions check current state and use provider idempotency keys.
