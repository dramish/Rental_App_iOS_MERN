# ADR 0005: One-at-a-time driver offers

- Status: accepted

## Decision
A delivery or return leg is a task (`OPEN -> OFFERED -> ASSIGNED -> DONE`). Dispatch picks the nearest free, online driver (`$near` on a 2dsphere index) who has not declined, and offers with a conditional `OPEN -> OFFERED` update and a 30s expiry. A delayed job returns unanswered offers to the pool and tries the next driver. Accept is a conditional `OFFERED(to me, not expired) -> ASSIGNED` update plus the order's driver assignment, in one transaction.

## Why not broadcast to many drivers
Broadcast needs a first-wins race and wastes every other driver's attention. One-at-a-time makes the claim trivially correct and the UX calmer, at the cost of slower assignment when drivers ignore offers.

## Consequences
Accepting a stale or expired offer returns 409. Dispatch gives up after 10 attempts and logs it (an alert would hook in here).
