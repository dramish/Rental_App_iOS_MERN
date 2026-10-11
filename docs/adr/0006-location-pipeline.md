# ADR 0006: Location pipeline

- Status: accepted

## Decision
Drivers POST batches of points (`seq`, `recordedAt`). The server drops stale (`seq`), inaccurate (>100m), future-dated, throttled (<2s apart) and jitter points (<10m unless 15s passed), judging spacing by `recordedAt` so an offline replay is thinned the same way live points are. Accepted points go to Mongo history (7-day TTL); the latest goes to a cache (Redis, 2-minute expiry) for fast reads; a coarse position is written to the Driver document at most every 30s for `$near` dispatch. Only the latest point of a batch is fanned out to the order room, with an ETA.

## Why split latest vs history vs coarse
Each has a different access pattern: tracking wants the newest point instantly, audit wants everything cheaply with expiry, dispatch needs a geo index that should not be rewritten every 2 seconds.

## Battery (iOS)
High accuracy only while a task is assigned; significant-change updates while merely online; batching and pausing when stationary.
