# Lend

A rental marketplace with doorstep delivery and pickup. Shops list rentable inventory, customers book a date range, drivers deliver and collect, and everyone follows the order live.

**Backend:** Node, Express, TypeScript, MongoDB (replica set, transactions), Redis, BullMQ, WebSocket (`ws`), Zod, Stripe (test mode).
**iOS:** SwiftUI, iOS 17+, `@Observable`, modular Swift packages, SwiftData, CoreLocation, ActivityKit (Live Activities), APNs.

## What it does
- **Browse and book.** Search, cursor pagination, a date-range availability check, and an all-or-nothing reservation across items.
- **Two-leg order lifecycle.** Delivery, rental, return pickup, inspection, settlement, with overdue handling. The full state machine is data, with every transition audited.
- **Money.** One card authorization for rent + deposit. At settlement we capture rent + late fee + damage (capped at the authorization); the rest of the hold is released.
- **Drivers.** Nearest-driver offers with a 30s expiry and re-offer, atomic accept, live location streaming that is battery-aware and replays after being offline.
- **Live.** Order status and driver position over WebSocket, an ETA, a Live Activity on the lock screen and Dynamic Island, push notifications with deep links.

## Hard problems solved (each has a test; see Status for what has been run)
| Problem | Approach | Where |
|---|---|---|
| Double booking under concurrency | Per-day capacity buckets, conditional `$inc`, one Mongo transaction for the whole cart. the test fires 100 parallel requests for 10 units and asserts exactly 10 win | `availability.service.ts`, `availability.concurrency.test.ts`, ADR 0001 |
| Retried requests must not act twice | `Idempotency-Key` on HTTP, a key on every state transition, webhook event dedupe | `idempotency.ts`, `order.service.ts`, `payments.service.ts`, ADR 0002 |
| Exactly-once release / confirm vs hold-expiry race | Conditional state flips; only the winner touches the buckets | `releaseReservations`, `confirmReservations` |
| Late payment after the hold expired | Transition is illegal, so the authorization is released, never captured | `handleProviderEvent` |
| Two drivers, one job | One-at-a-time offers, conditional `OPEN -> OFFERED -> ASSIGNED`, expiry job | `dispatch.service.ts`, ADR 0005 |
| Noisy, replayed, out-of-order GPS | `seq` ordering, accuracy/throttle/jitter filter judged by `recordedAt`, latest-only fan-out | `location.service.ts`, ADR 0006 |
| Reconnects and missed events | Socket is a hint; versions/seq trigger a REST resync; backoff with jitter | `hub.ts`, `RealtimeClient.swift`, ADR 0003 |
| Token theft | Rotating refresh tokens, reuse detection revokes the family; single in-flight refresh on iOS | `auth.service.ts`, `APIClient.swift`, ADR 0004 |
| Sign in with Apple safely | Verify against Apple's JWKS, bind with a nonce, key users by `sub` not email | `apple.ts` |

## Run the backend
```bash
cp backend/.env.example backend/.env
docker compose up --build            # api :3000, mongo replica set, redis
curl localhost:3000/health
cd backend && npm ci && npm test     # tests use an in-memory Mongo replica set
```
With `PAYMENT_PROVIDER=fake` (the default) no Stripe account is needed: after placing an order call `POST /v1/dev/payments/:orderId/authorize` (the customer app has a "Simulate payment" button in debug builds).

## Run the iOS apps
```bash
brew install xcodegen
cd ios && xcodegen && open Lend.xcodeproj
```
Run `LendCustomer` and `LendDriver` in two simulators against `http://localhost:3000`. For push, Sign in with Apple and Live Activities on a device, set your team in `ios/project.yml` and fill the Apple values in `backend/.env`.

## Status and honest gaps
- Mongo-backed tests, the Stripe provider, APNs delivery and the Xcode app targets must be verified in your environment (CI runs the backend and package tests).
- Not built: image upload (proof-of-delivery currently sends a placeholder URL in debug builds only), Stripe PaymentSheet in the app (the server side is done), a shop dashboard UI, ratings, multi-city.
- See `docs/architecture.md` for known limits (per-instance rate limiting, UTC-day granularity, authorization expiry on long rentals, no transactional outbox).

## Docs
- `docs/architecture.md`: system diagram, lifecycle, money model, limits
- `docs/adr/`: decision records
