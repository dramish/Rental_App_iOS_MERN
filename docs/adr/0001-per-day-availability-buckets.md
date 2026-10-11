# ADR 0001: Per-day availability buckets

- Status: accepted

## Context
A rental blocks a SKU for a date range, and SKUs have quantity (1 drill, 20 chairs). Two customers can ask for overlapping dates at the same instant. Overbooking must be impossible.

## Options
1. **Sum overlapping reservations at read time** (`find overlapping, sum qty, insert`). Flexible, but read-then-write is racy unless every reserve for a SKU is serialized by a lock or a version bump on the SKU.
2. **Per-day buckets** (`AvailabilityDay{sku, date, reserved}`): reserving is one conditional `$inc` per day, guarded by `reserved <= total - qty`.
3. Redis locks around option 1: a second system on the correctness path, with lock expiry edge cases.

## Decision
Option 2. The capacity check and the increment are one atomic database operation per day, and a Mongo transaction makes a multi-day, multi-SKU reservation all-or-nothing.

## Consequences
- Simple invariant (`0 <= reserved <= total`) that a test can hammer (100 parallel requests).
- Cost: writes grow with range length (max 30 days) and granularity is one day.
- Buckets must exist before the transaction starts (a transaction snapshot would not see buckets created later), so `prepareReservation` upserts them first.
- Transactions retry on write conflicts under contention. That is the price of correctness, and is bounded by the 30-day cap and few contended documents.
