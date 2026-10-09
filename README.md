# Lend

A rental marketplace with doorstep delivery and pickup. Shops list rentable inventory, customers book a date range, drivers deliver and collect, and everyone follows the order live.

**Stack:** Node, Express, TypeScript, MongoDB (replica set), Redis, BullMQ, Socket.IO, SwiftUI (iOS 17+, SPM modules).

> Status: in progress. **TBI** = to be implemented; see `docs/ROADMAP.md`.

## Run locally
```bash
cp backend/.env.example backend/.env
docker compose up --build        # api :3000, mongo replica set, redis
curl localhost:3000/health
cd backend && npm ci && npm test # tests spin up an in-memory Mongo replica set
```

## What is built
| Area | Status |
|---|---|
| Auth: register, login, JWT access, rotating refresh tokens with reuse detection | Done |
| Catalog: SKUs, search, cursor pagination | Done |
| Health, readiness, Prometheus metrics, request IDs, structured logs, rate limiting | Done |
| Docker Compose (Mongo replica set), CI for backend and iOS packages | Done |
| iOS `Networking`: actor client, single in-flight token refresh, URLProtocol tests | Done |
| iOS `Persistence`: Keychain token store | Done |
| Availability and reservation (date ranges, transactions) | **TODO** |
| Order state machine (two legs), idempotency middleware | **TODO** |
| Payments (deposit hold, capture, webhooks) | **TODO** |
| Driver assignment, location ingest, live tracking | **TODO** |
| iOS: Realtime, LocationKit, feature modules, Live Activity | **TODO** |
| Sign in with Apple | **TODO** |

## Hard problems solved
**TBI.** Filled in as each one lands, with the test or benchmark that proves it:
- Double-booking prevention under concurrency (link the 100-parallel test output)
- Idempotent retries
- Exactly-once hold expiry and release
- Refresh token rotation with reuse detection (done, see `backend/test/auth.test.ts`)
- Reconnect and resync
- Background location without draining the battery

## Docs
- `docs/architecture.md`: system diagram
- `docs/adr/`: decision records (template and list of ADRs to write)
