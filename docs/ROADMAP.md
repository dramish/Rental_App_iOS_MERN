# Roadmap

TBI = to be implemented. Search the repo for `TBI`.

1. `backend/src/modules/availability/`: models, `reserve()`, `release()`, `confirm()` and the concurrency tests
2. `backend/src/middleware/idempotency.ts`
3. `backend/src/modules/orders/orderStateMachine.ts` and the Order / OrderEvent models
4. Payments: Stripe test mode, webhook handler with dedupe
5. `backend/src/modules/drivers/assignment.service.ts`
6. `backend/src/modules/tracking/location.service.ts` and the `canSubscribe` hook in `realtime/gateway.ts`
7. iOS: `Realtime`, `LocationKit`, feature modules, Live Activity
8. Sign in with Apple (`auth.routes.ts`)
